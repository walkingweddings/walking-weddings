// Lightweight unit tests for the i18n layer. Run: node admin/i18n.test.js
'use strict';
const assert = require('assert');
const i18n = require('./i18n');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- applyI18n: text ---
t('text inner is replaced by dict value (with inline HTML preserved)', () => {
  const html = '<h2 data-cms-id="x" data-i18n="home.h">Deutsch <em>x</em></h2>';
  const out = i18n.applyI18n(html, { 'home.h': 'English <em>y</em>' });
  assert.strictEqual(out, '<h2 data-cms-id="x" data-i18n="home.h">English <em>y</em></h2>');
});

t('missing key leaves original text untouched', () => {
  const html = '<p data-i18n="nope">Deutsch</p>';
  assert.strictEqual(i18n.applyI18n(html, {}), html);
});

// --- applyI18n: attributes ---
t('data-i18n-attr translates listed attributes, keeps the leading space', () => {
  const html = '<input data-i18n-attr="placeholder:k" placeholder="de">';
  const out = i18n.applyI18n(html, { k: 'EN ph' });
  assert.ok(out.includes('<input '), 'tag name must keep a space after it');
  assert.ok(out.includes('placeholder="EN ph"'));
});

t('data-i18n= does not collide with data-i18n-attr=', () => {
  const html = '<meta name="description" data-i18n-attr="content:m.d" content="de">';
  const out = i18n.applyI18n(html, { 'm.d': 'EN desc' });
  assert.ok(out.includes('content="EN desc"'));
});

// --- localizeLinks ---
t('internal .html links become /en/ absolute', () => {
  const out = i18n.localizeLinks('<a href="about.html">x</a>', '/index.html');
  assert.ok(out.includes('href="/en/about.html"'));
});

t('../ links resolve relative to the page dir', () => {
  const out = i18n.localizeLinks('<a href="../index.html">x</a>', '/blog/p.html');
  assert.ok(out.includes('href="/en/index.html"'));
});

t('asset paths become absolute /assets', () => {
  const out = i18n.localizeLinks('<img src="assets/a.jpg"><link href="../assets/b.css">', '/blog/p.html');
  assert.ok(out.includes('src="/assets/a.jpg"'));
  assert.ok(out.includes('href="/assets/b.css"'));
});

t('inline url(assets/…) is rewritten', () => {
  const out = i18n.localizeLinks(`<div style="background:url('assets/x.jpg')"></div>`, '/index.html');
  assert.ok(out.includes("url('/assets/x.jpg')"));
});

t('external / mailto / tel / anchor are untouched', () => {
  const html = '<a href="https://x.com/c.html">a</a><a href="mailto:a@b.com">b</a><a href="tel:+1">c</a><a href="#frag">d</a>';
  assert.strictEqual(i18n.localizeLinks(html, '/index.html'), html);
});

t('already-/en and already-/assets are not double-prefixed', () => {
  const html = '<a href="/en/about.html">a</a><img src="/assets/x.jpg">';
  assert.strictEqual(i18n.localizeLinks(html, '/index.html'), html);
});

// --- setHtmlLang ---
t('setHtmlLang flips de→en', () => {
  assert.ok(i18n.setHtmlLang('<html lang="de">', 'en').includes('lang="en"'));
});

// --- injectHreflang: dedupe + reciprocal ---
t('injectHreflang replaces existing canonical and adds alternates', () => {
  const html = '<head><link rel="canonical" href="https://walkingweddings.com/about.html"></head>';
  const out = i18n.injectHreflang(html, { logicalPath: '/about.html', locale: 'en', siteUrl: 'https://walkingweddings.com' });
  assert.strictEqual((out.match(/rel="canonical"/g) || []).length, 1, 'exactly one canonical');
  assert.ok(out.includes('href="https://walkingweddings.com/en/about.html"'));
  assert.ok(out.includes('hreflang="de"') && out.includes('hreflang="en"') && out.includes('hreflang="x-default"'));
});

