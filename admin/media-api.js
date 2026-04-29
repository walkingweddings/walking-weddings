// Media library API: list and delete uploaded files in
// /assets/images/journal/. Used by the Admin Media view.
//
// Delete is reference-checked — we scan all pages JSON, published-post
// sidecars, and active drafts for the file's URL before allowing removal.
// This prevents the easy mistake of pulling an image that's still rendered
// by some live post or page.

'use strict';

const { readFileSync, readdirSync, statSync, unlinkSync, existsSync } = require('fs');
const { join } = require('path');
const storage = require('./storage');

const PUBLIC_PREFIX = '/assets/images/journal/';

function listMedia() {
  const dir = storage.uploadsDir();
  let files = [];
  try { files = readdirSync(dir).filter(f => !f.startsWith('.')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const full = join(dir, f);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;
    const ext = (f.split('.').pop() || '').toLowerCase();
    const isVideo = ['mp4', 'mov', 'webm', 'm4v'].includes(ext);
    out.push({
      filename: f,
      url: PUBLIC_PREFIX + f,
      type: isVideo ? 'video' : 'image',
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  }
  // Newest first (filenames begin with timestamp anyway, but mtime is the
  // authoritative ordering)
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// Returns a list of references to the given URL across pages JSON,
// published sidecars, and active drafts. Empty list = safe to delete.
function findReferences(url) {
  const refs = [];
  const search = (label, dir) => {
    if (!existsSync(dir)) return;
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return; }
    for (const f of files) {
      let content;
      try { content = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      if (content.includes(url)) refs.push({ source: label, file: f });
    }
  };
  search('pages', storage.pagesDir());
  search('published', storage.publishedDir());
  search('drafts', storage.draftsDir());
  return refs;
}

function deleteMedia(filename) {
  if (!filename || filename.includes('/') || filename.includes('..') || filename.startsWith('.')) {
    throw new Error('Ungültiger Dateiname');
  }
  const full = join(storage.uploadsDir(), filename);
  if (!existsSync(full)) throw new Error('Datei nicht gefunden');
  unlinkSync(full);
}

function makeHandler(deps) {
  const { json, readJson, requireAuth, syncDeleteToGitHub } = deps;

  return async function handle(req, res, url) {
    // List
    if (req.method === 'GET' && url === '/api/admin/media') {
      if (!requireAuth(req, res)) return true;
      json(res, 200, { ok: true, items: listMedia() });
      return true;
    }

    // Reference-check (called by the UI before showing the delete confirmation)
    const refMatch = req.method === 'GET' && url.match(/^\/api\/admin\/media\/([^/]+)\/refs$/);
    if (refMatch) {
      if (!requireAuth(req, res)) return true;
      const filename = decodeURIComponent(refMatch[1]);
      const refs = findReferences(PUBLIC_PREFIX + filename);
      json(res, 200, { ok: true, refs });
      return true;
    }

    // Delete
    const delMatch = req.method === 'DELETE' && url.match(/^\/api\/admin\/media\/([^/]+)$/);
    if (delMatch) {
      if (!requireAuth(req, res)) return true;
      const filename = decodeURIComponent(delMatch[1]);
      // Validate before any work — defense against path traversal even though
      // the URL regex already disallows literal slashes (encoded slashes
      // decode after match).
      if (!filename || filename.includes('/') || filename.includes('..') || filename.startsWith('.')) {
        json(res, 400, { error: 'Ungültiger Dateiname' });
        return true;
      }
      const q = req.url.indexOf('?');
      const params = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1));
      const force = params.get('force') === '1';
      try {
        if (!force) {
          const refs = findReferences(PUBLIC_PREFIX + filename);
          if (refs.length) {
            json(res, 409, { error: 'Datei wird noch referenziert', refs });
            return true;
          }
        }
        deleteMedia(filename);
        json(res, 200, { ok: true });
        syncDeleteToGitHub([`assets/images/journal/${filename}`], `Admin: delete media ${filename}`);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return true;
    }

    return false;
  };
}

module.exports = {
  makeHandler,
  listMedia,
  findReferences,
  deleteMedia,
};
