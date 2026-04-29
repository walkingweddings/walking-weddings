// Media library API: list and delete uploaded files in
// /assets/images/journal/. Used by the Admin Media view.
//
// Delete is reference-checked — we scan all pages JSON, published-post
// sidecars, and active drafts for the file's URL before allowing removal.
// This prevents the easy mistake of pulling an image that's still rendered
// by some live post or page.

'use strict';

const crypto = require('crypto');
const { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } = require('fs');
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

// --- Duplicate detection + consolidation ----------------------------------
//
// Uploads accumulate duplicates because the upload endpoint mints a fresh
// timestamped filename for every request — re-uploading the same image
// twice produces two distinct files with identical bytes. Over time the
// gallery fills with redundant entries.
//
// findDuplicates() groups files by SHA-256 of their content and returns
// only the groups with more than one entry. Within each group the oldest
// file (lowest mtime) is the canonical version we'll keep — older usually
// means "the one already linked from posts". The newer ones can be
// deleted after we redirect their references.

function hashFile(path) {
  const h = crypto.createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function findDuplicates() {
  const items = listMedia();
  const groups = new Map(); // hash -> [items]
  for (const it of items) {
    let hash;
    try { hash = hashFile(join(storage.uploadsDir(), it.filename)); }
    catch { continue; }
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(it);
  }
  const dupes = [];
  for (const [hash, members] of groups) {
    if (members.length < 2) continue;
    // Oldest first → that one stays as canonical.
    members.sort((a, b) => a.mtime - b.mtime);
    dupes.push({
      hash,
      canonical: members[0],
      duplicates: members.slice(1),
      sizeReclaimed: members.slice(1).reduce((sum, m) => sum + m.size, 0),
    });
  }
  return dupes;
}

// Replace every occurrence of any string in `replacements` (Map<from, to>)
// inside the JSON files of pages/published/drafts and the rendered blog HTML.
// Returns the list of file paths (repo-relative) that were changed so the
// caller can git-sync them as one batch.
function rewriteReferences(replacements) {
  if (!replacements.size) return [];
  const changed = [];

  function process(filePath, relPath) {
    let content;
    try { content = readFileSync(filePath, 'utf8'); } catch { return; }
    let next = content;
    for (const [from, to] of replacements) {
      // Plain string replace — file paths in our JSON/HTML appear verbatim
      // (no encoding) and the timestamp+random prefix means the match is
      // unique enough that substring collisions are not a concern.
      next = next.split(from).join(to);
    }
    if (next !== content) {
      writeFileSync(filePath, next);
      changed.push(relPath);
    }
  }

  function walk(dir, relPrefix, predicate) {
    if (!existsSync(dir)) return;
    let files = [];
    try { files = readdirSync(dir); } catch { return; }
    for (const f of files) {
      if (!predicate(f)) continue;
      process(join(dir, f), relPrefix + f);
    }
  }

  // JSON sources of truth (pages content, published sidecars, active drafts)
  walk(storage.pagesDir(), 'pages/', f => f.endsWith('.json'));
  walk(storage.publishedDir(), 'admin/published/', f => f.endsWith('.json'));
  walk(storage.draftsDir(), 'admin/drafts/', f => f.endsWith('.json'));

  // Rendered blog HTML — old timestamps in there were baked at publish time,
  // they need to be redirected too or readers see broken images.
  walk(join(storage.REPO_ROOT, 'blog'), 'blog/', f => f.endsWith('.html'));

  // The journal grid landing page (blog.html at repo root) carries thumbnails
  // referencing journal uploads.
  process(join(storage.REPO_ROOT, 'blog.html'), 'blog.html');

  return changed;
}

// Plan + execute consolidation. Returns a report with counts.
function consolidateDuplicates() {
  const groups = findDuplicates();
  if (!groups.length) return { groups: 0, filesUpdated: [], filesDeleted: [] };

  // Build replacement map: every duplicate URL → canonical URL
  const replacements = new Map();
  const toDelete = [];
  for (const g of groups) {
    const canonicalUrl = PUBLIC_PREFIX + g.canonical.filename;
    for (const d of g.duplicates) {
      replacements.set(PUBLIC_PREFIX + d.filename, canonicalUrl);
      toDelete.push(d.filename);
    }
  }

  // 1) Rewrite all references first — never delete a file before its
  //    references point elsewhere.
  const filesUpdated = rewriteReferences(replacements);

  // 2) Delete the duplicate files locally.
  const filesDeleted = [];
  for (const f of toDelete) {
    try { unlinkSync(join(storage.uploadsDir(), f)); filesDeleted.push(f); }
    catch (err) { console.error('[media-dedupe] delete failed', f, err.message); }
  }

  return {
    groups: groups.length,
    filesUpdated,
    filesDeleted,
    sizeReclaimed: groups.reduce((s, g) => s + g.sizeReclaimed, 0),
    replacements: Array.from(replacements.entries()).map(([from, to]) => ({ from, to })),
  };
}

function makeHandler(deps) {
  const { json, readJson, requireAuth, syncToGitHub, syncDeleteToGitHub } = deps;

  return async function handle(req, res, url) {
    // List
    if (req.method === 'GET' && url === '/api/admin/media') {
      if (!requireAuth(req, res)) return true;
      json(res, 200, { ok: true, items: listMedia() });
      return true;
    }

    // Find duplicates (read-only preview before consolidation)
    if (req.method === 'GET' && url === '/api/admin/media/duplicates') {
      if (!requireAuth(req, res)) return true;
      try {
        const groups = findDuplicates();
        const totalDupes = groups.reduce((s, g) => s + g.duplicates.length, 0);
        const sizeReclaimed = groups.reduce((s, g) => s + g.sizeReclaimed, 0);
        json(res, 200, { ok: true, groups, totalGroups: groups.length, totalDupes, sizeReclaimed });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return true;
    }

    // Consolidate: rewrite references then delete duplicate files
    if (req.method === 'POST' && url === '/api/admin/media/dedupe') {
      if (!requireAuth(req, res)) return true;
      try {
        const report = consolidateDuplicates();
        json(res, 200, { ok: true, ...report });
        // Sync the rewritten files (text content changes) AND the deletes
        // in one batched commit.
        if (report.filesUpdated && report.filesUpdated.length) {
          syncToGitHub(report.filesUpdated, `Admin: dedupe — rewrite references in ${report.filesUpdated.length} Dateien`);
        }
        if (report.filesDeleted && report.filesDeleted.length) {
          const paths = report.filesDeleted.map(f => `assets/images/journal/${f}`);
          syncDeleteToGitHub(paths, `Admin: dedupe — entferne ${paths.length} Duplikate`);
        }
      } catch (e) {
        console.error('[media-dedupe] error:', e);
        json(res, 500, { error: e.message });
      }
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
  findDuplicates,
  consolidateDuplicates,
  rewriteReferences,
  deleteMedia,
};
