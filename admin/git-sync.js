// Auto-sync changed files back to GitHub after admin operations.
// This ensures edits made via the admin panel survive Railway redeploys
// by committing them to the repo via the GitHub Contents API.

const { readFileSync, existsSync } = require('fs');
const { join, relative } = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'walkingweddings/walking-weddings';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'master';
const ROOT = join(__dirname, '..');

async function getFileSha(path) {
  if (!GITHUB_TOKEN) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path)}?ref=${GITHUB_BRANCH}`;
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

async function commitFile(filePath, message) {
  if (!GITHUB_TOKEN) {
    console.warn('[git-sync] GITHUB_TOKEN nicht gesetzt — skip');
    return false;
  }
  const fullPath = join(ROOT, filePath);
  if (!existsSync(fullPath)) {
    console.warn('[git-sync] Datei nicht gefunden:', filePath);
    return false;
  }
  const content = readFileSync(fullPath).toString('base64');
  const sha = await getFileSha(filePath);

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
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

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[git-sync] Fehler bei', filePath, ':', err.message || res.status);
    return false;
  }
  console.log('[git-sync] committed:', filePath);
  return true;
}

async function commitFiles(filePaths, message) {
  if (!GITHUB_TOKEN) {
    console.warn('[git-sync] GITHUB_TOKEN nicht gesetzt — überspringe Git-Sync');
    return;
  }
  const results = [];
  for (const fp of filePaths) {
    try {
      const ok = await commitFile(fp, message);
      results.push({ file: fp, ok });
    } catch (err) {
      console.error('[git-sync] Fehler bei', fp, ':', err.message);
      results.push({ file: fp, ok: false });
    }
  }
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  if (succeeded) console.log(`[git-sync] ${succeeded} Datei(en) committed`);
  if (failed) console.warn(`[git-sync] ${failed} Datei(en) fehlgeschlagen`);
  return results;
}

// Fire-and-forget: call this after any admin write operation.
// Runs async in the background so the HTTP response isn't delayed.
function syncToGitHub(filePaths, message) {
  if (!GITHUB_TOKEN) return;
  commitFiles(filePaths, message).catch(err => {
    console.error('[git-sync] Unerwarteter Fehler:', err.message);
  });
}

module.exports = { syncToGitHub, commitFile, commitFiles };
