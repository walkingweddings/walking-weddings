// Auto-sync changed files back to GitHub after admin operations.
// Edits made via the admin panel survive Railway redeploys by being committed
// to the repo.
//
// CRITICAL DESIGN: Bursts of admin writes (e.g. uploading 10 photos in a row)
// must NOT produce 10 separate commits — every push triggers a Railway rebuild
// that kills the running container, including any in-flight Claude generation
// request. We use the GitHub Git Data API (blobs + trees + commits + ref
// update) so multiple files land in one commit, and we debounce a few seconds
// before flushing so a fast burst of syncToGitHub() calls all join the same
// commit.

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'walkingweddings/walking-weddings';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'master';
const ROOT = join(__dirname, '..');
const DEBOUNCE_MS = parseInt(process.env.GIT_SYNC_DEBOUNCE_MS || '4000', 10);
const MAX_REF_RETRIES = 4;

function ghHeaders(extra) {
  return Object.assign({
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
  }, extra || {});
}

async function ghJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status}: ${data.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getRef() {
  return ghJson(`https://api.github.com/repos/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`, {
    headers: ghHeaders(),
  });
}

async function getCommit(sha) {
  return ghJson(`https://api.github.com/repos/${GITHUB_REPO}/git/commits/${sha}`, {
    headers: ghHeaders(),
  });
}

async function createBlob(contentBase64) {
  return ghJson(`https://api.github.com/repos/${GITHUB_REPO}/git/blobs`, {
    method: 'POST',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
  });
}

async function createTree(baseTreeSha, entries) {
  return ghJson(`https://api.github.com/repos/${GITHUB_REPO}/git/trees`, {
    method: 'POST',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
}

async function createCommit(message, treeSha, parentSha) {
  return ghJson(`https://api.github.com/repos/${GITHUB_REPO}/git/commits`, {
    method: 'POST',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
}

async function updateRef(commitSha) {
  return ghJson(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`, {
    method: 'PATCH',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
}

// Single batched commit covering all listed items. Each item is either
//   { path, action: 'add' }    — read fresh from disk, create blob, set tree
//   { path, action: 'delete' } — emit a tree entry with sha:null (Git Data
//                                API treats null sha as "remove this path")
//
// For backward compatibility callers can pass a plain array of strings,
// which we treat as 'add'. Re-reads each add-file from disk so concurrent
// writes between enqueue and flush are picked up. Retries the ref update
// if another commit slipped in (non-fast-forward).
async function commitBatch(items, message) {
  if (!GITHUB_TOKEN) {
    console.warn('[git-sync] GITHUB_TOKEN nicht gesetzt — skip');
    return false;
  }
  const normalized = items.map(it => typeof it === 'string' ? { path: it, action: 'add' } : it);
  const entries = [];
  for (const it of normalized) {
    if (it.action === 'delete') {
      // Removing a path: tree entry with sha:null. No disk read or blob needed.
      entries.push({ path: it.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const fullPath = join(ROOT, it.path);
    if (!existsSync(fullPath)) {
      console.warn('[git-sync] Datei nicht gefunden, skip:', it.path);
      continue;
    }
    const contentB64 = readFileSync(fullPath).toString('base64');
    try {
      const blob = await createBlob(contentB64);
      entries.push({ path: it.path, mode: '100644', type: 'blob', sha: blob.sha });
    } catch (err) {
      console.error('[git-sync] blob fail', it.path, ':', err.message);
    }
  }
  if (!entries.length) return false;

  for (let attempt = 1; attempt <= MAX_REF_RETRIES; attempt++) {
    try {
      const ref = await getRef();
      const headSha = ref.object.sha;
      const head = await getCommit(headSha);
      const tree = await createTree(head.tree.sha, entries);
      const commit = await createCommit(message, tree.sha, headSha);
      await updateRef(commit.sha);
      console.log(`[git-sync] commit ${commit.sha.slice(0, 7)}: ${entries.length} files (${message})`);
      return true;
    } catch (err) {
      // 422 = non-fast-forward (another commit landed). Retry from a fresh ref.
      if (err.status === 422 && attempt < MAX_REF_RETRIES) {
        console.warn(`[git-sync] non-fast-forward, retry ${attempt}/${MAX_REF_RETRIES}`);
        await new Promise(r => setTimeout(r, 400 * attempt));
        continue;
      }
      console.error('[git-sync] commit failed:', err.message);
      return false;
    }
  }
  return false;
}

// --- Debounced batch queue --------------------------------------------------
// Multiple syncToGitHub() / syncDeleteToGitHub() calls within DEBOUNCE_MS
// coalesce into one commit. Each call's path + action + message accumulate;
// the most-recent action for a given path wins (so a write-then-delete
// in the same window correctly removes the file).

const pending = new Map(); // filePath -> 'add' | 'delete'
let lastMessage = '';
let flushTimer = null;
let inFlight = null; // Promise of the current flush, or null

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, DEBOUNCE_MS);
}

async function flush() {
  if (inFlight) return inFlight;
  if (pending.size === 0) return;

  const items = Array.from(pending.entries()).map(([path, action]) => ({ path, action }));
  pending.clear();
  const message = summarizeMessage(items, lastMessage);
  lastMessage = '';

  inFlight = (async () => {
    try {
      await commitBatch(items, message);
    } catch (err) {
      console.error('[git-sync] flush error:', err.message);
    } finally {
      inFlight = null;
      if (pending.size > 0) scheduleFlush();
    }
  })();
  return inFlight;
}

function summarizeMessage(items, fallback) {
  if (items.length === 1) {
    const it = items[0];
    return fallback || `Admin: ${it.action === 'delete' ? 'delete' : 'update'} ${it.path}`;
  }
  return `${fallback || 'Admin: batch update'} (+${items.length - 1} weitere Dateien)`;
}

// Fire-and-forget: enqueues files for the next batched commit.
function syncToGitHub(filePaths, message) {
  if (!GITHUB_TOKEN) return;
  for (const fp of filePaths) pending.set(fp, 'add');
  if (message) lastMessage = message;
  scheduleFlush();
}

// Removes file paths from the repo on the next flush. Use when an admin
// action deletes media or other tracked content — otherwise the file would
// reappear on the next deploy because it still exists in git history HEAD.
function syncDeleteToGitHub(filePaths, message) {
  if (!GITHUB_TOKEN) return;
  for (const fp of filePaths) pending.set(fp, 'delete');
  if (message) lastMessage = message;
  scheduleFlush();
}

module.exports = { syncToGitHub, syncDeleteToGitHub, commitBatch, _flushNow: flush };
