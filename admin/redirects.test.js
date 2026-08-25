// Unit tests for the legacy WordPress redirect map. Run: node admin/redirects.test.js
//
// The important one is "every target resolves to a file that exists": a 301
// into a 404 is worse for a ranked legacy URL than no redirect at all, and
// nothing else in the setup notices when a target slug is renamed or dropped.
'use strict';
const assert = require('assert');
const { existsSync, statSync } = require('fs');
const { join } = require('path');
const { resolveRedirect, _MAP } = require('./redirects');

const ROOT = join(__dirname, '..');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Mirrors the path→file resolution in serve.js: /en/<x> renders the same source
// file as /<x>, and a directory path means index.html.
function resolvesToFile(urlPath) {
  let p = urlPath.replace(/^\/en(?=\/|$)/, '') || '/';
  if (p === '/') p = '/index.html';
  else if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  return existsSync(f) && statSync(f).isFile();
}

// --- the guard ---
t('every redirect target resolves to an existing file', () => {
  const broken = Object.entries(_MAP)
    .filter(([, to]) => !resolvesToFile(to))
    .map(([from, to]) => `${from} -> ${to}`);
  assert.deepStrictEqual(broken, [], `301 into a 404:\n  ${broken.join('\n  ')}`);
});

t('no redirect target is itself redirected (no chains)', () => {
  const chained = Object.entries(_MAP)
    .filter(([, to]) => resolveRedirect(to) !== null)
    .map(([from, to]) => `${from} -> ${to} -> ${resolveRedirect(to)}`);
  assert.deepStrictEqual(chained, [], `redirect chain:\n  ${chained.join('\n  ')}`);
});

t('every /en/ mapping has a /de/ counterpart and vice versa', () => {
  const slugs = (prefix) => Object.keys(_MAP)
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length));
  assert.deepStrictEqual(slugs('/en/').sort(), slugs('/de/').sort());
});

// --- resolver behaviour ---
t('exact mappings resolve', () => {
  assert.strictEqual(resolveRedirect('/en/home/'), '/en/');
  assert.strictEqual(resolveRedirect('/de/home/'), '/');
  assert.strictEqual(resolveRedirect('/en/portrait-station-2/'), '/en/packages.html');
});

t('trailing slash is tolerated in both directions', () => {
  assert.strictEqual(resolveRedirect('/en/about'), '/en/about.html');
  assert.strictEqual(resolveRedirect('/en/about/'), '/en/about.html');
});

t('unknown legacy paths fall back to the language home', () => {
  assert.strictEqual(resolveRedirect('/en/was-auch-immer/'), '/en/');
  assert.strictEqual(resolveRedirect('/de/was-auch-immer/'), '/');
  assert.strictEqual(resolveRedirect('/de'), '/');
});

t('new URLs are never caught', () => {
  assert.strictEqual(resolveRedirect('/en/about.html'), null);
  assert.strictEqual(resolveRedirect('/about.html'), null);
  assert.strictEqual(resolveRedirect('/en/'), null);
  assert.strictEqual(resolveRedirect('/en'), null);
  assert.strictEqual(resolveRedirect('/'), null);
  assert.strictEqual(resolveRedirect('/blog/jennise-florian-triest.html'), null);
});

console.log(`\n${passed} redirect tests passed.`);
