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
    '.admin-edit-badge { position: fixed; top: 14px; left: 14px; background: rgba(11,17,17,0.85); color: #B8A88A; font-family: "Cormorant Garamond", serif; font-style: italic; padding: 6px 14px; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; border: 1px solid rgba(184,168,138,0.4); z-index: 9999; pointer-events: none; transition: all .25s; }',
    '.admin-image-wrap { position: relative; display: block; }',
    '.admin-image-overlay { position: absolute; inset: 0; background: rgba(11, 17, 17, 0); display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; transition: background .25s; pointer-events: none; z-index: 5; }',
    '[data-admin-image]:hover .admin-image-overlay { background: rgba(11, 17, 17, 0.55); pointer-events: auto; }',
    '.admin-ol-btn { opacity: 0; transform: translateY(4px); transition: opacity .25s, transform .25s; background: #B8A88A; color: #0B1111; padding: 10px 22px; font-family: "PT Sans", sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; cursor: pointer; border: none; user-select: none; }',
    '.admin-ol-btn:hover { background: #D4C5A3; }',
    '[data-admin-image]:hover .admin-ol-btn { opacity: 1; transform: translateY(0); }',
    // Focal-point dot
    '.admin-focal-dot { position: absolute; width: 18px; height: 18px; border-radius: 50%; border: 2px solid #B8A88A; background: rgba(184,168,138,0.3); transform: translate(-50%, -50%); pointer-events: none; z-index: 6; display: none; box-shadow: 0 0 0 3px rgba(11,17,17,0.5); }',
    '.admin-focal-dot--active { display: block; }',
    // Crop mode
    '.admin-image-wrap--crop { outline: 3px solid #B8A88A !important; outline-offset: 0; }',
    '.admin-image-wrap--crop .admin-image-overlay { display: none; }',
    '.admin-image-wrap--crop img { cursor: crosshair; }',
    '.admin-crop-done { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: #B8A88A; color: #0B1111; border: none; padding: 10px 28px; font-family: "PT Sans", sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; cursor: pointer; z-index: 10; }',
    '.admin-crop-done:hover { background: #D4C5A3; }',
    '.admin-size-panel { position: absolute; left: 12px; right: 12px; bottom: 12px; background: rgba(11, 17, 17, 0.92); backdrop-filter: blur(8px); padding: 14px 16px; z-index: 20; display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(184, 168, 138, 0.35); }',
    '.admin-size-panel__row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }',
    '.admin-size-panel__label { color: #B8A88A; font-family: "PT Sans", sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; min-width: 56px; }',
    '.admin-size-panel__chips { display: flex; gap: 4px; flex-wrap: wrap; }',
    '.admin-size-panel__chip { background: transparent; color: #F5F2EC; border: 1px solid rgba(184, 168, 138, 0.4); padding: 6px 12px; font-family: "PT Sans", sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer; transition: all .18s; }',
    '.admin-size-panel__chip:hover { border-color: #B8A88A; color: #B8A88A; }',
    '.admin-size-panel__chip--active { background: #B8A88A; color: #0B1111; border-color: #B8A88A; }',
    '.admin-size-panel__done { align-self: flex-end; background: #B8A88A; color: #0B1111; border: none; padding: 8px 18px; font-family: "PT Sans", sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; margin-top: 4px; }',
    '.admin-size-panel__done:hover { background: #D4C5A3; }',
    // Drag handle for tile reordering — small grip at top-left of each
    // editable tile. Only visible on hover so it doesn't intrude on the
    // editorial preview. Cursor:move signals the drag affordance.
    '.admin-drag-handle { position: absolute; top: 8px; left: 8px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(11, 17, 17, 0.78); color: #B8A88A; border: 1px solid rgba(184, 168, 138, 0.5); font-family: "PT Sans", sans-serif; font-size: 14px; line-height: 1; cursor: move; opacity: 0; transition: opacity .2s ease, background .2s ease; z-index: 25; user-select: none; }',
    '[data-cms-tile-id]:hover > .admin-drag-handle { opacity: 1; }',
    '.admin-drag-handle:hover { background: #B8A88A; color: #0B1111; }',
    '[data-cms-tile-id].admin-tile--dragging { opacity: 0.4; outline: 2px dashed #B8A88A; }',
    '[data-cms-tile-id].admin-tile--drop-before { box-shadow: -4px 0 0 0 #B8A88A; }',
    '[data-cms-tile-id].admin-tile--drop-after  { box-shadow:  4px 0 0 0 #B8A88A; }',
    // When hovering an editable container, raise it above any overlapping
    // siblings so the overlay buttons + size panel always receive clicks.
    // The portfolio masonry deliberately overlaps tiles (negative margins
    // + nth-child z-index up to 2), which would otherwise eat clicks
    // landing in the overlap regions.
    '[data-cms-tile-id] { position: relative; }',
    '[data-cms-tile-id]:hover { z-index: 1000 !important; }',
    '.admin-image-wrap { z-index: 50; }',
    // Force-reveal scroll-animated content inside the preview iframe so the
    // editor never has to scroll past invisible (.reveal opacity:0) tiles
    // before they accept hover/clicks.
    '.reveal, .reveal--left, .reveal--right { opacity: 1 !important; transform: none !important; }',
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

  // --- Mode detection -------------------------------------------------------
  // The post editor (journal drafts) hard-codes selectors like
  // .editorial-hero__title because every post is rendered from one template.
  // For arbitrary public pages we instead look for `data-cms-id` annotations.
  // The server signals which mode to use via <meta name="cms-mode">.
  const cmsModeMeta = document.querySelector('meta[name="cms-mode"]');
  const cmsMode = cmsModeMeta ? cmsModeMeta.content : 'post';

  // --- Module-level state shared by both modes ------------------------------
  // These have to be declared BEFORE the page-mode early return below.
  // makeImageSwappable's click handlers reference them via closure but
  // function declarations only hoist the function object, not the bodies of
  // any `let`/`const` they read. If the page-mode return skips past their
  // declaration line, accessing them later throws a Temporal Dead Zone error
  // ("Cannot access 'activeCrop' / 'WIDTH_PRESETS' before initialization").

  let activeCrop = null; // { img, wrap, dot, context, imageIndex, cmsId }

  const WIDTH_PRESETS = [
    { label: 'Auto', value: null },
    { label: 'S 30%', value: '30' },
    { label: 'M 42%', value: '42' },
    { label: 'L 60%', value: '60' },
    { label: 'XL 80%', value: '80' },
  ];
  const ASPECT_PRESETS = [
    { label: 'Auto', value: null },
    { label: '4:3 ▭', value: '4/3' },
    { label: '3:4 ▯', value: '3/4' },
    { label: '1:1 □', value: '1/1' },
    { label: '16:9', value: '16/9' },
  ];

  if (cmsMode === 'page') {
    document.querySelectorAll('[data-cms-id]').forEach(el => {
      const cmsId = el.dataset.cmsId;
      if (!cmsId) return;
      const tag = el.tagName;
      if (tag === 'IMG' || tag === 'VIDEO') {
        makeImageSwappable(el, 'page', null, cmsId);
        return;
      }
      const isInlineHeading = /^H[1-6]$/.test(tag) || tag === 'STRONG' || tag === 'EM' || tag === 'SPAN';
      makeEditable(el, {
        key: cmsId,
        singleLine: isInlineHeading,
        onBlur: () => send({
          type: 'edit-field',
          cmsId,
          // Send both the rendered HTML and the plain text. The admin frontend
          // picks one based on whether the original markup contains inline
          // tags (em, strong, br) — for plain headlines we want plainValue,
          // for prose paragraphs we want innerHTML.
          value: el.innerHTML,
          plainValue: el.textContent,
        }),
      });
    });
    // Tiles with `data-cms-tile-id` get a drag-handle so the editor can
    // reorder them. The CSS `order` property on flex children is the only
    // change — no DOM mutation, the visual order updates instantly and
    // the parent persists it via PATCH mediaOrdering.
    document.querySelectorAll('[data-cms-tile-id]').forEach(makeTileReorderable);
    send({ type: 'editor-ready', mode: 'page' });
    return;
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

  // --- Image swap + crop (focal-point) --------------------------------------
  // (`activeCrop` is declared at the top of the IIFE.)

  function makeImageSwappable(img, context, imageIndex, cmsId) {
    if (img.closest('[data-admin-image]')) return;
    if (img.tagName === 'VIDEO') {
      // Videos only get swap, no crop
      img.dataset.adminImageContext = context;
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
        e.preventDefault(); e.stopPropagation();
        send({ type: 'swap-image', url: img.currentSrc || img.src, context, imageIndex, cmsId });
      });
      return;
    }

    img.dataset.adminImageContext = context;
    img.dataset.adminImageIndex = imageIndex != null ? imageIndex : '';
    if (cmsId) img.dataset.adminCmsId = cmsId;
    const wrap = document.createElement('span');
    wrap.className = 'admin-image-wrap';
    wrap.setAttribute('data-admin-image', context);
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    const overlay = document.createElement('span');
    overlay.className = 'admin-image-overlay';
    // Page-mode images (with cmsId) get a third button — Größe — that opens
    // an inline panel with width + aspect-ratio chips. Post-mode (Journal
    // drafts) keeps the original two-button layout because tiles there are
    // template-driven and resizing a single one breaks the editorial flow.
    let btnsHtml =
      '<span class="admin-ol-btn" data-role="swap">↑ Austauschen</span>' +
      '<span class="admin-ol-btn" data-role="crop">✛ Komposition</span>';
    if (cmsId && context === 'page') {
      btnsHtml += '<span class="admin-ol-btn" data-role="size">↔ Größe</span>';
    }
    overlay.innerHTML = btnsHtml;
    wrap.appendChild(overlay);

    // Focal-point dot (hidden by default)
    const dot = document.createElement('span');
    dot.className = 'admin-focal-dot';
    const pos = img.style.objectPosition || '50% 50%';
    const parts = pos.split(/\s+/);
    dot.style.left = parts[0] || '50%';
    dot.style.top = parts[1] || '50%';
    wrap.appendChild(dot);

    // ONE delegated listener on the overlay handles all three buttons. We use
    // `closest('[data-role]')` so a click on a button or any of its inner
    // text nodes still resolves to the role. Earlier this code had three
    // separate addEventListener calls — Austauschen worked for the user but
    // Komposition / Größe didn't, which can happen if querySelector returned
    // a different node than expected after some DOM mutation. Delegation
    // sidesteps that whole class of bugs.
    overlay.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('[data-role]');
      if (!btn || !overlay.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      const role = btn.dataset.role;
      if (role === 'swap') {
        send({ type: 'swap-image', url: img.currentSrc || img.src, context, imageIndex, cmsId });
      } else if (role === 'crop') {
        enterCropMode(img, wrap, dot, context, imageIndex, cmsId);
      } else if (role === 'size') {
        toggleSizePanel(img, wrap, cmsId);
      }
    });
  }

  // --- Size panel (page-mode images only) ----------------------------------
  // Lives inside the image wrap. Two rows of chips: Width and Aspect ratio.
  // Each click applies the style locally for instant feedback AND fires a
  // postMessage to the parent so the JSON gets patched. Click "Fertig" or
  // outside to close. (`WIDTH_PRESETS` and `ASPECT_PRESETS` are declared at
  // the top of the IIFE so the page-mode early return doesn't hide them.)

  function toggleSizePanel(img, wrap, cmsId) {
    const existing = wrap.querySelector('.admin-size-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'admin-size-panel';
    panel.addEventListener('click', e => e.stopPropagation());

    function row(label, presets, current, onPick) {
      const r = document.createElement('div');
      r.className = 'admin-size-panel__row';
      r.innerHTML = '<span class="admin-size-panel__label">' + label + '</span>';
      const chips = document.createElement('div');
      chips.className = 'admin-size-panel__chips';
      for (const p of presets) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'admin-size-panel__chip' + (current === p.value ? ' admin-size-panel__chip--active' : '');
        b.textContent = p.label;
        b.dataset.value = p.value == null ? '' : p.value;
        b.addEventListener('click', () => {
          chips.querySelectorAll('.admin-size-panel__chip').forEach(c => c.classList.remove('admin-size-panel__chip--active'));
          b.classList.add('admin-size-panel__chip--active');
          onPick(p.value);
        });
        chips.appendChild(b);
      }
      r.appendChild(chips);
      return r;
    }

    // Determine current values from inline style — best-effort
    const tile = img.parentElement && img.parentElement.closest('[data-cms-tile-id="' + cmsId + '"]');
    const curWidth = tile && tile.style.width ? tile.style.width.replace('%', '') : null;
    const curAspect = img.style.aspectRatio || null;

    panel.appendChild(row('Breite', WIDTH_PRESETS, curWidth, value => {
      // Apply locally for instant feedback
      if (tile) {
        if (value == null) {
          tile.style.removeProperty('width');
          tile.style.removeProperty('margin-left');
          tile.style.removeProperty('margin-right');
        } else {
          tile.style.width = value + '%';
          tile.style.marginLeft = 'auto';
          tile.style.marginRight = 'auto';
        }
      }
      send({ type: 'resize-tile', cmsId, widthPercent: value });
    }));

    panel.appendChild(row('Format', ASPECT_PRESETS, curAspect, value => {
      // Local preview
      if (value == null) {
        img.style.removeProperty('aspect-ratio');
        img.style.removeProperty('object-fit');
      } else {
        img.style.aspectRatio = value;
        img.style.objectFit = 'cover';
      }
      send({ type: 'resize-tile', cmsId, aspectRatio: value });
    }));

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'admin-size-panel__done';
    done.textContent = '✓ Fertig';
    done.addEventListener('click', () => panel.remove());
    panel.appendChild(done);

    wrap.appendChild(panel);
  }

  // --- Tile reorder via drag-and-drop ---------------------------------------
  // Each [data-cms-tile-id] container gets a small drag handle. Drag a tile,
  // drop it on another tile — we compute the new ordering, apply CSS `order`
  // locally for instant feedback, and post `reorder-tiles` to the parent so
  // the JSON gets a bulk PATCH (mediaOrdering).
  //
  // Drop position: dropping on the LEFT half of a target inserts before it,
  // RIGHT half inserts after. Visual cue: gold side-stripe via CSS classes.

  function makeTileReorderable(tile) {
    if (!tile || tile.dataset.adminReorderable) return;
    tile.dataset.adminReorderable = '1';
    if (!tile.style.position) tile.style.position = 'relative';

    const handle = document.createElement('span');
    handle.className = 'admin-drag-handle';
    handle.draggable = true;
    handle.title = 'Ziehen zum Verschieben';
    handle.textContent = '⋮⋮';
    tile.appendChild(handle);

    handle.addEventListener('dragstart', (e) => {
      const cmsId = tile.dataset.cmsTileId;
      try {
        e.dataTransfer.setData('text/cms-tile-id', cmsId);
        e.dataTransfer.effectAllowed = 'move';
      } catch {}
      tile.classList.add('admin-tile--dragging');
    });
    handle.addEventListener('dragend', () => {
      tile.classList.remove('admin-tile--dragging');
      document.querySelectorAll('.admin-tile--drop-before, .admin-tile--drop-after').forEach(el => {
        el.classList.remove('admin-tile--drop-before', 'admin-tile--drop-after');
      });
    });

    // The tile itself is a drop target. We only fire the drop when the
    // pointer is over THIS tile (handle clicks bubble through here too,
    // dragover suppresses the browser's default no-drop cursor).
    tile.addEventListener('dragover', (e) => {
      // only accept our payload
      const types = e.dataTransfer && e.dataTransfer.types;
      if (!types || !Array.from(types).includes('text/cms-tile-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = tile.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      tile.classList.toggle('admin-tile--drop-before', before);
      tile.classList.toggle('admin-tile--drop-after', !before);
    });
    tile.addEventListener('dragleave', () => {
      tile.classList.remove('admin-tile--drop-before', 'admin-tile--drop-after');
    });
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/cms-tile-id');
      const targetId = tile.dataset.cmsTileId;
      const before = tile.classList.contains('admin-tile--drop-before');
      tile.classList.remove('admin-tile--drop-before', 'admin-tile--drop-after');
      if (!draggedId || draggedId === targetId) return;
      reorderTiles(draggedId, targetId, before);
    });
  }

  function reorderTiles(draggedId, targetId, insertBefore) {
    const tiles = Array.from(document.querySelectorAll('[data-cms-tile-id]'));
    // Establish current ordering (DOM order or CSS-`order` if already set)
    tiles.sort((a, b) => {
      const oa = parseInt(a.style.order || '0', 10);
      const ob = parseInt(b.style.order || '0', 10);
      if (oa !== ob) return oa - ob;
      return 0; // stable; DOM order wins for ties
    });
    const ids = tiles.map(t => t.dataset.cmsTileId);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx === -1) return;
    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) return;
    if (!insertBefore) toIdx += 1;
    ids.splice(toIdx, 0, draggedId);
    // Apply CSS order locally for instant visual feedback
    ids.forEach((id, n) => {
      const t = document.querySelector('[data-cms-tile-id="' + id + '"]');
      if (t) t.style.order = String(n);
    });
    send({ type: 'reorder-tiles', ordering: ids });
  }

  function enterCropMode(img, wrap, dot, context, imageIndex, cmsId) {
    if (activeCrop) exitCropMode(false);
    activeCrop = { img, wrap, dot, context, imageIndex, cmsId };
    wrap.classList.add('admin-image-wrap--crop');
    dot.classList.add('admin-focal-dot--active');
    badge.textContent = '✛ Komposition — klicke auf den gewünschten Bildmittelpunkt';

    function onPointerDown(e) {
      e.preventDefault();
      e.stopPropagation();
      updateFocal(e);
      function onPointerMove(ev) { ev.preventDefault(); updateFocal(ev); }
      function onPointerUp(ev) {
        ev.preventDefault();
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      }
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    }

    function updateFocal(e) {
      const rect = img.getBoundingClientRect();
      let x = ((e.clientX - rect.left) / rect.width) * 100;
      let y = ((e.clientY - rect.top) / rect.height) * 100;
      x = Math.max(0, Math.min(100, x));
      y = Math.max(0, Math.min(100, y));
      const xr = Math.round(x);
      const yr = Math.round(y);
      img.style.objectPosition = xr + '% ' + yr + '%';
      dot.style.left = xr + '%';
      dot.style.top = yr + '%';
    }

    img.addEventListener('pointerdown', onPointerDown);
    img._cropPointerDown = onPointerDown;

    // Done button
    const doneBtn = document.createElement('button');
    doneBtn.className = 'admin-crop-done';
    doneBtn.textContent = '✓ Fertig';
    doneBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      exitCropMode(true);
    });
    wrap.appendChild(doneBtn);

    // Escape key
    function onKey(e) {
      if (e.key === 'Escape') exitCropMode(true);
    }
    document.addEventListener('keydown', onKey);
    wrap._cropKeyHandler = onKey;
    wrap._cropDoneBtn = doneBtn;
  }

  function exitCropMode(save) {
    if (!activeCrop) return;
    const { img, wrap, dot, context, imageIndex, cmsId } = activeCrop;
    wrap.classList.remove('admin-image-wrap--crop');
    dot.classList.remove('admin-focal-dot--active');
    badge.textContent = '✎ Editieren — klicke auf Text oder Bild';

    if (img._cropPointerDown) {
      img.removeEventListener('pointerdown', img._cropPointerDown);
      delete img._cropPointerDown;
    }
    if (wrap._cropKeyHandler) {
      document.removeEventListener('keydown', wrap._cropKeyHandler);
      delete wrap._cropKeyHandler;
    }
    if (wrap._cropDoneBtn) {
      wrap._cropDoneBtn.remove();
      delete wrap._cropDoneBtn;
    }

    if (save) {
      const pos = img.style.objectPosition || '50% 50%';
      send({
        type: 'crop-image',
        url: img.currentSrc || img.src,
        position: pos,
        context,
        imageIndex,
        cmsId,
      });
      if (context === 'article') sendArticleUpdate();
    }
    activeCrop = null;
  }

  // Hero image
  const heroImg = document.querySelector('.editorial-hero__figure img');
  if (heroImg) makeImageSwappable(heroImg, 'hero');
  const heroVid = document.querySelector('.editorial-hero__figure video');
  if (heroVid) makeImageSwappable(heroVid, 'hero');

  // Article images and videos — each gets a unique index for per-image swap
  if (article) {
    article.querySelectorAll('img, video').forEach((img, idx) => makeImageSwappable(img, 'article', idx));
  }

  // --- Signal ready ---------------------------------------------------------
  send({ type: 'editor-ready' });
})();
