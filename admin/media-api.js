// Media library API — lists EVERY image and video under assets/images/* and
// assets/videos/* (not just journal uploads), tagged with the source folder
// so the admin gets a single overview of all media on the website.
//
// Sources:
//   journal/    — Claude-generated post uploads (the original scope)
//   portfolio/  — curated portfolio + Team subfolder
//   about/      — founder portraits and team-wide
//   logo/       — brand marks (read-only-ish, deletion strongly warned)
//   videos/     — top-level videos (hero reel etc.)
//
// Deletion is reference-checked: we scan pages JSON, published-post sidecars,
// active drafts AND every HTML file at repo root + under blog/. If anything
// still uses the file, the UI must ask for ?force=1.

'use strict';

const crypto = require('crypto');
const { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } = require('fs');
const { join, posix } = require('path');
const storage = require('./storage');

const ASSETS_DIR = join(storage.REPO_ROOT, 'assets');
// Scope dedupe to journal uploads only — that's the folder that accumulates
// re-uploaded duplicates. Curated folders like portfolio/ have intentionally
// similar images and shouldn't be auto-merged.
const DEDUPE_PREFIX = '/assets/images/journal/';

function isMediaExt(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ['jpg','jpeg','png','webp','gif','svg','mp4','mov','webm','m4v'].includes(ext);
}
function isVideoExt(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ['mp4','mov','webm','m4v'].includes(ext);
}

function classifySource(relPath) {
  // relPath looks like "images/journal/foo.jpg" or "videos/hero.mp4"
  const parts = relPath.split('/');
  if (parts[0] === 'videos') return 'video';
  if (parts[0] === 'images') {
    if (['journal', 'portfolio', 'about', 'logo'].includes(parts[1])) return parts[1];
    return parts[1] || 'images';
  }
  return parts[0] || 'other';
}