t('canonPath collapses /index.html to /', () => {
  assert.strictEqual(i18n._canonPath('/index.html'), '/');
});

// --- injectHreflang: og:url follows the canonical ---
t('og:url is rewritten to the EN canonical on /en/ pages', () => {
  const html = '<head><meta property="og:url" content="https://www.walkingweddings.com/about.html"></head>';
  const out = i18n.injectHreflang(html, {
    logicalPath: '/about.html', locale: 'en', siteUrl: 'https://www.walkingweddings.com',
  });
  assert.ok(out.includes('content="https://www.walkingweddings.com/en/about.html"'));
  assert.ok(!out.includes('content="https://www.walkingweddings.com/about.html"'));
  assert.strictEqual((out.match(/property="og:url"/g) || []).length, 1, 'exactly one og:url');
});

t('og:url keeps the DE URL on German pages', () => {
  const html = '<head><meta property="og:url" content="https://walkingweddings.com/about.html"></head>';
  const out = i18n.injectHreflang(html, {
    logicalPath: '/about.html', locale: 'de', siteUrl: 'https://www.walkingweddings.com',
  });
  assert.ok(out.includes('content="https://www.walkingweddings.com/about.html"'), 'host normalised to www');
});

t('og:url is rewritten regardless of attribute order', () => {
  const html = `<meta content='https://www.walkingweddings.com/x.html' property="og:url">`;
  const out = i18n.injectHreflang(html, {
    logicalPath: '/x.html', locale: 'en', siteUrl: 'https://www.walkingweddings.com',
  });
  assert.ok(out.includes('content="https://www.walkingweddings.com/en/x.html"'));
});

t('a page without og:url does not gain one', () => {
  const out = i18n.injectHreflang('<head><title>x</title></head>', {
    logicalPath: '/404.html', locale: 'de', siteUrl: 'https://www.walkingweddings.com',
  });
  assert.ok(!out.includes('og:url'));
});

t('og:image and other og tags are left alone', () => {
  const html = '<meta property="og:image" content="https://www.walkingweddings.com/a.webp">';
  const out = i18n.injectHreflang(html, {
    logicalPath: '/about.html', locale: 'en', siteUrl: 'https://www.walkingweddings.com',
  });
  assert.ok(out.includes('content="https://www.walkingweddings.com/a.webp"'));
});

// --- injectHreflang: hasEn ---
t('without an English version the /en/ URL canonicalises to the German one', () => {
  const out = i18n.injectHreflang('<head></head>', {
    logicalPath: '/blog/x.html', locale: 'en', siteUrl: 'https://www.walkingweddings.com', hasEn: false,
  });
  assert.ok(out.includes('rel="canonical" href="https://www.walkingweddings.com/blog/x.html"'));
  assert.ok(!out.includes('hreflang='), 'no alternates when there is only one language');
});

t('without an English version the German page emits no alternates either', () => {
  const out = i18n.injectHreflang('<head></head>', {
    logicalPath: '/blog/x.html', locale: 'de', siteUrl: 'https://www.walkingweddings.com', hasEn: false,
  });
  assert.ok(out.includes('rel="canonical" href="https://www.walkingweddings.com/blog/x.html"'));
  assert.ok(!out.includes('hreflang='));
});

t('hasEn defaults to true so existing callers keep the full alternate set', () => {
  const out = i18n.injectHreflang('<head></head>', {
    logicalPath: '/blog/x.html', locale: 'en', siteUrl: 'https://www.walkingweddings.com',
  });
  assert.ok(out.includes('rel="canonical" href="https://www.walkingweddings.com/en/blog/x.html"'));
  assert.ok(out.includes('hreflang="de"') && out.includes('hreflang="en"') && out.includes('hreflang="x-default"'));
});

t('og:url follows the German canonical when there is no English version', () => {
  const html = '<meta property="og:url" content="https://www.walkingweddings.com/blog/x.html">';
  const out = i18n.injectHreflang(html, {
    logicalPath: '/blog/x.html', locale: 'en', siteUrl: 'https://www.walkingweddings.com', hasEn: false,
  });
  assert.ok(out.includes('content="https://www.walkingweddings.com/blog/x.html"'));
});

