// Server-side i18n layer for the public site.
//
// German is the source: every public page is authored in German and (for
// registered pages) gets CMS edits applied first. English is an OVERLAY served
// under /en/ URLs. We never duplicate HTML files — the same source file is
// rendered twice: once as-is for German, once with an English pass for
// /en/<path>.
//
// Why server-side and not a client toggle: English must be crawlable and
// separately indexable (own URLs + hreflang + <title>/meta). A JS toggle would
// leave Google seeing only German.
//
// The text/attribute substitution reuses the exact targeted-regex approach of
// admin/page-template.js — we control every annotation (`data-i18n` /
// `data-i18n-attr`), each translatable element is a single tag, so a full HTML
// parser would be over-engineering.

'use strict';

const { readFileSync, statSync } = require('fs');
const { join } = require('path');

const I18N_DIR = join(__dirname, 'i18n');
const EN_FILE = join(I18N_DIR, 'en.json');          // static pages — hand-translated
const POSTS_FILE = join(I18N_DIR, 'posts.en.json'); // blog cards — written at publish

// ---------------------------------------------------------------------------
// Dictionary loading (mtime-cached; posts.en.json is rewritten by the journal
// publish flow, so we must pick up changes without a restart).
// ---------------------------------------------------------------------------

let _cache = { sig: '', dict: {} };

function fileSig(path) {
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; }
  catch { return '0'; }
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return {}; }
}

// Merged English dictionary { key: htmlOrText }. Static keys (en.json) and
// machine-written blog keys (posts.en.json) live in separate files and use
// disjoint namespaces, so a flat merge is safe.
function getEnDict() {
  const sig = fileSig(EN_FILE) + '|' + fileSig(POSTS_FILE);
  if (sig !== _cache.sig) {
    _cache = { sig, dict: Object.assign({}, readJsonSafe(EN_FILE), readJsonSafe(POSTS_FILE)) };
  }
  return _cache.dict;
}

// ---------------------------------------------------------------------------
// Small string helpers (mirrors page-template.js)
// ---------------------------------------------------------------------------

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function setAttr(attrStr, name, value) {
  const padded = ' ' + attrStr;
  const re = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*("[^"]*"|'[^']*')`, 'i');
  if (re.test(padded)) {
    return padded.replace(re, ` ${name}="${escapeAttr(value)}"`).replace(/^\s+/, '');
  }
  return `${attrStr} ${name}="${escapeAttr(value)}"`;
}

// ---------------------------------------------------------------------------
// Pass 1 — translate text + attributes via data-i18n / data-i18n-attr
// ---------------------------------------------------------------------------

function applyI18n(html, dict) {
  if (!html || !dict) return html;

  // Inner-HTML replacement for <TAG ... data-i18n="key" ...>...</TAG>.
  // `data-i18n=` (with the `=`) never matches `data-i18n-attr=`, so the two
  // annotations don't collide.
  html = html.replace(
    /(<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\bdata-i18n=["']([^"']+)["'][^>]*>)([\s\S]*?)(<\/\2>)/g,
    (match, open, _tag, key, _inner, close) => {
      const val = dict[key];
      return val == null ? match : open + val + close;
    }
  );

  // Attribute replacement: data-i18n-attr="placeholder:key; aria-label:key; alt:key"
  html = html.replace(
    /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*\bdata-i18n-attr=["']([^"']+)["'][^>]*)>/g,
    (match, tag, attrs, spec) => {
      let a = attrs;
      for (const pair of spec.split(';')) {
        const idx = pair.indexOf(':');
        if (idx === -1) continue;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (!attr || !key) continue;
        const val = dict[key];
        if (val == null) continue;
        a = setAttr(a, attr, val);
      }
      // Normalise to exactly one space after the tag name — setAttr may strip
      // the leading whitespace of the captured attribute string.
      return `<${tag} ${a.replace(/^\s+/, '')}>`;
    }
  );

  return html;
}

// ---------------------------------------------------------------------------
// Pass 2 — rewrite links for the /en/ tree
//   * internal .html links  → absolute /en/<resolved>
//   * asset refs (assets/…, ../assets/…) → absolute /assets/…
//   * inline style url(assets/…) too
//   * external / mailto / tel / #anchor / already-/en/ → untouched
// Absolute /assets/ is depth-independent (works for /en/x.html AND
// /en/blog/x.html) — far more robust than juggling ../ prefixes.
// ---------------------------------------------------------------------------

function normalizePath(p) {
  const isAbs = p.startsWith('/');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return (isAbs ? '/' : '') + out.join('/');
}