// Recursive walk that yields every media file under ASSETS_DIR.
function listMedia() {
  const out = [];
  function walk(dir, relBase) {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      const rel = relBase ? relBase + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isMediaExt(entry.name)) continue;
      let stat;
      try { stat = statSync(full); } catch { continue; }
      const source = classifySource(rel);
      out.push({
        path: rel,                 // relative under assets/, e.g. "images/portfolio/foo.jpg"
        filename: entry.name,
        url: '/assets/' + rel,
        source,
        type: isVideoExt(entry.name) ? 'video' : 'image',
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }
  walk(ASSETS_DIR, '');
  // Newest first by mtime
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function isSafeRelPath(rel) {
  if (!rel || typeof rel !== 'string') return false;
  if (rel.includes('..') || rel.startsWith('/')) return false;
  // Must live under images/ or videos/
  if (!rel.startsWith('images/') && !rel.startsWith('videos/')) return false;
  return true;
}

// Returns a list of references to the given URL across every text file the
// site maintains. URL form is `/assets/...`. We also accept the leading-slash
// optional variant since some markup uses `assets/...` (no leading slash).
function findReferences(url) {
  const refs = [];
  const noSlash = url.startsWith('/') ? url.slice(1) : url;
  const withSlash = url.startsWith('/') ? url : '/' + url;

  function process(filePath, label, relName) {
    let content;
    try { content = readFileSync(filePath, 'utf8'); } catch { return; }
    if (content.includes(withSlash) || content.includes(noSlash)) {
      refs.push({ source: label, file: relName });
    }
  }

  function walkDir(dir, label, relPrefix, predicate) {
    if (!existsSync(dir)) return;
    let files = [];
    try { files = readdirSync(dir); } catch { return; }
    for (const f of files) {
      if (!predicate(f)) continue;
      process(join(dir, f), label, relPrefix + f);
    }
  }

  // CMS source-of-truth JSONs
  walkDir(storage.pagesDir(), 'pages', 'pages/', f => f.endsWith('.json'));
  walkDir(storage.publishedDir(), 'published', 'admin/published/', f => f.endsWith('.json'));
  walkDir(storage.draftsDir(), 'drafts', 'admin/drafts/', f => f.endsWith('.json'));

  // All HTML at repo root + blog/
  walkDir(storage.REPO_ROOT, 'html', '', f => f.endsWith('.html'));
  walkDir(join(storage.REPO_ROOT, 'blog'), 'blog', 'blog/', f => f.endsWith('.html'));

  return refs;
}

function deleteMedia(relPath) {
  if (!isSafeRelPath(relPath)) throw new Error('Ungültiger Pfad');
  const full = join(ASSETS_DIR, relPath);
  if (!existsSync(full)) throw new Error('Datei nicht gefunden');
  unlinkSync(full);
}

// --- Duplicate detection + consolidation (journal uploads only) -----------

function hashFile(path) {
  const h = crypto.createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function findDuplicates() {
  // Scope dedupe to journal uploads only — portfolio/about/logo are curated,
  // and similar-looking images there are intentional.
  const items = listMedia().filter(it => it.source === 'journal');
  const groups = new Map();
  for (const it of items) {
    let hash;
    try { hash = hashFile(join(ASSETS_DIR, it.path)); }
    catch { continue; }
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(it);
  }
  const dupes = [];
  for (const [hash, members] of groups) {
    if (members.length < 2) continue;
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

function rewriteReferences(replacements) {
  if (!replacements.size) return [];
  const changed = [];
  function process(filePath, relPath) {
    let content;
    try { content = readFileSync(filePath, 'utf8'); } catch { return; }
    let next = content;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    if (next !== content) { writeFileSync(filePath, next); changed.push(relPath); }
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
  walk(storage.pagesDir(), 'pages/', f => f.endsWith('.json'));
  walk(storage.publishedDir(), 'admin/published/', f => f.endsWith('.json'));
  walk(storage.draftsDir(), 'admin/drafts/', f => f.endsWith('.json'));
  walk(storage.REPO_ROOT, '', f => f.endsWith('.html'));
  walk(join(storage.REPO_ROOT, 'blog'), 'blog/', f => f.endsWith('.html'));
  return changed;
}

function consolidateDuplicates() {
  const groups = findDuplicates();
  if (!groups.length) return { groups: 0, filesUpdated: [], filesDeleted: [] };
  const replacements = new Map();
  const toDelete = [];
  for (const g of groups) {
    const canonicalUrl = '/assets/' + g.canonical.path;
    for (const d of g.duplicates) {
      replacements.set('/assets/' + d.path, canonicalUrl);
      toDelete.push(d.path);
    }
  }
  const filesUpdated = rewriteReferences(replacements);
  const filesDeleted = [];
  for (const rel of toDelete) {
    try { unlinkSync(join(ASSETS_DIR, rel)); filesDeleted.push(rel); }
    catch (err) { console.error('[media-dedupe] delete failed', rel, err.message); }
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

    // Consolidate duplicates
    if (req.method === 'POST' && url === '/api/admin/media/dedupe') {
      if (!requireAuth(req, res)) return true;
      try {
        const report = consolidateDuplicates();
        json(res, 200, { ok: true, ...report });
        if (report.filesUpdated && report.filesUpdated.length) {
          syncToGitHub(report.filesUpdated, `Admin: dedupe — rewrite references in ${report.filesUpdated.length} Dateien`);
        }
        if (report.filesDeleted && report.filesDeleted.length) {
          const paths = report.filesDeleted.map(rel => 'assets/' + rel);
          syncDeleteToGitHub(paths, `Admin: dedupe — entferne ${paths.length} Duplikate`);
        }
      } catch (e) {
        console.error('[media-dedupe] error:', e);
        json(res, 500, { error: e.message });
      }
      return true;
    }

    // Reference-check — encoded relative path under assets/
    const refMatch = req.method === 'GET' && url.match(/^\/api\/admin\/media\/([^/]+)\/refs$/);
    if (refMatch) {
      if (!requireAuth(req, res)) return true;
      const relPath = decodeURIComponent(refMatch[1]);
      if (!isSafeRelPath(relPath)) { json(res, 400, { error: 'Ungültiger Pfad' }); return true; }
      const refs = findReferences('/assets/' + relPath);
      json(res, 200, { ok: true, refs });
      return true;
    }

    // Delete
    const delMatch = req.method === 'DELETE' && url.match(/^\/api\/admin\/media\/([^/]+)$/);
    if (delMatch) {
      if (!requireAuth(req, res)) return true;
      const relPath = decodeURIComponent(delMatch[1]);
      if (!isSafeRelPath(relPath)) { json(res, 400, { error: 'Ungültiger Pfad' }); return true; }
      const q = req.url.indexOf('?');
      const params = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1));
      const force = params.get('force') === '1';
      try {
        if (!force) {
          const refs = findReferences('/assets/' + relPath);
          if (refs.length) {
            json(res, 409, { error: 'Datei wird noch referenziert', refs });
            return true;
          }
        }
        deleteMedia(relPath);
        json(res, 200, { ok: true });
        syncDeleteToGitHub(['assets/' + relPath], `Admin: delete media ${relPath}`);
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
