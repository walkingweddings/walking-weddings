// Pure templating function for the public-page CMS.
//
// Public pages are static HTML with `data-cms-id="<dotted.path>"` attributes
// on every editable element. When the server serves a page, it loads the
// matching pages JSON and replaces:
//   - inner content of any tagged element from `fields[id]`
//   - src + alt + style.object-position of any tagged <img>/<video> from
//     `media[id]`
//
// Missing keys leave the original markup untouched. That gives us a safe
// rollout: annotate now, ship JSON edits over time.
//
// We use targeted regex (not a full HTML parser) for the same reason the
// existing blog grid does — we control every annotation, every editable
// element is a single tag, and the attribute is unique per page. Adding a
// parser dependency would be over-engineering for this scope.

'use strict';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strip a self-closing slash and any trailing whitespace from a void/img/video
// opening tag, returning just attributes between `<TAG` and `>`. We don't need
// this for our tag rebuilding — we rewrite the whole tag — but the helper
// keeps the regex captures clean.
function stripAttrs(attrStr) {
  return String(attrStr || '').replace(/\/\s*$/, '').trim();
}

// Set or replace one attribute inside an attribute string. We prepend a space
// before searching so attributes at the very start of the string still match
// the leading-whitespace anchor (otherwise we'd append a duplicate).
function setAttr(attrStr, name, value) {
  const padded = ' ' + attrStr;
  const re = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*("[^"]*"|'[^']*')`, 'i');
  if (re.test(padded)) {
    return padded.replace(re, ` ${name}="${escapeAttr(value)}"`).replace(/^\s+/, '');
  }
  return `${attrStr} ${name}="${escapeAttr(value)}"`.replace(/\s+/g, ' ').trim();
}

// Update the `style="..."` attribute, setting/replacing a single CSS property.
function setStyleProp(attrStr, prop, value) {
  const styleRe = /\sstyle\s*=\s*("[^"]*"|'[^']*')/i;
  const m = attrStr.match(styleRe);
  if (!m) {
    return `${attrStr} style="${escapeAttr(prop)}: ${escapeAttr(value)}"`.replace(/\s+/g, ' ').trim();
  }
  let existing = m[1].slice(1, -1); // strip the quotes
  const propRe = new RegExp(`(?:^|;)\\s*${escapeRegExp(prop)}\\s*:\\s*[^;]*`, 'i');
  if (propRe.test(existing)) {
    existing = existing.replace(propRe, match => {
      const sep = match.startsWith(';') ? ';' : '';
      return `${sep} ${prop}: ${value}`;
    });
  } else {
    existing = `${existing.replace(/\s*;?\s*$/, '')}; ${prop}: ${value}`;
    existing = existing.replace(/^;\s*/, '');
  }
  return attrStr.replace(styleRe, ` style="${escapeAttr(existing.trim())}"`);
}

// Replace inner content of every <TAG ... data-cms-id="ID" ...>...</TAG>.
// Self-closing void elements are handled by the media pass below — text fields
// must wrap a closing tag, otherwise we have nothing meaningful to substitute.
function applyFieldEdits(html, fields) {
  if (!fields) return html;
  for (const id of Object.keys(fields)) {
    const field = fields[id];
    if (!field || typeof field !== 'object' || field.value == null) continue;
    const newInner = field.type === 'text' ? escapeHtml(field.value) : String(field.value);
    const idEsc = escapeRegExp(id);
    // Match <TAG attrs data-cms-id="ID" attrs>...</TAG> across the whole doc.
    // [\s\S] for cross-line content; [^>]* before/after the data attr keeps
    // us within the same opening tag.
    const re = new RegExp(
      `(<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-cms-id=["']${idEsc}["'][^>]*>)([\\s\\S]*?)(</\\2>)`,
      'g'
    );
    html = html.replace(re, (_, open, _tag, _inner, close) => open + newInner + close);
  }
  return html;
}

// Replace src/alt/object-position/aspect-ratio on every
// <img|video ... data-cms-id="ID" ...>. Both self-closing (`<img />`) and
// unclosed (`<img>`) variants are supported.
//
// When `aspectRatio` is set, the img is forced into that ratio with
// object-fit: cover so object-position becomes meaningful (otherwise the img
// renders at natural ratio and crop has no visible effect).
function applyMediaEdits(html, media) {
  if (!media) return html;
  for (const id of Object.keys(media)) {
    const m = media[id];
    if (!m || typeof m !== 'object') continue;
    const idEsc = escapeRegExp(id);
    const re = new RegExp(
      `<(img|video)\\b([^>]*\\bdata-cms-id=["']${idEsc}["'][^>]*)>`,
      'gi'
    );
    html = html.replace(re, (_match, tag, attrs) => {
      let a = stripAttrs(attrs);
      if (m.url) a = setAttr(a, 'src', m.url);
      if (m.alt != null) a = setAttr(a, 'alt', m.alt);
      if (m.objectPosition) a = setStyleProp(a, 'object-position', m.objectPosition);
      if (m.aspectRatio) {
        a = setStyleProp(a, 'aspect-ratio', m.aspectRatio);
        a = setStyleProp(a, 'object-fit', 'cover');
        a = setStyleProp(a, 'width', '100%');
        a = setStyleProp(a, 'height', 'auto');
      }
      return `<${tag} ${a}>`;
    });
  }
  return html;
}

// Apply width / display / order tweaks to the parent container of a media
// item via `data-cms-tile-id="ID"`. This is how we let editors override
// masonry tile widths for the portfolio without restructuring the HTML —
// the media JSON keeps a single ID, this pass picks up `widthPercent` and
// `order` for the parent. CSS `order` works on flex children (the portfolio
// masonry is `display: flex`), so reordering tiles is a stylesheet-level
// effect, no DOM rewrite needed.
function applyTileEdits(html, media) {
  if (!media) return html;
  for (const id of Object.keys(media)) {
    const m = media[id];
    if (!m || typeof m !== 'object') continue;
    if (m.widthPercent == null && m.order == null) continue;
    const idEsc = escapeRegExp(id);
    const re = new RegExp(
      `<([a-zA-Z][a-zA-Z0-9]*)\\b([^>]*\\bdata-cms-tile-id=["']${idEsc}["'][^>]*)>`,
      'gi'
    );
    html = html.replace(re, (_match, tag, attrs) => {
      let a = stripAttrs(attrs);
      if (m.widthPercent != null) {
        const w = String(m.widthPercent).replace(/%$/, '');
        a = setStyleProp(a, 'width', w + '%');
        // Reset masonry's nth-child margins so the override actually wins.
        a = setStyleProp(a, 'margin-left', 'auto');
        a = setStyleProp(a, 'margin-right', 'auto');
      }
      if (m.order != null) {
        a = setStyleProp(a, 'order', String(m.order));
      }
      return `<${tag} ${a}>`;
    });
  }
  return html;
}

function renderPage(html, pageJson) {
  if (!html || !pageJson || typeof pageJson !== 'object') return html;
  let out = applyFieldEdits(html, pageJson.fields);
  out = applyMediaEdits(out, pageJson.media);
  out = applyTileEdits(out, pageJson.media);
  return out;
}

module.exports = {
  renderPage,
  // exported for unit tests
  _escapeHtml: escapeHtml,
  _setAttr: setAttr,
  _setStyleProp: setStyleProp,
  _applyFieldEdits: applyFieldEdits,
  _applyMediaEdits: applyMediaEdits,
  _applyTileEdits: applyTileEdits,
};