function rewriteUrl(val, logicalPath, ctx) {
  if (!val) return val;
  const v = val.trim();
  if (/^(https?:|\/\/|mailto:|tel:|data:|#)/i.test(v)) return val;

  // Asset paths → absolute /assets/…
  const am = v.match(/^(?:\.\.\/)*\/?(assets\/.*)$/i);
  if (am) return '/' + am[1];
  if (/^\/assets\//i.test(v)) return val;

  // url() in CSS only ever needs the asset fix above.
  if (ctx !== 'attr') return val;

  // Internal page links — only .html targets get the /en/ prefix.
  const m = v.match(/^([^?#]*)([?#].*)?$/);
  const path = m[1];
  const suffix = m[2] || '';
  if (!/\.html$/i.test(path)) return val;
  if (/^\/en(\/|$)/i.test(path)) return val;

  let abs;
  if (path.startsWith('/')) abs = path;
  else {
    const dir = logicalPath.replace(/[^/]*$/, ''); // strip filename, keep dir
    abs = normalizePath(dir + path);
  }
  return '/en' + abs + suffix;
}

function localizeLinks(html, logicalPath) {
  if (!html) return html;
  // href / src attribute values
  html = html.replace(/\b(href|src)=("|')([^"']*)\2/gi, (match, attr, q, val) => {
    const nv = rewriteUrl(val, logicalPath, 'attr');
    return nv === val ? match : `${attr}=${q}${nv}${q}`;
  });
  // url(...) inside inline styles
  html = html.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, q, val) => {
    const nv = rewriteUrl(val, logicalPath, 'css');
    return nv === val ? match : `url(${q}${nv}${q})`;
  });
  return html;
}

// ---------------------------------------------------------------------------
// <html lang>
// ---------------------------------------------------------------------------

function setHtmlLang(html, lang) {
  if (!html) return html;
  if (/<html\b[^>]*\blang=/i.test(html)) {
    return html.replace(/(<html\b[^>]*\blang=)("|')[^"']*\2/i, `$1$2${lang}$2`);
  }
  return html.replace(/<html\b/i, `<html lang="${lang}"`);
}

// ---------------------------------------------------------------------------
// canonical + hreflang. Single source of truth: strip any existing canonical /
// alternate links first, then emit the locale-correct set. Reciprocal on both
// DE and EN, x-default → DE.
// ---------------------------------------------------------------------------

function canonPath(p) {
  return (p || '/').replace(/\/index\.html$/i, '/');
}

function injectHreflang(html, { logicalPath, locale, siteUrl }) {
  if (!html) return html;
  const path = canonPath(logicalPath);
  const base = String(siteUrl || '').replace(/\/$/, '');
  const deUrl = base + path;
  const enUrl = base + '/en' + (path === '/' ? '/' : path);
  const canonical = locale === 'en' ? enUrl : deUrl;

  // Remove pre-existing canonical + hreflang alternates to avoid duplicates.
  html = html
    .replace(/[ \t]*<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/[ \t]*<link\b[^>]*\bhreflang=["'][^"']*["'][^>]*>\s*/gi, '');

  const block =
    `  <link rel="canonical" href="${canonical}">\n` +
    `  <link rel="alternate" hreflang="de" href="${deUrl}">\n` +
    `  <link rel="alternate" hreflang="en" href="${enUrl}">\n` +
    `  <link rel="alternate" hreflang="x-default" href="${deUrl}">\n`;

  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, block + '</head>');
  return block + html;
}

// ---------------------------------------------------------------------------
// Language switch — real crawlable <a> links to the mirror URL. Inserted before
// the last </footer> (no per-page placeholder needed).
// ---------------------------------------------------------------------------

function renderLangSwitch(html, { logicalPath, locale }) {
  if (!html) return html;
  const path = canonPath(logicalPath);
  const deHref = path;
  const enHref = '/en' + (path === '/' ? '/' : path);
  const cls = (l) => 'lang-switch__btn' + (locale === l ? ' is-active' : '');
  const cur = (l) => (locale === l ? ' aria-current="true"' : '');
  const block =
    `<div class="lang-switch">` +
    `<a href="${deHref}" class="${cls('de')}" hreflang="de"${cur('de')}>DE</a>` +
    `<span class="lang-switch__sep" aria-hidden="true">/</span>` +
    `<a href="${enHref}" class="${cls('en')}" hreflang="en"${cur('en')}>EN</a>` +
    `</div>`;

  const idx = html.lastIndexOf('</footer>');
  if (idx !== -1) return html.slice(0, idx) + block + html.slice(idx);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, block + '</body>');
  return html + block;
}

module.exports = {
  getEnDict,
  applyI18n,
  localizeLinks,
  setHtmlLang,
  injectHreflang,
  renderLangSwitch,
  // exported for unit tests
  _rewriteUrl: rewriteUrl,
  _normalizePath: normalizePath,
  _setAttr: setAttr,
  _canonPath: canonPath,
};
