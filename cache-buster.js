// Automatic cache-busting for JS/CSS assets referenced from HTML.
//
// When we change assets/js/*.js or assets/css/**/*.css, browsers need to
// re-fetch — otherwise iOS Safari and friends happily serve the cached copy
// forever. Instead of manually bumping ?v= in every HTML file after every
// change, we rewrite <script> and <link> tags on-the-fly, appending
// ?v=<hash> where the hash is derived from the asset file's mtime + size.
//
// The asset URL therefore only changes when the underlying file changes.
// Browsers cache each version under its own URL, and pick up new builds
// automatically on the next HTML request.

const { statSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname);
const _cache = new Map();

function versionForAsset(relPath) {
  try {
    const full = join(ROOT, relPath);
    const stat = statSync(full);
    const cached = _cache.get(relPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.version;
    }
    // Base36 of mtime-seconds + base36 of size is compact and collision-safe
    // for our purposes (same file → same version, any edit → new version).
    const version = Math.floor(stat.mtimeMs / 1000).toString(36) + stat.size.toString(36);
    _cache.set(relPath, { mtimeMs: stat.mtimeMs, size: stat.size, version });
    return version;
  } catch {
    return null;
  }
}

// Rewrites <script src="…/assets/js/foo.js"> and <link href="…/assets/css/foo.css">
// to include ?v=<hash>. Any existing ?v=… is replaced.
function addCacheBusters(html) {
  return String(html || '').replace(
    /(<(?:script|link)\b[^>]*?\b(?:src|href)=")((?:(?:\.\.\/)+|\/)?assets\/(?:js|css)\/[^"?]+\.(?:js|css))(?:\?[^"]*)?(")/gi,
    (match, pre, assetUrl, post) => {
      // Strip any leading ../ or / so we can statSync relative to repo root.
      const clean = assetUrl.replace(/^(?:\.\.\/|\/)+/, '');
      const v = versionForAsset(clean);
      if (!v) return match;
      return pre + assetUrl + '?v=' + v + post;
    }
  );
}

module.exports = { versionForAsset, addCacheBusters };
