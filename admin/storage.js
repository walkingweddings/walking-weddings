// Resolves where admin state (drafts, leads, page content) lives on disk.
//
// On Railway we mount a persistent volume at /data so writes survive
// redeploys without going through git-sync. Locally we fall back to the
// repo's admin/ directory so dev still works without configuration.
//
// Resolution order:
//   1. process.env.STORAGE_DIR — explicit override
//   2. /data — the conventional Railway volume mount point
//   3. <repo>/admin — local development default
//
// Subdirectories are created on first import so callers can assume they
// exist. Nothing here syncs to git — that's the point. Only files that the
// public site needs to serve (page content JSON, blog HTML, uploaded media)
// continue to flow through admin/git-sync.js.

const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const REPO_ROOT = join(__dirname, '..');

function resolveStorageRoot() {
  const envDir = process.env.STORAGE_DIR;
  if (envDir) return envDir;
  if (existsSync('/data')) return '/data';
  return join(__dirname); // admin/ as fallback
}

const STORAGE_DIR = resolveStorageRoot();

const subdirs = {
  drafts: join(STORAGE_DIR, 'drafts'),
  published: join(STORAGE_DIR, 'published'),
  pages: join(STORAGE_DIR, 'pages'),
  leads: join(STORAGE_DIR, 'leads'),
};

for (const dir of Object.values(subdirs)) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Uploaded media MUST live in the repo so the public site can serve it.
// Keeping it on the volume only would break image URLs after redeploy.
const UPLOADS_DIR = join(REPO_ROOT, 'assets', 'images', 'journal');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

function isPersistent() {
  if (STORAGE_DIR === '/data') return true;
  if (process.env.STORAGE_DIR && STORAGE_DIR !== __dirname) return true;
  return false;
}

module.exports = {
  STORAGE_DIR,
  REPO_ROOT,
  draftsDir: () => subdirs.drafts,
  publishedDir: () => subdirs.published,
  pagesDir: () => subdirs.pages,
  leadsDir: () => subdirs.leads,
  uploadsDir: () => UPLOADS_DIR,
  isPersistent,
};
