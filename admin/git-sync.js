// Auto-sync changed files back to GitHub after admin operations.
// This ensures edits made via the admin panel survive Railway redeploys
// by committing them to the repo via the GitHub Contents API.
//
// Key design decisions:
// - All syncs are SERIALIZED through a queue (no parallel commits)
// - Files are re-read from disk at commit time (not at enqueue time)
// - 409 SHA conflicts trigger an automatic retry with fresh SHA
// - Paths with slashes are encoded correctly for the GitHub API

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'walkingweddings/walking-weddings';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'master';
const ROOT = join(__dirname, '..');
const MAX_RETRIES = 3;

function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

async function getFileSha(path) {
  if (!GITHUB_TOKEN) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodePath(path)}?ref=${GITHUB_BRANCH}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.sha || null;
  } catch {
    return null;
  }
}

async function commitFile(filePath, message, attempt) {
  attempt = attempt || 1;
  if (!GITHUB_TOKEN) {
    console.warn('[git-sync] GITHUB_TOKEN nicht gesetzt — skip');
    return false;
  }
  const fullPath = join(ROOT, filePath);
  if (!existsSync(fullPath)) {
    console.warn('[git-sync] Datei nicht gefunden:', filePath);
    return false;
  }
  // Always read fresh from disk at commit time
  const content = readFileSync(fullPath).toString('base64');
  const sha = await getFileSha(filePath);

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodePath(filePath)}`;
  const body = {
    message,
    content,
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    console.log('[git-sync] committed:', filePath);
    return true;
  }

  // 409 = SHA conflict (another commit changed the file). Retry with fresh SHA.
  if (res.status === 409 && attempt < MAX_RETRIES) {
    console.warn(`[git-sync] SHA conflict for ${filePath}, retry ${attempt + 1}/${MAX_RETRIES}`);
    await new Promise(r => setTimeout(r, 500 * attempt));
    return commitFile(filePath, message, attempt + 1);
  }

  // 422 = file exists but no SHA was provided (getFileSha failed). Retry.
  if (res.status === 422 && !sha && attempt < MAX_RETRIES) {
    console.warn(`[git-sync] 422 for ${filePath} (missing SHA), retry ${attempt + 1}/${MAX_RETRIES}`);
    await new Promise(r => setTimeout(r, 500 * attempt));
    return commitFile(filePath, message, attempt + 1);
  }

  const err = await res.json().catch(() => ({}));
  console.error('[git-sync] Fehler bei', filePath, ':', res.status, err.message || '');
  return false;
}

// --- Serialized queue -------------------------------------------------------
// Only one sync runs at a time. New requests are enqueued and processed in
// order. This prevents race conditions where two syncs for blog.html compete
// and the loser's 409 error silently drops changes.

const queue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    // Deduplicate: if the same file appears in a later job too, skip it here
    // (the later job will have fresher content). Only dedupe blog.html since
    // it's the shared file that causes conflicts.
    const dominated = queue.some(later =>
      later.files.includes('blog.html') && job.files.includes('blog.html')
    );
    const files = dominated
      ? job.files.filter(f => f !== 'blog.html')
      : job.files;
    for (const fp of files) {
      try {
        await commitFile(fp, job.message);
      } catch (err) {
        console.error('[git-sync] Unerwarteter Fehler bei', fp, ':', err.message);
      }
    }
  }
  processing = false;
}

// Fire-and-forget: call this after any admin write operation.
// The job is enqueued and processed in order. Files are read from disk
// at commit time (not now), so even if this is called before another
// write operation finishes, the commit will pick up the latest content.
function syncToGitHub(filePaths, message) {
  if (!GITHUB_TOKEN) return;
  queue.push({ files: filePaths, message });
  processQueue().catch(err => {
    console.error('[git-sync] Queue-Fehler:', err.message);
  });
}

module.exports = { syncToGitHub, commitFile, commitFiles: commitFile };
