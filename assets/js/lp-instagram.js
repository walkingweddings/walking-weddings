/* ============================================================================
   Walking Weddings — Instagram LP
   UTM capture, form handlers, Meta Pixel events
   ============================================================================ */
(function () {
  'use strict';

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  var STORAGE_KEY = 'ww_attribution';

  // ----- Attribution capture -----------------------------------------------
  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}

    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) stored[k] = v;
    });

    // On the Instagram LP, apply sensible default attribution if the ad URL
    // was opened without UTM params. Do NOT default for other pages — that
    // would falsely attribute organic/SEO/direct traffic.
    var isInstagramLP = /\/lp\/instagram(\.html)?$/.test(window.location.pathname);
    if (isInstagramLP) {
      if (!stored.utm_source) stored.utm_source = 'instagram';
      if (!stored.utm_medium) stored.utm_medium = 'paid_social';
    }

    if (!stored.landing_page) stored.landing_page = window.location.href.split('#')[0];
    if (!stored.referrer && document.referrer) stored.referrer = document.referrer;

    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch (e) {}
    return stored;
  }

  function getAttribution() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-.]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  function getMetaCookies() {
    // _fbp is set by Meta Pixel; _fbc is derived from fbclid
    var fbp = getCookie('_fbp');
    var fbc = getCookie('_fbc');

    // If _fbc isn't set yet but we have fbclid, synthesize it per Meta spec
    var attr = getAttribution();
    if (!fbc && attr.fbclid) {
      fbc = 'fb.1.' + Date.now() + '.' + attr.fbclid;
    }
    return { fbp: fbp, fbc: fbc };
  }

  function newEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ----- Meta Pixel wrapper ------------------------------------------------
  function trackPixel(eventName, params, eventId) {
    if (typeof window.fbq !== 'function') return;
    try {
      window.fbq('track', eventName, params || {}, eventId ? { eventID: eventId } : undefined);
    } catch (e) {
      console.error('Pixel track failed:', e);
    }
  }

  // ----- ViewContent on scroll (for Meta learning) ------------------------
  function setupViewContent() {
    if (!('IntersectionObserver' in window)) return;
    var targets = document.querySelectorAll('[data-track-view]');
    if (!targets.length) return;

    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !fired) {
          fired = true;
          trackPixel('ViewContent', { content_name: entry.target.getAttribute('data-track-view') || 'lp_instagram' });
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    targets.forEach(function (t) { io.observe(t); });
  }

  // ----- Smooth-scroll CTAs -------------------------------------------------
  function setupScrollLinks() {
    document.querySelectorAll('[data-scroll-to]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var id = el.getAttribute('data-scroll-to');
        var target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ----- Lead magnet form --------------------------------------------------
  function setupLeadMagnetForm() {
    var form = document.getElementById('leadMagnetForm');
    if (!form) return;
    var status = document.getElementById('leadMagnetStatus');
    var wrapper = document.getElementById('leadMagnetWrapper');
    var success = document.getElementById('leadMagnetSuccess');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var nameEl = form.querySelector('input[name="name"]');
      var emailEl = form.querySelector('input[name="email"]');
      var submitBtn = form.querySelector('button[type="submit"]');

      var name = (nameEl && nameEl.value || '').trim();
      var email = (emailEl && emailEl.value || '').trim();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (status) status.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.';
        return;
      }

      var eventId = newEventId();
      var meta = getMetaCookies();

      var payload = {
        name: name,
        email: email,
        event_id: eventId,
        utm: getAttribution(),
        landing_page: window.location.href.split('#')[0],
        referrer: document.referrer || '',
        fbp: meta.fbp,
        fbc: meta.fbc
      };

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Wird gesendet…'; }
      if (status) status.textContent = '';

      try {
        var res = await fetch('/api/lead-magnet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Server error');

        trackPixel('CompleteRegistration', { content_name: 'hochzeitsguide', value: 0, currency: 'EUR' }, eventId);

        if (wrapper && success) {
          wrapper.style.display = 'none';
          success.style.display = 'block';
        }
      } catch (err) {
        console.error('Lead magnet submit failed:', err);
        if (status) status.textContent = 'Leider ging etwas schief. Bitte versucht es gleich nochmal oder schreibt uns direkt an contact@walkingweddings.com';
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guide anfordern'; }
      }
    });
  }

  // ----- Main contact form on LP -------------------------------------------
  function setupContactForm() {
    var form = document.getElementById('lpContactForm');
    if (!form) return;
    var wrapper = document.getElementById('lpContactWrapper');
    var success = document.getElementById('lpContactSuccess');
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var getVal = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
      var name = getVal('name');
      var phone = getVal('phone');
      var email = getVal('email');

      if (!name || !phone || !email) {
        alert('Bitte füllt Name, Telefon und E-Mail aus.');
        return;
      }

      var interesse = [];
      form.querySelectorAll('input[name="interesse"]:checked').forEach(function (cb) { interesse.push(cb.value); });
      if (interesse.length === 0) {
        alert('Bitte wählt mindestens ein Interesse aus (Foto / Film / Hybrid / Noch offen).');
        return;
      }

      var date = getVal('date1');
      var location = getVal('location1');

      var eventId = newEventId();
      var meta = getMetaCookies();

      var payload = {
        name: name,
        phone: phone,
        email: email,
        dates: date ? [date] : [],
        noDate: !date,
        locations: location ? [location] : [],
        noLocation: !location,
        interesse: interesse,
        zusatz: [],
        hours: '',
        budget: getVal('budget'),
        message: getVal('message'),
        event_id: eventId,
        utm: getAttribution(),
        landing_page: window.location.href.split('#')[0],
        referrer: document.referrer || '',
        fbp: meta.fbp,
        fbc: meta.fbc
      };

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Wird gesendet…'; }

      try {
        var res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Server error');

        trackPixel('Lead', { content_name: 'beratung_anfrage', value: 0, currency: 'EUR' }, eventId);

        if (wrapper && success) {
          wrapper.style.display = 'none';
          success.style.display = 'block';
          success.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (err) {
        console.error('Contact submit failed:', err);
        alert('Es gab ein Problem beim Senden. Bitte versucht es erneut oder schreibt uns direkt an contact@walkingweddings.com');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Beratung Anfragen'; }
      }
    });
  }

  // ----- Init ---------------------------------------------------------------
  function init() {
    captureAttribution();
    setupScrollLinks();
    setupViewContent();
    setupLeadMagnetForm();
    setupContactForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose helpers for reuse on other pages (e.g. contact.html UTM hidden fields)
  window.WWAttribution = {
    capture: captureAttribution,
    get: getAttribution,
    getMetaCookies: getMetaCookies,
    newEventId: newEventId
  };
})();
