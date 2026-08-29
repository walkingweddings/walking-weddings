// ========================================
// ZWISCHENSIGNALE FÜR META
// ========================================
//
// WARUM
// Gemeldet wurden bisher nur zwei Ereignisse: Seitenaufruf und Lead. Dazwischen
// liegt alles, was Kaufabsicht verrät — die Preise ansehen, die Arbeiten
// durchsehen, das Formular beginnen. In der Lernphase einer Kampagne sind das
// genau die Signale, aus denen Meta lernt, wen es ansprechen soll. Zwischen
// "hat die Seite geöffnet" und "hat angefragt" liegt sonst nichts, woraus sich
// ein Muster bilden ließe.
//
// WAS GEMELDET WIRD
//   ViewContent        auf Investment, Works und Motion
//   InitiateCheckout   sobald jemand im Kontaktformular zu tippen beginnt
//
// Bewusst NICHT auf Journal, About oder der Startseite: Wer einen Blogbeitrag
// liest, zeigt Interesse am Thema, nicht an einer Buchung. Ein Signal, das
// jeder auslöst, trennt niemanden von niemandem und verwässert die Zielgruppe.
//
// ZUR WAHL VON InitiateCheckout
// Meta hat kein Standardereignis für "Formular begonnen". Zur Wahl standen ein
// eigenes Ereignis (klarer Name in den Berichten) und InitiateCheckout (Metas
// Modelle kennen es und rechnen damit). Ausschlaggebend war Letzteres: Der
// Zweck ist die Lernphase, und dafür trägt ein Standardereignis mehr.
//
// Preis dafür: In den Meta-Berichten steht "Auschecken eingeleitet", was für
// ein Fotostudio schräg klingt. Gemeint ist "hat begonnen, das Kontaktformular
// auszufüllen". Wollt ihr den klareren Namen, ersetzt den Wert von FORM_START
// durch z.B. 'FormStart' — dann taucht es unter diesem Namen auf und lässt
// sich im Events Manager als benutzerdefinierte Conversion einrichten.
//
// EINWILLIGUNG
// Alles läuft über wwConsent.track(), das die Einwilligung selbst prüft. Ohne
// Zustimmung passiert hier nichts. Wird erst auf der Seite zugestimmt, holt
// wwConsent.onGrant() die Meldung nach — sonst ginge ausgerechnet der
// Seitenaufruf verloren, bei dem jemand gerade eingewilligt hat.
//
// KEIN SERVERSEITIGES GEGENSTÜCK
// Anders als der Lead gehen diese Ereignisse nur aus dem Browser raus. Ein
// Seitenaufruf hat keine Serverbestätigung, an die sich eine zweite Meldung
// hängen ließe, und beim Rendern weiß der Server nicht, ob eingewilligt wurde.
// Diese Signale sind Mengensignale für die Lernphase — dass ein Teil davon an
// Blockern hängenbleibt, kostet Genauigkeit, nicht die Conversion selbst.
// ========================================

(function () {
  'use strict';

  var FORM_START = 'InitiateCheckout';

  // Seiten, deren Aufruf Kaufabsicht verrät. Schlüssel ist der Dateiname, damit
  // die deutsche Seite und ihre englische Spiegelung unter /en/ dieselbe Regel
  // treffen.
  var INTENT_PAGES = {
    'packages.html': { name: 'Investment', category: 'pricing' },
    'portfolio.html': { name: 'Works', category: 'portfolio' },
    'filme.html': { name: 'Motion', category: 'film' }
  };

  function pageKey() {
    var path = window.location.pathname.replace(/^\/en(?=\/|$)/, '');
    var last = path.split('/').pop();
    return last || 'index.html';
  }

  function track(event, params) {
    if (window.wwConsent) window.wwConsent.track(event, params);
  }

  // Führt fn aus, sobald eine Einwilligung vorliegt — sofort oder beim
  // Zustimmen. Fehlt wwConsent (Script blockiert), passiert nichts.
  function whenAllowed(fn) {
    if (!window.wwConsent || typeof window.wwConsent.onGrant !== 'function') return;
    window.wwConsent.onGrant(fn);
  }

  // ── ViewContent ───────────────────────────────────────────────────────────

  function reportViewContent() {
    var page = INTENT_PAGES[pageKey()];
    if (!page) return;
    whenAllowed(function () {
      track('ViewContent', {
        content_name: page.name,
        content_category: page.category,
        // Sprache mitgeben: Eine englische Anzeige, die auf /en/ führt, ist
        // eine andere Zielgruppe als eine deutsche.
        content_type: document.documentElement.lang === 'en' ? 'en' : 'de'
      });
    });
  }

  // ── Formularbeginn ────────────────────────────────────────────────────────

  function reportFormStart() {
    var form = document.getElementById('contactForm');
    if (!form) return;

    var fired = false;

    function fire() {
      if (fired) return;
      fired = true;
      detach();
      whenAllowed(function () {
        track(FORM_START, { content_category: 'contact-form' });
      });
    }

    // Erst bei echter Eingabe, nicht beim blossen Anklicken: Ein Feld zu
    // fokussieren und wieder wegzuscrollen ist keine Absicht. Beide Ereignisse,
    // weil "input" bei Auswahlfeldern und Kaestchen nicht zuverlaessig feuert.
    function onInput(e) {
      var el = e.target;
      if (!el || !el.name) return;
      // Die Spam-Falle zaehlt nicht: Nur Bots fuellen sie aus.
      if (el.id === 'website' || el.id === '_ts') return;
      fire();
    }

    function detach() {
      form.removeEventListener('input', onInput, true);
      form.removeEventListener('change', onInput, true);
    }

    form.addEventListener('input', onInput, true);
    form.addEventListener('change', onInput, true);
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  function init() {
    reportViewContent();
    reportFormStart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
