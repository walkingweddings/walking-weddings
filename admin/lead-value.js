// Was ist eine Anfrage wert?
//
// WARUM
// Das Lead-Ereignis ging bisher ohne value und currency an Meta. Für den
// Algorithmus war damit jede Anfrage gleich viel wert: eine Elopement-Anfrage
// so viel wie eine Legacy-Anfrage. Er konnte nicht lernen, welche Paare sich
// für euch rechnen, und hat entsprechend auf Menge optimiert statt auf Wert.
//
// Mit einem Wert je Anfrage kann die Kampagne auf "Conversion-Wert" optimieren
// und bevorzugt Menschen ausspielen, die den teureren Anfragen ähneln.
//
// WELCHE ZAHL
// Hier steht der Auftragswert, nicht der erwartete Umsatz — also der Preis des
// Pakets, nicht Preis mal Abschlussquote. Meta optimiert auf das Verhältnis
// der Werte zueinander, nicht auf ihren absoluten Betrag; solange alle Zahlen
// nach derselben Regel entstehen, lernt der Algorithmus dasselbe. Wollt ihr
// später echten erwarteten Umsatz melden, multipliziert die Tabelle unten mit
// eurer Abschlussquote — die Reihenfolge bleibt gleich, die Zahlen in den
// Meta-Berichten werden realistischer.
//
// DIESE TABELLE BESTIMMT, WORAUF META OPTIMIERT.
// Wenn sich eure Preise ändern, ändert sie hier — sonst lernt die Kampagne
// weiter mit den alten Zahlen.

'use strict';

const CURRENCY = 'EUR';

// Preise laut packages.html (Stand: August 2026).
const PACKAGE_VALUES = {
  'The Day': 4680,
  'The Story': 6680,
  // "Auf Anfrage" — es gibt keinen veröffentlichten Preis. 9000 ist eine
  // Annahme, damit The Legacy über The Story liegt; das ist die Aussage, auf
  // die es dem Algorithmus ankommt. Ersetzt sie durch euren echten
  // Durchschnittswert, sobald ihr ihn kennt.
  'The Legacy': 9000,
};

// Wer über eine Anzeige auf die Startseite kommt, wählt selten vorher ein
// Paket — dann bleibt nur das Budgetfeld oder gar nichts. Als Rückfall der
// Einstiegspreis: lieber zu niedrig ansetzen als eine Anfrage künstlich
// aufwerten, die wir nicht einschätzen können.
const DEFAULT_VALUE = PACKAGE_VALUES['The Day'];

// Plausibilitätsgrenzen für das freie Budgetfeld. Darunter ist es kein
// Hochzeitsbudget, darüber ein Tippfehler.
const MIN_PLAUSIBLE = 500;
const MAX_PLAUSIBLE = 50000;

// Das Budgetfeld ist Freitext; die Beispielvorgabe lautet "z.B. 3.000 - 4.000
// EUR". Wir ziehen alle Zahlen heraus, entfernen Tausenderpunkte und mitteln
// die plausiblen — bei einer Spanne ergibt das die Mitte, bei einer einzelnen
// Zahl diese selbst.
//
// Die Heuristik kann irren: Schreibt jemand "Hochzeit 2027, Budget 5000",
// fließt die Jahreszahl mit ein. Das verschiebt den Wert nach unten, nie nach
// oben — für die Optimierung der harmlosere Fehler.
function parseBudget(text) {
  const raw = String(text || '');
  if (!raw.trim()) return 0;

  const numbers = [];
  for (const match of raw.matchAll(/\d[\d.\s']*\d|\d+/g)) {
    const digits = match[0].replace(/[.\s']/g, '');
    const n = parseInt(digits, 10);
    if (Number.isFinite(n) && n >= MIN_PLAUSIBLE && n <= MAX_PLAUSIBLE) numbers.push(n);
  }
  if (!numbers.length) return 0;

  const sum = numbers.reduce((a, b) => a + b, 0);
  return Math.round(sum / numbers.length);
}

// Reihenfolge der Quellen: das gewählte Paket ist eine Angabe, das Budgetfeld
// eine Schätzung, der Rückfall eine Annahme. Jede Stufe ist schwächer als die
// vorige, deshalb greift die stärkste zuerst.
function leadValue(lead) {
  const pkg = String(lead && lead.package || '').trim();
  if (Object.prototype.hasOwnProperty.call(PACKAGE_VALUES, pkg)) {
    return { value: PACKAGE_VALUES[pkg], currency: CURRENCY, source: 'package' };
  }

  const budget = parseBudget(lead && lead.budget);
  if (budget) {
    return { value: budget, currency: CURRENCY, source: 'budget' };
  }

  return { value: DEFAULT_VALUE, currency: CURRENCY, source: 'default' };
}

module.exports = {
  leadValue,
  CURRENCY,
  PACKAGE_VALUES,
  DEFAULT_VALUE,
  _internals: { parseBudget },
};
