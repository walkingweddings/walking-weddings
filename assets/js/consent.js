// ========================================
// COOKIE-CONSENT + META PIXEL
// ========================================
//
// DSGVO/TTDSG: Das Meta Pixel setzt Cookies (_fbp) und überträgt Daten an
// Meta. Beides ist NICHT technisch notwendig, darf also erst nach aktiver
// Einwilligung laufen. Deshalb steht in den Seiten kein fbq-Snippet — diese
// Datei ist der einzige Ort, der das Pixel nachlädt, und zwar ausschließlich
// wenn im localStorage eine Marketing-Einwilligung liegt.
//
// Bewusst NICHT enthalten ist der <noscript>-Zählpixel aus dem Meta-Standard-
// Snippet: der würde bei jedem Aufruf ohne JavaScript ungefragt feuern. Wer
// kein JavaScript hat, kann aber gar nicht einwilligen — ein Tracking-Aufruf
// wäre damit per Definition einwilligungslos.
//
// Das Script läuft im <head> (von serve.js injiziert), also vor dem Rendern:
// bei erteilter Einwilligung startet das Pixel so früh wie möglich, der
// Banner selbst wird erst gebaut, wenn das <body> existiert.
// ========================================

(function () {
  'use strict';

  var PIXEL_ID = '1069216136085670';

  // Versionierter Key: falls sich Zweck oder Umfang der Verarbeitung ändern,
  // reicht ein Bump, um alle Besucher erneut zu fragen.
  var STORAGE_KEY = 'ww-consent-v1';
  var ACCEPTED = 'accepted';
  var DECLINED = 'declined';

  // ========================================
  // SPEICHER
  // ========================================
  // localStorage ist im Safari-Privatmodus und bei blockierten Cookies nicht
  // beschreibbar. Jeder Zugriff ist deshalb gekapselt — schlägt er fehl, gilt
  // "keine Entscheidung", und wir tracken schlicht nicht.

  function readDecision() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && (parsed.marketing === ACCEPTED || parsed.marketing === DECLINED)) {
        return parsed.marketing;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function writeDecision(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        marketing: value,
        date: new Date().toISOString()
      }));
    } catch (err) {
      // Nicht speicherbar (Privatmodus): Die Auswahl gilt dann nur für diese
      // Seitenansicht. Lieber das als eine harte Fehlermeldung.
    }
  }

  // ========================================
  // META PIXEL
  // ========================================

  var pixelLoaded = false;

  function loadPixel() {
    if (pixelLoaded || window.fbq) return;
    pixelLoaded = true;

    /* eslint-disable */
    // Meta Pixel Base Code (unverändert von Meta übernommen)
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */

    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  // Meta setzt _fbp/_fbc als First-Party-Cookies. Beim Widerruf löschen wir
  // sie, damit die Ablehnung nicht nur künftige Aufrufe betrifft.
  function clearPixelCookies() {
    var host = window.location.hostname;
    // Cookie auf der aktuellen Domain und auf der Registrable Domain löschen
    // (Meta setzt auf ".walkingweddings.com", die Seite läuft auf "www.…").
    var domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    ['_fbp', '_fbc'].forEach(function (name) {
      domains.forEach(function (domain) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
          (domain ? '; domain=' + domain : '');
      });
    });
  }

  // ========================================
  // TEXTE (DE/EN)
  // ========================================
  // Die englische Fassung wird serverseitig unter /en/ ausgeliefert und setzt
  // <html lang="en"> — dieselbe Erkennung wie im Kontaktformular. Der Banner
  // entsteht erst im Browser, läuft also nicht durch die i18n-Pipeline.

  function isEnglish() {
    return document.documentElement.lang === 'en';
  }

  var TEXTS = {
    de: {
      title: 'Cookies & Marketing',
      body: 'Wir würden gerne das Meta Pixel einsetzen, um zu messen, wie unsere Werbung ankommt, und euch passende Inhalte auf Facebook und Instagram zu zeigen. Das ist freiwillig — die Website funktioniert ohne genauso.',
      privacy: 'Mehr dazu in der Datenschutzerklärung',
      accept: 'Akzeptieren',
      decline: 'Ablehnen',
      label: 'Hinweis zu Cookies'
    },
    en: {
      title: 'Cookies & Marketing',
      body: 'We would like to use the Meta Pixel to measure how our advertising performs and to show you relevant content on Facebook and Instagram. This is entirely optional — the site works just as well without it.',
      privacy: 'Read more in our Privacy Policy',
      accept: 'Accept',
      decline: 'Decline',
      label: 'Cookie notice'
    }
  };

  // ========================================
  // BANNER
  // ========================================

  var bannerEl = null;
  var lastFocused = null;

  function privacyHref() {
    return isEnglish() ? '/en/privacy.html' : '/privacy.html';
  }

  function buildBanner() {
    var t = isEnglish() ? TEXTS.en : TEXTS.de;
    var el = document.createElement('div');
    el.className = 'ww-consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t.label);
    el.innerHTML =
      '<div class="ww-consent__inner">' +
        '<div class="ww-consent__copy">' +
          '<p class="ww-consent__title">' + t.title + '</p>' +
          '<p class="ww-consent__text">' + t.body +
            ' <a class="ww-consent__link" href="' + privacyHref() + '">' + t.privacy + '</a>.' +
          '</p>' +
        '</div>' +
        '<div class="ww-consent__actions">' +
          '<button type="button" class="ww-consent__btn ww-consent__btn--ghost" data-ww-consent="decline">' + t.decline + '</button>' +
          '<button type="button" class="ww-consent__btn ww-consent__btn--solid" data-ww-consent="accept">' + t.accept + '</button>' +
        '</div>' +
      '</div>';
    return el;
  }

  function showBanner() {
    if (bannerEl || !document.body) return;
    lastFocused = document.activeElement;
    bannerEl = buildBanner();
    document.body.appendChild(bannerEl);
    // Ein Frame warten, damit der Einblend-Übergang greift.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        if (bannerEl) bannerEl.classList.add('ww-consent--visible');
      });
    });
  }

  function hideBanner() {
    if (!bannerEl) return;
    var el = bannerEl;
    bannerEl = null;
    el.classList.remove('ww-consent--visible');
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 400);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
  }

  // ========================================
  // ENTSCHEIDUNGEN
  // ========================================

  function accept() {
    writeDecision(ACCEPTED);
    hideBanner();
    loadPixel();
    updateStatusLabels();
  }

  function decline() {
    var wasAccepted = readDecision() === ACCEPTED;
    writeDecision(DECLINED);
    hideBanner();
    clearPixelCookies();
    updateStatusLabels();
    // Ein bereits geladenes Pixel lässt sich im laufenden Dokument nicht
    // zuverlässig stilllegen. Nach einem Widerruf laden wir die Seite neu,
    // damit ab sofort wirklich nichts mehr an Meta geht.
    if (wasAccepted) window.location.reload();
  }

  // Widerruf/Änderung: der Banner lässt sich jederzeit erneut öffnen —
  // über den Button in der Datenschutzerklärung oder /…#cookie-einstellungen.
  function reopen() {
    if (bannerEl) return;
    showBanner();
  }

  // Zeigt in der Datenschutzerklärung den aktuellen Stand an.
  function updateStatusLabels() {
    var decision = readDecision();
    var t = isEnglish() ? TEXTS.en : TEXTS.de;
    var label = decision === ACCEPTED ? t.accept
      : decision === DECLINED ? t.decline
      : (isEnglish() ? 'not set' : 'nicht gesetzt');
    document.querySelectorAll('[data-ww-consent-status]').forEach(function (el) {
      el.textContent = label;
    });
  }

  // ========================================
  // ÖFFENTLICHE API
  // ========================================

  window.wwConsent = {
    accept: accept,
    decline: decline,
    reopen: reopen,
    // Für Event-Tracking an anderen Stellen (z.B. Lead im Kontaktformular):
    // feuert nur, wenn das Pixel tatsächlich mit Einwilligung geladen wurde.
    //
    // options nimmt { eventID: '…' }: Dieselbe ID meldet der Server über die
    // Conversions API mit. Meta führt beide Meldungen dann zu einem Ereignis
    // zusammen, statt den Lead doppelt zu zählen.
    track: function (event, params, options) {
      // Zwei Riegel statt einem. Dass ohne Einwilligung kein fbq existiert,
      // ist heute richtig — aber es ist eine Nebenwirkung davon, dass das
      // Pixel nicht geladen wurde, keine Zusicherung. Nach einem Widerruf
      // liegt fbq bis zum Reload noch im Speicher. Die Einwilligung wird
      // deshalb hier eigenständig geprüft.
      if (readDecision() !== ACCEPTED) return;
      if (typeof window.fbq !== 'function') return;
      // Ohne Parameter auch wirklich ohne dritten Aufrufparameter — sonst
      // meldet der Meta Pixel Helper ein leeres Parameterobjekt. Mit eventID
      // braucht fbq allerdings einen Platzhalter an dritter Stelle.
      if (options) window.fbq('track', event, params || {}, options);
      else if (params) window.fbq('track', event, params);
      else window.fbq('track', event);
    },
    hasMarketingConsent: function () {
      return readDecision() === ACCEPTED;
    }
  };

  // ========================================
  // START
  // ========================================

  // Einwilligung liegt vor → Pixel sofort laden, noch bevor der Body steht.
  if (readDecision() === ACCEPTED) loadPixel();

  function init() {
    // Delegierter Handler: bedient die Banner-Buttons und jeden statischen
    // Auslöser im Markup (data-ww-consent="reopen" in der Datenschutzseite).
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest ? e.target.closest('[data-ww-consent]') : null;
      if (!trigger) return;
      var action = trigger.getAttribute('data-ww-consent');
      if (action === 'accept') { e.preventDefault(); accept(); }
      else if (action === 'decline') { e.preventDefault(); decline(); }
      else if (action === 'reopen') { e.preventDefault(); reopen(); }
    });

    updateStatusLabels();

    // Noch keine Entscheidung getroffen → fragen.
    if (readDecision() === null) showBanner();
    // Direktlink auf die Einstellungen (z.B. aus einer E-Mail).
    else if (/^#cookie-(einstellungen|settings)$/.test(window.location.hash)) reopen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
