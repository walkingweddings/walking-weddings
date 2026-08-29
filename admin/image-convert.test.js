// Tests fuer die Bildkonvertierung im Journal-Upload.
// Ausfuehren: node admin/image-convert.test.js
//
// Ohne sharp laufen nur die Faelle, die keine Bildbibliothek brauchen —
// genau so verhaelt sich der Upload dann auch: er speichert unveraendert.
'use strict';
const assert = require('assert');
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const conv = require('./image-convert');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('  FEHL-', name, '|', e.message); }
}

const DIR = join(__dirname, '..', 'assets', 'images', 'portfolio');
const jpgs = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).slice(0, 4);

(async () => {
  console.log('sharp aktiv:', conv.isEnabled(), '\n');

  let totalBefore = 0, totalAfter = 0;
  for (const f of (conv.isEnabled() ? jpgs : [])) {
    await t(`konvertiert ${f}`, async () => {
      const buf = readFileSync(join(DIR, f));
      const r = await conv.toWebp(buf, f);
      assert.ok(r.converted, 'nicht konvertiert: ' + r.reason);
      assert.ok(r.filename.endsWith('.webp'), r.filename);
      assert.ok(r.after < r.before, 'nicht kleiner geworden');
      totalBefore += r.before; totalAfter += r.after;
      console.log(`        ${(r.before/1048576).toFixed(2)} MB -> ${(r.after/1048576).toFixed(2)} MB`
        + `  (${Math.round((1-r.after/r.before)*100)} % kleiner, ${r.width}x${r.height})`);
    });
  }
  if (totalBefore) console.log(`\n  Summe: ${(totalBefore/1048576).toFixed(2)} MB -> ${(totalAfter/1048576).toFixed(2)} MB`
    + `  (${Math.round((1-totalAfter/totalBefore)*100)} % gespart)\n`);

  await (conv.isEnabled() ? t : (n) => console.log('  --  -', n, '(uebersprungen, kein sharp)'))('WebP-Ergebnis ist ein gueltiges Bild', async () => {
    const buf = readFileSync(join(DIR, jpgs[0]));
    const r = await conv.toWebp(buf, jpgs[0]);
    // RIFF....WEBP im Kopf
    assert.strictEqual(r.buffer.slice(0, 4).toString('ascii'), 'RIFF');
    assert.strictEqual(r.buffer.slice(8, 12).toString('ascii'), 'WEBP');
  });

  const withSharp = conv.isEnabled() ? t : (n) => console.log('  --  -', n, '(uebersprungen, kein sharp)');

  await withSharp('lange Kante wird auf 2400 px gedeckelt', async () => {
    const sharp = require('sharp');
    const big = await sharp({ create: { width: 5000, height: 3000, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const r = await conv.toWebp(big, 'gross.jpg');
    const meta = await sharp(r.buffer).metadata();
    assert.strictEqual(meta.width, 2400, 'Breite: ' + meta.width);
  });

  await withSharp('kleine Bilder werden nicht hochskaliert', async () => {
    const sharp = require('sharp');
    const small = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#333' } }).jpeg().toBuffer();
    const r = await conv.toWebp(small, 'klein.jpg');
    const meta = await sharp(r.buffer).metadata();
    assert.strictEqual(meta.width, 600);
  });

  for (const [name, why] of [['logo.svg', 'Vektor'], ['anim.gif', 'evtl. animiert'], ['schon.webp', 'schon WebP'], ['film.mp4', 'kein Bild']]) {
    await t(`${name} bleibt unangetastet (${why})`, async () => {
      const r = await conv.toWebp(Buffer.from('egal'), name);
      assert.strictEqual(r.converted, false);
      assert.strictEqual(r.filename, name, 'Dateiname darf sich nicht aendern');
    });
  }

  await t('kaputte Datei wirft nicht, sondern kommt unveraendert zurueck', async () => {
    const junk = Buffer.from('das ist kein bild');
    const r = await conv.toWebp(junk, 'kaputt.jpg');
    assert.strictEqual(r.converted, false);
    assert.strictEqual(r.buffer, junk, 'Original muss erhalten bleiben');
    assert.strictEqual(r.filename, 'kaputt.jpg');
  });

  await (conv.isEnabled() ? t : (n) => console.log('  --  -', n, '(uebersprungen, kein sharp)'))('Dateiname behaelt seinen Stamm', async () => {
    const buf = readFileSync(join(DIR, jpgs[0]));
    const r = await conv.toWebp(buf, 'Karin_und_Jin-042.JPG');
    assert.strictEqual(r.filename, 'Karin_und_Jin-042.webp');
  });

  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
})();
