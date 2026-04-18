// Injected into the preview iframe so the admin can edit texts and swap images
// directly in the rendered post. Communicates with the parent admin page via
// postMessage.
(function () {
  'use strict';
  if (window.parent === window) return; // only run in iframe

  const origin = (function () {
    try { return window.parent.location.origin; } catch { return '*'; }
  })();

  function send(msg) {
    try { window.parent.postMessage(msg, origin); } catch {}
  }

  // --- Styling injection ----------------------------------------------------

  const style = document.createElement('style');
  style.textContent = [
    '[data-admin-editable] { outline: none; transition: outline-color .2s, background-color .2s; cursor: text; position: relative; }',
    '[data-admin-editable]:hover { outline: 1px dashed rgba(184, 168, 138, 0.6); outline-offset: 4px; background-color: rgba(184, 168, 138, 0.04); }',
    '[data-admin-editable]:focus { outline: 2px solid #B8A88A; outline-offset: 4px; background-color: rgba(184, 168, 138, 0.06); }',
    '[data-admin-image] { cursor: pointer; position: relative; }',
    '.admin-edit-badge { position: fixed; top: 14px; left: 14px; background: rgba(11,17,17,0.85); color: #B8A88A; font-family: "Cormorant Garamond", serif; font-style: italic; padding: 6px 14px; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; border: 1px solid rgba(184,168,138,0.4); z-index: 9999; pointer-events: none; }',
    '.admin-image-wrap { position: relative; display: block; }',
    '.admin-image-overlay { position: absolute; inset: 0; background: rgba(11, 17, 17, 0); display: flex; align-items: center; justify-content: center; transition: background .25s; pointer-events: none; }',
    '[data-admin-image]:hover .admin-image-overlay { background: rgba(11, 17, 17, 0.55); pointer-events: auto; }',
    '.admin-image-overlay span { opacity: 0; transform: translateY(4px); transition: opacity .25s, transform .25s; background: #B8A88A; color: #0B1111; padding: 10px 22px; font-family: "PT Sans", sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; }',
    '[data-admin-image]:hover .admin-image-overlay span { opacity: 1; transform: translateY(0); }',
  ].join('\n');
  document.head.appendChild(style);

  const badge = document.createElement('div');
  badge.className = 'admin-edit-badge';
  badge.textContent = '✎ Editieren — klicke auf Text oder Bild';
  document.body.appendChild(badge);

  // --- Helpers --------------------------------------------------------------

  function makeEditable(el, opts) {
    if (!el || el.dataset.adminEditable) return;
    el.dataset.adminEditable = opts.key || '1';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
      if (e.key === 'Enter' && !e.shiftKey && opts.singleLine) {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('blur', () => opts.onBlur(el));
  }

  function stripPlatePrefix(txt) {
    return String(txt || '').replace(/^\s*Plate\s+[IVXLCDM0-9]+\s*[—–-]\s*/i, '');
  }

  // --- Hero fields ----------------------------------------------------------

  const heroEyebrow = document.querySelector('.editorial-hero__eyebrow');
  makeEditable(heroEyebrow, {
    key: 'eyebrow',
    singleLine: true,
    onBlur: () => send({ type: 'edit-field', field: 'eyebrow', value: heroEyebrow.textContent.trim() }),
  });

  const heroTitle = document.querySelector('.editorial-hero__title');
  makeEditable(heroTitle, {
    key: 'title',
    singleLine: true,
    onBlur: () => send({
      type: 'edit-field',
      field: 'title',
      value: heroTitle.innerHTML.trim(),
      plainValue: heroTitle.textContent.trim(),
    }),
  });

  const metaSpans = document.querySelectorAll('.editorial-hero__meta span');
  const metaFields = ['coupleNames', 'location', 'services'];
  metaSpans.forEach((el, i) => {
    if (i >= metaFields.length) return;
    makeEditable(el, {
      key: metaFields[i],
      singleLine: true,
      onBlur: () => send({ type: 'edit-field', field: metaFields[i], value: el.textContent.trim() }),
    });
  });

  const heroCaption = document.querySelector('.editorial-hero__figure figcaption');
  makeEditable(heroCaption, {
    key: 'heroCaption',
    singleLine: true,
    onBlur: () => send({ type: 'edit-field', field: 'heroCaption', value: stripPlatePrefix(heroCaption.textContent) }),
  });

  // --- Article body edits --- whole-article-inner serialization -------------

  const article = document.querySelector('article.editorial-post');

  function sendArticleUpdate() {
    if (!article) return;
    // Clone, strip the admin-only content, serialize back to HTML
    const clone = article.cloneNode(true);
    // Remove credits aside + signature (managed via ticket fields, not articleInner)
    clone.querySelectorAll('.editorial-ticket, .editorial-signature').forEach(el => el.remove());
    // Clean up admin-only attributes on every element
    clone.querySelectorAll('[data-admin-editable], [data-admin-image], [contenteditable]').forEach(el => {
      el.removeAttribute('data-admin-editable');
      el.removeAttribute('data-admin-image');
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
    });
    // Also strip any admin image overlays injected for visual hover state
    clone.querySelectorAll('.admin-image-overlay, .admin-image-wrap').forEach(el => {
      if (el.classList.contains('admin-image-overlay')) el.remove();
      else {
        // Unwrap the admin-image-wrap: replace with its single child
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    });
    send({ type: 'edit-article', value: clone.innerHTML.replace(/\n\s*\n/g, '\n').trim() });
  }

  if (article) {
    const editableSelectors = [
      '.editorial-chapter__body',
      '.editorial-chapter__body p',
      '.editorial-chapter__label',
      '.editorial-figure figcaption',
      '.editorial-quote p',
      '.editorial-quote cite',
    ];
    // Only deepest text blocks get contentEditable
    article.querySelectorAll(editableSelectors.join(',')).forEach(el => {
      // Skip if inside another editable ancestor (we want the inner element only)
      if (el.parentElement && el.parentElement.closest('[data-admin-editable]')) return;
      makeEditable(el, {
        onBlur: sendArticleUpdate,
      });
    });
  }

  // --- Image swap -----------------------------------------------------------

  function makeImageSwappable(img, context) {
    if (img.closest('[data-admin-image]')) return;
    img.dataset.adminImageContext = context;
    // Wrap the image so we can show a hover overlay without breaking layout
    const wrap = document.createElement('span');
    wrap.className = 'admin-image-wrap';
    wrap.setAttribute('data-admin-image', context);
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    const overlay = document.createElement('span');
    overlay.className = 'admin-image-overlay';
    overlay.innerHTML = '<span>↑ Austauschen</span>';
    wrap.appendChild(overlay);
    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      send({
        type: 'swap-image',
        url: img.currentSrc || img.src,
        context,
      });
    });
  }

  // Hero image
  const heroImg = document.querySelector('.editorial-hero__figure img, .editorial-hero__figure video');
  if (heroImg) makeImageSwappable(heroImg, 'hero');

  // Article images and videos
  if (article) {
    article.querySelectorAll('img, video').forEach(img => makeImageSwappable(img, 'article'));
  }

  // --- Signal ready ---------------------------------------------------------
  send({ type: 'editor-ready' });
})();
