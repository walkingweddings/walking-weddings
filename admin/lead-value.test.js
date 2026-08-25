// Unit-Tests fuer die Lead-Bewertung. Ausfuehren: node admin/lead-value.test.js
//
// Diese Zahlen steuern, worauf Meta die Kampagne optimiert. Ein stiller Fehler
// hier faellt niemandem auf — die Anzeigen werden einfach schlechter. Deshalb
// sind vor allem die Reihenfolge der Quellen und die Plausibilitaetsgrenzen
// abgesichert.
'use strict';
const assert = require('assert');
const lv = require('./lead-value');
const { parseBudget } = lv._internals;

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- Pakete ---
t('jedes Paket bekommt seinen Preis', () => {
  assert.strictEqual(lv.leadValue({ package: 'The Day' }).value, 4680);
  assert.strictEqual(lv.leadValue({ package: 'The Story' }).value, 6680);
  assert.strictEqual(lv.leadValue({ package: 'The Legacy' }).value, 9000);
});

t('die Rangfolge der Pakete stimmt — darauf kommt es dem Algorithmus an', () => {
  const day = lv.leadValue({ package: 'The Day' }).value;
  const story = lv.leadValue({ package: 'The Story' }).value;
  const legacy = lv.leadValue({ package: 'The Legacy' }).value;
  assert.ok(day < story, 'The Day muss unter The Story liegen');
  assert.ok(story < legacy, 'The Story muss unter The Legacy liegen');
});

t('Waehrung ist ueberall EUR', () => {
  for (const p of ['The Day', 'The Story', 'The Legacy', 'unbekannt']) {
    assert.strictEqual(lv.leadValue({ package: p }).currency, 'EUR');
  }
});

t('ein Paket schlaegt das Budgetfeld', () => {
  const r = lv.leadValue({ package: 'The Legacy', budget: '1.000 EUR' });
  assert.strictEqual(r.value, 9000);
  assert.strictEqual(r.source, 'package');
});

t('ein unbekannter Paketname faellt durch, statt zu raten', () => {
  const r = lv.leadValue({ package: 'The Platinum Deluxe' });
  assert.strictEqual(r.value, lv.DEFAULT_VALUE);
  assert.strictEqual(r.source, 'default');
});

t('Paketnamen werden nicht per Praefix erraten', () => {
  // "The Day" darf nicht auf "The Days of Summer" passen.
  assert.strictEqual(lv.leadValue({ package: 'The Days of Summer' }).source, 'default');
});

t('geerbte Objekteigenschaften gelten nicht als Paket', () => {
  // Ohne hasOwnProperty waere "constructor" ein Treffer und value undefined.
  assert.strictEqual(lv.leadValue({ package: 'constructor' }).source, 'default');
  assert.strictEqual(lv.leadValue({ package: 'toString' }).source, 'default');
});

// --- Budgetfeld ---
t('eine Spanne ergibt ihre Mitte', () => {
  assert.strictEqual(parseBudget('3.000 - 4.000 EUR'), 3500);
});

t('Tausenderpunkte werden nicht als Dezimaltrennung gelesen', () => {
  assert.strictEqual(parseBudget('5.000'), 5000);
  assert.strictEqual(parseBudget('12.500 EUR'), 12500);
});

t('eine einzelne Zahl bleibt sie selbst', () => {
  assert.strictEqual(parseBudget('ca. 8000'), 8000);
  assert.strictEqual(parseBudget('8000€'), 8000);
});

t('unplausible Zahlen fliegen raus', () => {
  assert.strictEqual(parseBudget('100'), 0, 'zu niedrig fuer ein Hochzeitsbudget');
  assert.strictEqual(parseBudget('999999'), 0, 'Tippfehler');
});

t('Text ohne Zahlen ergibt 0', () => {
  assert.strictEqual(parseBudget('weiss noch nicht'), 0);
  assert.strictEqual(parseBudget(''), 0);
  assert.strictEqual(parseBudget(undefined), 0);
});

t('das Budget greift, wenn kein Paket gewaehlt wurde', () => {
  const r = lv.leadValue({ budget: '7.000 - 9.000' });
  assert.strictEqual(r.value, 8000);
  assert.strictEqual(r.source, 'budget');
});

t('ein unbrauchbares Budget faellt auf den Vorgabewert zurueck', () => {
  const r = lv.leadValue({ budget: 'kommt drauf an' });
  assert.strictEqual(r.value, lv.DEFAULT_VALUE);
  assert.strictEqual(r.source, 'default');
});

// --- Rueckfall ---
t('eine leere Anfrage bekommt den Einstiegspreis', () => {
  const r = lv.leadValue({});
  assert.strictEqual(r.value, lv.PACKAGE_VALUES['The Day']);
  assert.strictEqual(r.source, 'default');
});

t('der Vorgabewert wertet nie ueber das guenstigste Paket hinaus auf', () => {
  const cheapest = Math.min(...Object.values(lv.PACKAGE_VALUES));
  assert.ok(lv.DEFAULT_VALUE <= cheapest,
    'ein unbekannter Lead darf nicht teurer bewertet werden als das guenstigste Paket');
});

t('kein Aufruf liefert 0, NaN oder undefined', () => {
  const cases = [{}, { package: '' }, { budget: 'abc' }, { package: null, budget: null }];
  for (const c of cases) {
    const r = lv.leadValue(c);
    assert.ok(Number.isFinite(r.value) && r.value > 0, JSON.stringify(c) + ' -> ' + r.value);
  }
});

t('leadValue kippt nicht bei fehlendem Argument', () => {
  const r = lv.leadValue(undefined);
  assert.ok(Number.isFinite(r.value) && r.value > 0);
});

console.log(`\n${passed} Tests bestanden.`);
