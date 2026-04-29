// Pages CMS API — list/get/patch the public-page content JSON, plus a
// preview endpoint that renders the live page with the current content
// PLUS the preview-editor injected, so the admin iframe can drive
// inline edits via postMessage.
//
// All routes are auth-gated. Slugs are validated against pages-registry,
// so we never read or write arbitrary paths.

'use strict';

const { readFileSync, writeFileSync, existsSync, statSync } = require('fs');
const { join } = require('path');
const { renderPage } = require('./page-template');
const { PAGES, findBySlug } = require('./pages-registry');
const storage = require('./storage');

function emptyDoc() {
  return { _schemaVersion: 1, _updatedAt: 0, fields: {}, media: {} };
}

function loadPageJson(slug) {
  const p = join(storage.pagesDir(), `${slug}.json`);
  if (!existsSync(p)) return emptyDoc();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Object.assign(emptyDoc(), parsed);
  } catch {
    return emptyDoc();
  }
}

function savePageJson(slug, doc) {
  const p = join(storage.pagesDir(), `${slug}.json`);
  doc._schemaVersion = 1;
  doc._updatedAt = Date.now();
  writeFileSync(p, JSON.stringify(doc, null, 2));
}

// `value` is a string for fields. `media` updates carry
// url / alt / objectPosition / aspectRatio / widthPercent. All optional —
// partial media updates let the editor tweak one property at a time
// (e.g. just the focal point or just the tile width).
//
// Setting a property to `null` (not `undefined`) explicitly clears it; this is
// how the "Auto" / reset buttons in the inline editor remove an override.
function applyPatch(doc, patch) {
  if (patch.fieldId) {
    const id = String(patch.fieldId);
    const type = patch.fieldType === 'text' ? 'text' : 'html';
    doc.fields[id] = { type, value: String(patch.value == null ? '' : patch.value) };
    return;
  }
  if (patch.mediaId) {
    const id = String(patch.mediaId);
    const cur = doc.media[id] || { type: 'image' };
    if (patch.url != null) cur.url = String(patch.url);
    if (patch.alt != null) cur.alt = String(patch.alt);
    if (patch.objectPosition != null) cur.objectPosition = String(patch.objectPosition);
    if (patch.mediaType) cur.type = String(patch.mediaType);
    if ('aspectRatio' in patch) {
      if (patch.aspectRatio === null || patch.aspectRatio === '') delete cur.aspectRatio;
      else cur.aspectRatio = String(patch.aspectRatio);
    }
    if ('widthPercent' in patch) {
      if (patch.widthPercent === null || patch.widthPercent === '') delete cur.widthPercent;
      else cur.widthPercent = String(patch.widthPercent);
    }
    doc.media[id] = cur;
    return;
  }
  throw new Error('Patch braucht entweder fieldId oder mediaId');
}

function listPages() {
  return PAGES.map(p => {
    const file = join(storage.pagesDir(), `${p.slug}.json`);
    let updatedAt = 0;
    if (existsSync(file)) {
      try { updatedAt = statSync(file).mtimeMs | 0; } catch {}
    }
    return {
      slug: p.slug,
      title: p.title,
      eyebrow: p.eyebrow || '',
      description: p.description || '',
      sections: p.sections || [],
      url: '/' + p.file,
      updatedAt,
    };
  });
}

function injectPreviewExtras(html, opts) {
  // <base href="/"> ensures relative asset URLs (../assets/css/…) resolve to
  // the public site root rather than to /api/admin/preview/page/<slug>/.
  // <meta name="cms-mode" content="page"> tells preview-editor.js to use the
  // page-mode (data-cms-id) handlers instead of the post-mode selectors.
  let out = html.replace(
    /<head>/i,
    `<head>\n  <base href="/">\n  <meta name="cms-mode" content="page">`
  );
  if (opts.editorJs) {
    out = out.replace(/<\/body>/i, `<script>\n${opts.editorJs}\n</script>\n</body>`);
  }
  return out;
}

// Build the route handler. Dependencies are injected from server.js so we
// don't duplicate auth/HTTP boilerplate.
function makeHandler(deps) {
  const {
    json, readJson, requireAuth, getQueryParam, verifyToken,
    syncToGitHub, REPO_ROOT, addCacheBusters, getPreviewEditorJs,
  } = deps;

  return async function handle(req, res, url) {
    // List
    if (req.method === 'GET' && url === '/api/admin/pages') {
      if (!requireAuth(req, res)) return true;
      json(res, 200, { ok: true, pages: listPages() });
      return true;
    }

    // Get one
    const getMatch = req.method === 'GET' && url.match(/^\/api\/admin\/pages\/([a-z0-9-]+)$/);
    if (getMatch) {
      if (!requireAuth(req, res)) return true;
      const slug = getMatch[1];
      if (!findBySlug(slug)) { json(res, 404, { error: 'Seite nicht gefunden' }); return true; }
      json(res, 200, { ok: true, slug, doc: loadPageJson(slug) });
      return true;
    }

    // Patch one (single field or single media item per call — keeps each
    // commit small and lets us drive the queue from the inline editor).
    const patchMatch = req.method === 'PATCH' && url.match(/^\/api\/admin\/pages\/([a-z0-9-]+)$/);
    if (patchMatch) {
      if (!requireAuth(req, res)) return true;
      const slug = patchMatch[1];
      if (!findBySlug(slug)) { json(res, 404, { error: 'Seite nicht gefunden' }); return true; }
      try {
        const body = await readJson(req);
        const doc = loadPageJson(slug);
        applyPatch(doc, body);
        savePageJson(slug, doc);
        json(res, 200, { ok: true, doc });
        const which = body.fieldId || body.mediaId;
        syncToGitHub([`admin/pages/${slug}.json`], `Admin: edit page ${slug}/${which}`);
      } catch (e) {
        console.error('[pages-api] patch error:', e);
        json(res, 500, { error: e.message });
      }
      return true;
    }

    // Preview — renders the actual public page with current content + injected
    // preview-editor. Token comes from query so the iframe can load it without
    // setting a Bearer header.
    const previewMatch = req.method === 'GET' && url.match(/^\/api\/admin\/preview\/page\/([a-z0-9-]+)$/);
    if (previewMatch) {
      const token = getQueryParam(req, 'token');
      if (!verifyToken(token)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' }); res.end('Unauthorized'); return true;
      }
      const slug = previewMatch[1];
      const meta = findBySlug(slug);
      if (!meta) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Page not found'); return true; }
      const filePath = join(REPO_ROOT, meta.file);
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Source HTML missing'); return true;
      }
      let html = readFileSync(filePath, 'utf8');
      const doc = loadPageJson(slug);
      html = renderPage(html, doc);
      html = injectPreviewExtras(html, { editorJs: getPreviewEditorJs() });
      html = addCacheBusters(html);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
      return true;
    }

    return false;
  };
}

module.exports = {
  makeHandler,
  loadPageJson,
  savePageJson,
  listPages,
  // exported for tests / direct use
  _emptyDoc: emptyDoc,
  _applyPatch: applyPatch,
};
