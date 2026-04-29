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

// Single batched commit covering all listed files. Re-reads each file from
// disk so concurrent writes between enqueue and flush are picked up. Retries
// the ref update if another commit slipped in (non-fast-forward).
async function commitBatch(filePaths, message) {
  if (!GITHUB_TOKEN) {
    console.warn('[git-sync] GITHUB_TOKEN nicht gesetzt — skip');
    return false;
  }
  // Materialize blobs first (these don't move the branch and can be reused
  // across ref-update retries).
  const entries = [];
  for (const fp of filePaths) {
    const fullPath = join(ROOT, fp);
    if (!existsSync(fullPath)) {
      console.warn('[git-sync] Datei nicht gefunden, skip:', fp);
      continue;
    }
    const contentB64 = readFileSync(fullPath).toString('base64');
    try {
      const blob = await createBlob(contentB64);
      entries.push({ path: fp, mode: '100644', type: 'blob', sha: blob.sha });
    } catch (err) {
      console.error('[git-sync] blob fail', fp, ':', err.message);
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
// Multiple syncToGitHub() calls within DEBOUNCE_MS coalesce into one commit.
// Each call's files + message accumulate; the most-recent message wins for
// the combined commit (file paths are deduped via the Map).

const pending = new Map(); // filePath -> string (per-file message)
let lastMessage = '';
let flushTimer = null;
let inFlight = null; // Promise of the current flush, or null

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, DEBOUNCE_MS);
}

async function flush() {
  // If a flush is already running, wait for it; new pending entries will be
  // picked up by a follow-up flush scheduled by the next syncToGitHub call.
  if (inFlight) return inFlight;
  if (pending.size === 0) return;

  // Snapshot and clear so additional enqueues during the in-flight commit
  // accumulate into the next batch.
  const filePaths = Array.from(pending.keys());
  pending.clear();
  const message = summarizeMessage(filePaths, lastMessage);
  lastMessage = '';

  inFlight = (async () => {
    try {
      await commitBatch(filePaths, message);
    } catch (err) {
      console.error('[git-sync] flush error:', err.message);
    } finally {
      inFlight = null;
      // If anything queued during the in-flight commit, schedule another flush
      if (pending.size > 0) scheduleFlush();
    }
  })();
  return inFlight;
}

function summarizeMessage(filePaths, fallback) {
  if (filePaths.length === 1) return fallback || `Admin: update ${filePaths[0]}`;
  // For batches, prefer a concise summary that still hints at the trigger
  return `${fallback || 'Admin: batch update'} (+${filePaths.length - 1} weitere Dateien)`;
}

// Fire-and-forget: enqueues files for the next batched commit.
function syncToGitHub(filePaths, message) {
  if (!GITHUB_TOKEN) return;
  for (const fp of filePaths) pending.set(fp, message);
  if (message) lastMessage = message;
  scheduleFlush();
}

module.exports = { syncToGitHub, commitBatch, _flushNow: flush };
