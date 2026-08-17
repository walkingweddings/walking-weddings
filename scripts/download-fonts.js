#!/usr/bin/env node
// Self-host Google Fonts:
// 1. Fetch the combined Google Fonts CSS (widest weight superset used on any page)
// 2. Extract latin + latin-ext WOFF2 URLs (the two subsets that cover DE/EN + AT/CE names)
// 3. Download each to /home/user/walking-weddings/assets/fonts/
// 4. Emit fonts.css with local URLs
//
// DSGVO: avoids Google seeing every visitor's IP.

'use strict';

const { writeFileSync, mkdirSync } = require('fs');
const { join, basename } = require('path');
const https = require('https');

const FONTS_DIR = require('path').join(__dirname, '..', 'assets', 'fonts');
mkdirSync(FONTS_DIR, { recursive: true });

// Widest superset covering all pages. Verified via `grep -Eho 'href=".*googleapis.*"'`.
// Order matters for readability but is otherwise arbitrary.
const CSS_URL =
  'https://fonts.googleapis.com/css2?' +
  'family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600' +
  '&family=Italiana' +
  '&family=PT+Sans:wght@400;700' +
  '&display=swap';

// Only keep these two subsets. Vienna wedding photography — DE + EN clients,
// occasional CE names. Cyrillic/Vietnamese/Greek subsets ~7 more files, no benefit.
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, opts).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const cssBuf = await fetch(CSS_URL, {
    headers: {
      // Modern browser UA → Google returns WOFF2 URLs (best format for us).
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const css = cssBuf.toString('utf8');

  // Google emits blocks like:
  //   /* latin */
  //   @font-face { font-family: '...'; ... src: url(https://fonts.gstatic.com/.../foo.woff2) format('woff2'); ... }
  // We parse each @font-face separately, keyed by the preceding /* subset */ comment.
  const rebuilt = [];
  const wantedUrls = new Set();
  const blockRe = /\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/gi;
  let m;
  while ((m = blockRe.exec(css))) {
    const [, subset, block] = m;
    if (!KEEP_SUBSETS.has(subset)) continue;
    const urlMatch = block.match(/url\(([^)]+)\)/);
    if (!urlMatch) continue;
    const remoteUrl = urlMatch[1].trim().replace(/^["']|["']$/g, '');
    const filename = basename(remoteUrl);
    wantedUrls.add(remoteUrl + '\t' + filename);
    // Rewrite src → local relative URL (fonts.css sits in assets/fonts/, so bare filename works)
    const localBlock = block.replace(/url\(([^)]+)\)/, `url("${filename}")`);
    rebuilt.push(`/* ${subset} */\n${localBlock}\n`);
  }

  console.log(`Found ${wantedUrls.size} WOFF2 files across ${rebuilt.length} @font-face blocks`);

  let downloaded = 0;
  for (const entry of wantedUrls) {
    const [url, filename] = entry.split('\t');
    const out = join(FONTS_DIR, filename);
    const buf = await fetch(url);
    writeFileSync(out, buf);
    downloaded++;
    process.stdout.write(`  ${downloaded}/${wantedUrls.size}: ${filename} (${buf.length} bytes)\n`);
  }

  // Write the self-hosted fonts.css. Header explains provenance so a future
  // maintainer knows how to regenerate.
  const header =
    `/*\n` +
    ` * Self-hosted Google Fonts (DSGVO: avoids Google seeing every visitor's IP).\n` +
    ` * Regenerate with scripts/download-fonts.js (fetches combined CSS + latin +\n` +
    ` * latin-ext WOFF2 subsets from fonts.googleapis.com).\n` +
    ` * Do not edit by hand.\n` +
    ` */\n\n`;
  writeFileSync(join(FONTS_DIR, 'fonts.css'), header + rebuilt.join('\n'));
  console.log('Wrote fonts.css');
}

main().catch(err => { console.error(err); process.exit(1); });
