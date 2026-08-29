// Bildkonvertierung für den Journal-Upload
//
// WARUM
// Im August wurden über 400 Bildverweise auf WebP umgestellt — der Upload-Weg
// blieb dabei außen vor. Er speichert seither weiter das Original. Gemessen im
// Ordner assets/images/journal: 130 JPGs mit zusammen 67,4 MB gegenüber 74
// WebP-Dateien mit 16,3 MB. Jeder neue Journalbeitrag wird dadurch rund
// viermal so schwer wie die älteren, und die Journalbeiträge sind ausgerechnet
// das, was Google finden soll.
//
// Die Optimierung wurde damals an den Dateien gemacht, nicht an dem Werkzeug,
// das sie erzeugt. Das holt dieses Modul nach.
//
// WARUM SHARP OPTIONAL IST
// Das Projekt hatte bisher keine einzige Abhängigkeit — reines Node. sharp ist
// ein nativer Baustein; schlägt seine Installation auf Railway fehl, würde ein
// hartes require() den Server beim Start umbringen und die Website mitnehmen.
// Deshalb steht es in package.json unter optionalDependencies und wird hier in
// try/catch geladen. Fehlt es, verhält sich der Upload exakt wie vorher: Das
// Original wird gespeichert, nichts geht kaputt, und die Startzeile im Log
// sagt, dass die Konvertierung aus ist.

'use strict';

const { extname } = require('path');

let sharp = null;
let loadError = '';
try {
  sharp = require('sharp');
} catch (err) {
  loadError = err.code === 'MODULE_NOT_FOUND' ? 'nicht installiert' : err.message;
}

// Nur diese Formate werden umgewandelt.
//   GIF  bleibt: kann animiert sein, und eine Animation nach WebP zu bringen
//        ist kein Nebenbei-Fall.
//   SVG  bleibt: eine Vektorgrafik in ein Rasterformat zu giessen macht sie
//        groesser und schlechter.
//   WebP bleibt: schon am Ziel.
const CONVERTIBLE = new Set(['.jpg', '.jpeg', '.png']);

// 82 liegt dort, wo WebP bei Fotos noch keine sichtbaren Artefakte zeigt und
// die Datei rund ein Viertel des JPEGs wiegt. effort 4 ist der Standard und
// kostet wenig Rechenzeit — der Upload soll nicht haengen.
const QUALITY = 82;
const EFFORT = 4;

// Die laengste Kante. Journalbilder werden nie breiter als rund 1600 px
// dargestellt; 2400 laesst Reserve fuer Bildschirme mit hoher Punktdichte und
// deckelt trotzdem die Kameraaufloesung, mit der Fotografen sonst hochladen.
// Kleinere Bilder bleiben unangetastet — hochskaliert wird nie.
const MAX_EDGE = 2400;

function isEnabled() {
  return Boolean(sharp);
}

// Eine Zeile fuer das Start-Log, damit man ohne Testupload sieht, ob die
// Konvertierung ueberhaupt laeuft.
function startupSummary() {
  if (sharp) {
    return `Bildkonvertierung: aktiv — neue Journalbilder werden zu WebP (Qualitaet ${QUALITY}, max. ${MAX_EDGE} px)`;
  }
  return `Bildkonvertierung: DEAKTIVIERT — sharp ${loadError}. ` +
    'Uploads werden unveraendert gespeichert.';
}

// Wandelt einen Bild-Puffer nach WebP. Wirft nie: Bei jedem Problem kommt das
// Original zurueck, denn ein gespeichertes grosses Bild ist allemal besser als
// ein verlorener Upload.
//
// Rueckgabe: { buffer, filename, converted, reason?, before?, after? }
async function toWebp(buffer, filename) {
  const ext = extname(filename).toLowerCase();
  const base = filename.slice(0, filename.length - ext.length);
  const unchanged = (reason) => ({ buffer, filename, converted: false, reason });

  if (!sharp) return unchanged('sharp fehlt');
  if (!CONVERTIBLE.has(ext)) return unchanged(`${ext || 'ohne Endung'} wird nicht umgewandelt`);

  try {
    const image = sharp(buffer, { failOn: 'none' });
    const meta = await image.metadata();

    // Nur verkleinern, nie vergroessern: withoutEnlargement laesst kleine
    // Bilder in Ruhe.
    const out = await image
      .rotate() // EXIF-Drehung anwenden, bevor die Ausrichtung verlorengeht
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: EFFORT })
      .toBuffer();

    // Ein groesseres Ergebnis waere sinnlos — dann bleibt das Original.
    if (out.length >= buffer.length) {
      return unchanged(`WebP waere groesser (${out.length} statt ${buffer.length} Bytes)`);
    }

    return {
      buffer: out,
      filename: base + '.webp',
      converted: true,
      before: buffer.length,
      after: out.length,
      width: meta.width,
      height: meta.height,
    };
  } catch (err) {
    return unchanged('Konvertierung fehlgeschlagen: ' + err.message);
  }
}

module.exports = {
  isEnabled,
  startupSummary,
  toWebp,
  CONVERTIBLE,
  QUALITY,
  MAX_EDGE,
};