// --- applyI18nJsonLd (via applyI18n) ---
t('JSON-LD: an annotated path is translated, everything else is left alone', () => {
  const html = '<script type="application/ld+json" data-i18n-json="description:s.d">\n' +
    '{"@type":"LocalBusiness","name":"Walking Weddings","description":"Deutsch"}\n</script>';
  const out = i18n.applyI18n(html, { 's.d': 'English' });
  const json = JSON.parse(out.match(/>([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(json.description, 'English');
  assert.strictEqual(json.name, 'Walking Weddings', 'the business name is not translated');
  assert.strictEqual(json['@type'], 'LocalBusiness');
});

t('JSON-LD: array indices address list entries', () => {
  const html = '<script type="application/ld+json" data-i18n-json="0.name:a; 1.name:b">\n' +
    '[{"name":"eins"},{"name":"zwei"}]\n</script>';
  const out = i18n.applyI18n(html, { a: 'one', b: 'two' });
  const json = JSON.parse(out.match(/>([\s\S]*?)<\/script>/)[1]);
  assert.deepStrictEqual(json.map(v => v.name), ['one', 'two']);
});

t('JSON-LD: a missing dict key leaves that value German', () => {
  const html = '<script type="application/ld+json" data-i18n-json="description:nope">\n' +
    '{"description":"Deutsch"}\n</script>';
  assert.strictEqual(i18n.applyI18n(html, {}), html, 'block returned untouched');
});

t('JSON-LD: an unknown path never invents a field', () => {
  const html = '<script type="application/ld+json" data-i18n-json="nichtDa:k">\n{"a":1}\n</script>';
  const out = i18n.applyI18n(html, { k: 'x' });
  assert.strictEqual(out, html);
});

t('JSON-LD: invalid JSON is left as-is instead of throwing', () => {
  const html = '<script type="application/ld+json" data-i18n-json="a:k">\n{kaputt\n</script>';
  assert.strictEqual(i18n.applyI18n(html, { k: 'x' }), html);
});

t('JSON-LD: a value containing </script> cannot break out of the block', () => {
  const html = '<script type="application/ld+json" data-i18n-json="d:k">\n{"d":"x"}\n</script>';
  const out = i18n.applyI18n(html, { k: 'a</script><script>alert(1)</script>' });
  assert.strictEqual((out.match(/<\/script>/gi) || []).length, 1, 'still exactly one closing tag');
  assert.ok(!out.includes('<script>alert'), 'no injected tag');
  assert.strictEqual(JSON.parse(out.match(/>([\s\S]*?)<\/script>/)[1]).d, 'a</script><script>alert(1)</script>');
});

t('JSON-LD: an unannotated block is untouched', () => {
  const html = '<script type="application/ld+json">\n{"description":"Deutsch"}\n</script>';
  assert.strictEqual(i18n.applyI18n(html, { 's.d': 'English' }), html);
});

t('data-i18n-json does not collide with data-i18n / data-i18n-attr', () => {
  const html = '<script type="application/ld+json" data-i18n-json="d:k">\n{"d":"de"}\n</script>';
  const out = i18n.applyI18n(html, { k: 'en', 'd:k': 'WRONG' });
  assert.ok(!out.includes('WRONG'));
  assert.strictEqual(JSON.parse(out.match(/>([\s\S]*?)<\/script>/)[1]).d, 'en');
});

// --- renderLangSwitch ---
t('renderLangSwitch injects crawlable mirror links before </footer>', () => {
  const out = i18n.renderLangSwitch('<footer>x</footer>', { logicalPath: '/about.html', locale: 'de' });
  assert.ok(out.includes('href="/about.html"') && out.includes('href="/en/about.html"'));
  assert.ok(out.indexOf('lang-switch') < out.indexOf('</footer>'));
});

console.log(`\n${passed} i18n tests passed.`);
