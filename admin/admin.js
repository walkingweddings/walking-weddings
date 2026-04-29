// Walking Weddings — Journal Creator frontend
// Handles auth, file uploads, Claude generation/revision, manual edits and publish.

(function () {
  'use strict';

  const TOKEN_KEY = 'ww_admin_token';
  const token = localStorage.getItem(TOKEN_KEY);

  // Auth gate: redirect to login if missing token
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // --- State ----------------------------------------------------------------

  const state = {
    media: [],       // [{ url, type, filename, caption }]
    draftId: null,
    draft: null,
    sourceSlug: null, // when editing a published post, the slug it originated from
  };

  // --- DOM refs -------------------------------------------------------------

  const $ = id => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const reviseDropzone = $('reviseDropzone');
  const reviseFileInput = $('reviseFileInput');
  const mediaListEl = $('mediaList');
  const promptInput = $('promptInput');
  const generateBtn = $('generateBtn');
  const draftSection = $('draftSection');
  const reviseSection = $('reviseSection');
  const publishSection = $('publishSection');
  const revisionInput = $('revisionInput');
  const reviseBtn = $('reviseBtn');
  const publishBtn = $('publishBtn');
  const previewFrame = $('previewFrame');
  const previewWrap = $('previewFrameWrap');
  const previewPlaceholder = $('previewPlaceholder');
  const refreshPreviewBtn = $('refreshPreviewBtn');
  const logoutBtn = $('logoutBtn');
  const managePostsBtn = $('managePostsBtn');
  const manageOverlay = $('manageOverlay');
  const manageCloseBtn = $('manageCloseBtn');
  const manageRefreshBtn = $('manageRefreshBtn');
  const manageList = $('manageList');
  const managePostCount = $('managePostCount');
  const manageSearch = $('manageSearch');
  const tabPostsCount = $('tabPostsCount');
  const tabDraftsCount = $('tabDraftsCount');
  const editModeBanner = $('editModeBanner');
  const editModeTitle = $('editModeTitle');
  const newDraftBtn = $('newDraftBtn');
  const userEmailEl = $('userEmail');
  const claudeStatusEl = $('claudeStatus');
  const toast = $('toast');
  const overlay = $('overlay');
  const overlayText = $('overlayText');

  // --- Helpers --------------------------------------------------------------

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(path, opts = {}) {
    const headers = Object.assign(
      { 'Authorization': 'Bearer ' + token },
      opts.headers || {}
    );
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = 'login.html';
      throw new Error('Session abgelaufen');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    return data;
  }

  function showToast(msg, type = 'info', ms = 3800) {
    toast.textContent = msg;
    toast.className = 'admin-toast admin-toast--' + type;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, ms);
  }

  function showOverlay(text) {
    overlayText.textContent = text || 'Einen Moment…';
    overlay.hidden = false;
  }
  function hideOverlay() { overlay.hidden = true; }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = String(reader.result || '');
        const idx = r.indexOf(',');
        resolve(r.slice(idx + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // --- Session check --------------------------------------------------------

  api('/api/admin/me').then(data => {
    userEmailEl.textContent = data.email;
    if (data.hasClaudeKey) {
      claudeStatusEl.textContent = 'Claude · ' + (data.model || 'aktiv');
      claudeStatusEl.classList.add('admin-pill--ok');
    } else {
      claudeStatusEl.textContent = 'Claude: kein API-Key';
      claudeStatusEl.classList.add('admin-pill--err');
    }
  }).catch(() => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = 'login.html';
  });

  logoutBtn.addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = 'login.html';
  });

  // --- View router ----------------------------------------------------------
  // Hash-based routing keeps everything in this single SPA file. Switching
  // views just shows/hides the matching <section data-view="..."> and toggles
  // the active class on the corresponding nav link. The journal view remains
  // the default; placeholders for other views are wired up here so navigating
  // works today, even before their real UIs exist.

  const VIEWS = ['journal', 'pages', 'inquiries', 'media'];
  const viewSections = new Map();
  const viewLinks = new Map();
  document.querySelectorAll('[data-view]').forEach(el => viewSections.set(el.dataset.view, el));
  document.querySelectorAll('[data-view-link]').forEach(el => viewLinks.set(el.dataset.viewLink, el));

  const viewActivators = {};

  function setView(name) {
    if (!VIEWS.includes(name)) name = 'journal';
    viewSections.forEach((el, key) => { el.hidden = (key !== name); });
    viewLinks.forEach((el, key) => { el.classList.toggle('admin-nav__link--active', key === name); });
    if (viewActivators[name]) {
      try { viewActivators[name](); } catch (err) { console.error(name, 'activator failed:', err); }
    }
  }

  function readHashView() {
    const m = String(window.location.hash || '').match(/^#\/(\w+)/);
    return m && VIEWS.includes(m[1]) ? m[1] : 'journal';
  }

  window.addEventListener('hashchange', () => setView(readHashView()));
  setView(readHashView());

  // --- Pages view (CMS for public pages) ------------------------------------

  const pagesState = {
    initialized: false,
    pages: [],
    activeSlug: null,
    swapping: null, // { kind: 'media'|'field', cmsId } when waiting on file picker
  };

  const pagesListEntries = $('pagesListEntries');
  const pagesPreviewFrame = $('pagesPreviewFrame');
  const pagesPreviewWrap = $('pagesPreviewWrap');
  const pagesPreviewPlaceholder = $('pagesPreviewPlaceholder');
  const pagesPreviewEyebrow = $('pagesPreviewEyebrow');
  const pagesPreviewCaption = $('pagesPreviewCaption');
  const pagesRefreshBtn = $('pagesRefreshBtn');
  const pagesUploadInput = $('pagesUploadInput');

  async function loadPagesList() {
    try {
      const data = await api('/api/admin/pages');
      pagesState.pages = data.pages || [];
      renderPagesList();
    } catch (err) {
      pagesListEntries.innerHTML = '<div class="admin-manage__placeholder">Fehler: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderPagesList() {
    if (!pagesState.pages.length) {
      pagesListEntries.innerHTML = '<div class="admin-manage__placeholder">Keine Seiten registriert.</div>';
      return;
    }
    pagesListEntries.innerHTML = pagesState.pages.map(p => {
      const stamp = p.updatedAt ? new Date(p.updatedAt).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' }) : 'Noch nicht bearbeitet';
      const active = p.slug === pagesState.activeSlug ? ' admin-pages-card--active' : '';
      return `
        <button type="button" class="admin-pages-card${active}" data-page-slug="${escapeHtml(p.slug)}">
          <span class="admin-pages-card__eyebrow">${escapeHtml(p.eyebrow || '')}</span>
          <span class="admin-pages-card__title">${escapeHtml(p.title)}</span>
          <span class="admin-pages-card__sub">${escapeHtml(p.description || '')}</span>
          <span class="admin-pages-card__meta">Zuletzt: ${escapeHtml(stamp)}</span>
        </button>`;
    }).join('');
    pagesListEntries.querySelectorAll('[data-page-slug]').forEach(btn => {
      btn.addEventListener('click', () => openPage(btn.dataset.pageSlug));
    });
  }

  function openPage(slug) {
    const meta = pagesState.pages.find(p => p.slug === slug);
    if (!meta) return;
    pagesState.activeSlug = slug;
    pagesPreviewEyebrow.textContent = meta.eyebrow || meta.title;
    pagesPreviewCaption.textContent = 'Live-Vorschau · /' + meta.slug + '.html';
    pagesPreviewPlaceholder.hidden = true;
    pagesPreviewFrame.hidden = false;
    pagesRefreshBtn.disabled = false;
    pagesPreviewFrame.src = '/api/admin/preview/page/' + encodeURIComponent(slug) +
      '?token=' + encodeURIComponent(token) + '&t=' + Date.now();
    renderPagesList(); // re-render to highlight active card
  }

  function refreshPagesPreview() {
    if (!pagesState.activeSlug) return;
    pagesPreviewFrame.src = '/api/admin/preview/page/' + encodeURIComponent(pagesState.activeSlug) +
      '?token=' + encodeURIComponent(token) + '&t=' + Date.now();
  }
  pagesRefreshBtn.addEventListener('click', refreshPagesPreview);

  document.querySelectorAll('[data-page-device]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-page-device]').forEach(t => t.classList.remove('admin-tab--active'));
      tab.classList.add('admin-tab--active');
      pagesPreviewWrap.dataset.device = tab.dataset.pageDevice;
    });
  });

  // postMessage from preview iframe
  window.addEventListener('message', (e) => {
    if (!pagesState.activeSlug || !e.data || typeof e.data !== 'object') return;
    if (e.source !== pagesPreviewFrame.contentWindow) return; // only handle our pages iframe
    const msg = e.data;
    const slug = pagesState.activeSlug;

    if (msg.type === 'edit-field' && msg.cmsId) {
      // For headings (single line) we trust plainValue; for prose we keep HTML.
      // The decision is heuristic: if innerHTML has tags we don't recognize as
      // text-only (em, strong, br), use plainValue. Otherwise html.
      const html = String(msg.value || '');
      const hasInline = /<(em|strong|br|i|b|span|a)\b/i.test(html);
      const hasOther = /<(?!\/?(em|strong|br|i|b|span|a)\b)[a-z]/i.test(html);
      const useHtml = hasInline && !hasOther;
      const value = useHtml ? html : (msg.plainValue || '').trim();
      patchPage(slug, { fieldId: msg.cmsId, fieldType: useHtml ? 'html' : 'text', value });
      return;
    }

    if (msg.type === 'swap-image' && msg.cmsId) {
      pagesState.swapping = { kind: 'media', cmsId: msg.cmsId };
      pagesUploadInput.click();
      return;
    }

    if (msg.type === 'crop-image' && msg.cmsId && msg.position) {
      patchPage(slug, { mediaId: msg.cmsId, objectPosition: msg.position });
      return;
    }

    // Tile resize from the page-mode "Größe" panel. Either widthPercent or
    // aspectRatio (or both) may be present; an explicit `null` resets the
    // override (see applyPatch in pages-api.js).
    if (msg.type === 'resize-tile' && msg.cmsId) {
      const patch = { mediaId: msg.cmsId };
      if ('widthPercent' in msg) patch.widthPercent = msg.widthPercent;
      if ('aspectRatio' in msg) patch.aspectRatio = msg.aspectRatio;
      patchPage(slug, patch);
      return;
    }
  });

  pagesUploadInput.addEventListener('change', async (e) => {
    const file = (e.target.files || [])[0];
    pagesUploadInput.value = '';
    if (!file || !pagesState.swapping || !pagesState.activeSlug) return;
    const swap = pagesState.swapping;
    pagesState.swapping = null;
    showOverlay('Bild wird hochgeladen…');
    try {
      const b64 = await fileToBase64(file);
      const up = await api('/api/admin/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64: b64 }),
      });
      const mediaType = up.type === 'video' ? 'video' : 'image';
      await patchPage(pagesState.activeSlug, {
        mediaId: swap.cmsId,
        url: up.url,
        mediaType,
      });
      refreshPagesPreview();
      showToast('Medium ausgetauscht', 'success');
    } catch (err) {
      showToast('Upload fehlgeschlagen: ' + err.message, 'error', 6000);
    } finally {
      hideOverlay();
    }
  });

  async function patchPage(slug, patch) {
    try {
      await api('/api/admin/pages/' + encodeURIComponent(slug), {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    } catch (err) {
      showToast('Speichern fehlgeschlagen: ' + err.message, 'error', 6000);
    }
  }

  viewActivators.pages = function () {
    if (!pagesState.initialized) {
      pagesState.initialized = true;
      loadPagesList();
    }
  };

  // --- Inquiries view -------------------------------------------------------

  const inquiriesState = {
    initialized: false,
    filter: 'new',  // 'new' | 'contacted' | 'all'
    items: [],
    activeId: null,
    activeRecord: null,
  };

  const inquiriesListEntries = $('inquiriesListEntries');
  const inquiriesPane = $('inquiriesPane');
  const inquiriesPlaceholder = $('inquiriesPlaceholder');
  const inqCountNewBadge = $('inqCountNew');
  const navInquiriesBadge = $('navInquiriesBadge');

  function updateInquiriesBadge(unread) {
    const n = unread || 0;
    inqCountNewBadge.textContent = String(n);
    if (n > 0) {
      navInquiriesBadge.textContent = String(n);
      navInquiriesBadge.hidden = false;
    } else {
      navInquiriesBadge.hidden = true;
    }
  }

  async function loadInquiriesList() {
    try {
      const params = new URLSearchParams();
      if (inquiriesState.filter !== 'all') params.set('status', inquiriesState.filter);
      const data = await api('/api/admin/leads' + (params.toString() ? '?' + params : ''));
      inquiriesState.items = data.items || [];
      updateInquiriesBadge(data.unreadCount);
      renderInquiriesList();
    } catch (err) {
      inquiriesListEntries.innerHTML = '<div class="admin-manage__placeholder">Fehler: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderInquiriesList() {
    if (!inquiriesState.items.length) {
      inquiriesListEntries.innerHTML = '<div class="admin-manage__placeholder">Keine Anfragen in dieser Ansicht.</div>';
      return;
    }
    inquiriesListEntries.innerHTML = inquiriesState.items.map(it => {
      const date = new Date(it.createdAt).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'2-digit' });
      const time = new Date(it.createdAt).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
      const active = it.id === inquiriesState.activeId ? ' admin-inquiry-card--active' : '';
      const statusBadge = it.status === 'new' ? '<span class="admin-inquiry-card__pill admin-inquiry-card__pill--new">Neu</span>'
        : it.status === 'contacted' ? '<span class="admin-inquiry-card__pill admin-inquiry-card__pill--contacted">Kontaktiert</span>'
        : '<span class="admin-inquiry-card__pill admin-inquiry-card__pill--archived">Archiviert</span>';
      const pkg = it.summary && it.summary.package ? '<span class="admin-inquiry-card__tag">' + escapeHtml(it.summary.package) + '</span>' : '';
      return `
        <button type="button" class="admin-inquiry-card${active}" data-inquiry-id="${escapeHtml(it.id)}">
          <span class="admin-inquiry-card__top">${statusBadge}<span class="admin-inquiry-card__date">${escapeHtml(date)} · ${escapeHtml(time)}</span></span>
          <span class="admin-inquiry-card__name">${escapeHtml((it.summary && it.summary.name) || '—')}</span>
          <span class="admin-inquiry-card__email">${escapeHtml((it.summary && it.summary.email) || '')}</span>
          <span class="admin-inquiry-card__meta">${escapeHtml((it.summary && it.summary.eventType) || '')}${pkg}</span>
        </button>`;
    }).join('');
    inquiriesListEntries.querySelectorAll('[data-inquiry-id]').forEach(btn => {
      btn.addEventListener('click', () => openInquiry(btn.dataset.inquiryId));
    });
  }

  document.querySelectorAll('[data-inquiry-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-inquiry-filter]').forEach(b => b.classList.remove('admin-inquiries-filter__btn--active'));
      btn.classList.add('admin-inquiries-filter__btn--active');
      inquiriesState.filter = btn.dataset.inquiryFilter;
      loadInquiriesList();
    });
  });

  async function openInquiry(id) {
    inquiriesState.activeId = id;
    renderInquiriesList();
    inquiriesPlaceholder.hidden = true;
    inquiriesPane.hidden = false;
    inquiriesPane.innerHTML = '<div class="admin-manage__placeholder">Lade…</div>';
    try {
      const data = await api('/api/admin/leads/' + encodeURIComponent(id));
      inquiriesState.activeRecord = data.lead;
      renderInquiryDetail(data.lead);
    } catch (err) {
      inquiriesPane.innerHTML = '<div class="admin-manage__placeholder">Fehler: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderInquiryDetail(rec) {
    const lead = rec.lead || {};
    const created = new Date(rec.createdAt).toLocaleString('de-DE');
    const updated = new Date(rec.lastUpdatedAt).toLocaleString('de-DE');
    function row(label, value) {
      return value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : '';
    }
    const refs = lead.referral && (
      lead.referral === 'Wedding Planner' && lead.referralPlanner ? `${lead.referral} — ${lead.referralPlanner}`
      : lead.referral === 'Hochzeit' && lead.referralWedding ? `${lead.referral} — ${lead.referralWedding}`
      : lead.referral === 'Sonstiges' && lead.referralOther ? `${lead.referral} — ${lead.referralOther}`
      : lead.referral
    );

    inquiriesPane.innerHTML = `
      <header class="admin-inquiry-detail__header">
        <div>
          <p class="admin-section__eyebrow">${escapeHtml(rec.status === 'new' ? 'Neue Anfrage' : rec.status === 'contacted' ? 'Kontaktiert' : 'Archiviert')}</p>
          <h2 class="admin-inquiry-detail__title">${escapeHtml(lead.name || '—')}</h2>
          <p class="admin-inquiry-detail__sub">${escapeHtml(created)} · ${escapeHtml(lead.email || '')}</p>
        </div>
        <div class="admin-inquiry-detail__actions">
          <select id="inqStatus" class="admin-inquiry-detail__select">
            <option value="new" ${rec.status==='new'?'selected':''}>Neu</option>
            <option value="contacted" ${rec.status==='contacted'?'selected':''}>Kontaktiert</option>
            <option value="archived" ${rec.status==='archived'?'selected':''}>Archiviert</option>
          </select>
          <button class="admin-btn admin-btn--ghost admin-btn--small" id="inqDelete">Verwerfen</button>
        </div>
      </header>

      <div class="admin-inquiry-detail__grid">
        <div class="admin-inquiry-detail__col">
          <h3 class="admin-inquiry-detail__sectionTitle">Kontakt</h3>
          <table class="admin-inquiry-detail__table">
            ${row('Anfrage von', lead.role === 'planner' ? 'Wedding Planner' : 'Hochzeitspaar')}
            ${row('Name', lead.name)}
            ${row('Firma', lead.company)}
            ${row('Telefon', lead.phone)}
            ${row('E-Mail', lead.email)}
            ${row('Woher', refs)}
          </table>
        </div>
        <div class="admin-inquiry-detail__col">
          <h3 class="admin-inquiry-detail__sectionTitle">Veranstaltung</h3>
          <table class="admin-inquiry-detail__table">
            ${row('Art', lead.eventType)}
            ${row('Paket', lead.package)}
            ${row('Datum', lead.noDate ? 'Noch kein fixes Datum' : (lead.dates||[]).join(', '))}
            ${row('Location', lead.noLocation ? 'Noch keine Location' : (lead.locations||[]).join(', '))}
            ${row('Interesse', (lead.interesse||[]).join(', '))}
            ${row('Zusatzprodukte', (lead.zusatz||[]).join(', '))}
            ${row('Stunden', lead.hours)}
            ${row('Budget', lead.budget)}
          </table>
        </div>
      </div>

      ${lead.message ? `<div class="admin-inquiry-detail__message">
        <h3 class="admin-inquiry-detail__sectionTitle">Nachricht</h3>
        <p>${escapeHtml(lead.message).replace(/\n/g,'<br>')}</p>
      </div>` : ''}

      <div class="admin-inquiry-detail__notes">
        <h3 class="admin-inquiry-detail__sectionTitle">Notizen</h3>
        <textarea id="inqNotes" class="admin-textarea" rows="4" placeholder="Interne Notizen…">${escapeHtml(rec.notes || '')}</textarea>
        <p class="admin-inquiry-detail__updated">Zuletzt aktualisiert: ${escapeHtml(updated)}</p>
      </div>
    `;

    document.getElementById('inqStatus').addEventListener('change', async (e) => {
      const newStatus = e.target.value;
      try {
        const data = await api('/api/admin/leads/' + encodeURIComponent(rec.id), {
          method: 'PATCH', body: JSON.stringify({ status: newStatus }),
        });
        inquiriesState.activeRecord = data.lead;
        updateInquiriesBadge(data.unreadCount);
        showToast('Status aktualisiert', 'success');
        loadInquiriesList();
      } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
    });

    let notesTimer = null;
    document.getElementById('inqNotes').addEventListener('input', (e) => {
      clearTimeout(notesTimer);
      const v = e.target.value;
      notesTimer = setTimeout(async () => {
        try {
          await api('/api/admin/leads/' + encodeURIComponent(rec.id), {
            method: 'PATCH', body: JSON.stringify({ notes: v }),
          });
        } catch (err) { showToast('Notiz speichern fehlgeschlagen: ' + err.message, 'error'); }
      }, 700);
    });

    document.getElementById('inqDelete').addEventListener('click', async () => {
      if (!confirm('Diese Anfrage ins Archiv verschieben?')) return;
      try {
        const data = await api('/api/admin/leads/' + encodeURIComponent(rec.id), { method: 'DELETE' });
        updateInquiriesBadge(data.unreadCount);
        inquiriesState.activeId = null;
        inquiriesState.activeRecord = null;
        inquiriesPane.hidden = true;
        inquiriesPlaceholder.hidden = false;
        showToast('Anfrage archiviert', 'success');
        loadInquiriesList();
      } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
    });
  }

  viewActivators.inquiries = function () {
    if (!inquiriesState.initialized) {
      inquiriesState.initialized = true;
    }
    loadInquiriesList();
  };

  // Background poll for unread badge — updates the nav rail counter even when
  // the Inquiries view isn't open. Lightweight: one GET every 60s.
  api('/api/admin/leads?status=new&limit=1').then(d => updateInquiriesBadge(d.unreadCount)).catch(() => {});
  setInterval(() => {
    api('/api/admin/leads?status=new&limit=1').then(d => updateInquiriesBadge(d.unreadCount)).catch(() => {});
  }, 60000);

  // --- Media library view ---------------------------------------------------

  const mediaGridEl = $('mediaGrid');
  const mediaCountEl = $('mediaCount');
  const mediaRefreshBtn = $('mediaRefreshBtn');

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  async function loadMediaGrid() {
    try {
      const data = await api('/api/admin/media');
      renderMediaGrid(data.items || []);
    } catch (err) {
      mediaGridEl.innerHTML = '<div class="admin-manage__placeholder">Fehler: ' + escapeHtml(err.message) + '</div>';
      mediaCountEl.textContent = '';
    }
  }

  function renderMediaGrid(items) {
    mediaCountEl.textContent = items.length + ' ' + (items.length === 1 ? 'Datei' : 'Dateien');
    if (!items.length) {
      mediaGridEl.innerHTML = '<div class="admin-manage__placeholder">Keine Medien hochgeladen.</div>';
      return;
    }
    mediaGridEl.innerHTML = items.map(it => {
      const date = new Date(it.mtime).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'2-digit' });
      const preview = it.type === 'video'
        ? `<video src="${escapeHtml(it.url)}" muted></video>`
        : `<img src="${escapeHtml(it.url)}" alt="" loading="lazy">`;
      return `
        <div class="admin-media-card" data-media-filename="${escapeHtml(it.filename)}" data-media-url="${escapeHtml(it.url)}">
          <div class="admin-media-card__preview">${preview}</div>
          <div class="admin-media-card__meta">
            <span class="admin-media-card__type">${it.type === 'video' ? 'Video' : 'Bild'}</span>
            <span class="admin-media-card__size">${fmtSize(it.size)}</span>
            <span class="admin-media-card__date">${escapeHtml(date)}</span>
          </div>
          <div class="admin-media-card__actions">
            <button class="admin-btn admin-btn--ghost admin-btn--small" data-media-action="copy">URL kopieren</button>
            <button class="admin-btn admin-btn--ghost admin-btn--small" data-media-action="delete">Löschen</button>
          </div>
        </div>`;
    }).join('');

    mediaGridEl.querySelectorAll('[data-media-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = e.target.closest('[data-media-filename]');
        const filename = card.dataset.mediaFilename;
        const url = card.dataset.mediaUrl;
        if (e.target.dataset.mediaAction === 'copy') {
          try {
            await navigator.clipboard.writeText(url);
            showToast('URL kopiert', 'success', 1800);
          } catch { showToast('Kopieren fehlgeschlagen — bitte manuell', 'error'); }
          return;
        }
        if (e.target.dataset.mediaAction === 'delete') {
          await deleteMediaFile(filename);
        }
      });
    });
  }

  async function deleteMediaFile(filename) {
    // Step 1: ask the server which posts/pages reference this URL
    let refs = [];
    try {
      const data = await api('/api/admin/media/' + encodeURIComponent(filename) + '/refs');
      refs = data.refs || [];
    } catch (err) {
      showToast('Reference-Check fehlgeschlagen: ' + err.message, 'error');
      return;
    }
    let force = false;
    if (refs.length) {
      const list = refs.map(r => `· ${r.source}/${r.file}`).join('\n');
      if (!confirm(
        `Diese Datei wird noch verwendet in:\n\n${list}\n\nTrotzdem löschen?`
      )) return;
      force = true;
    } else {
      if (!confirm(`"${filename}" endgültig löschen? Die Datei wird auch aus dem Repo entfernt.`)) return;
    }
    try {
      await api('/api/admin/media/' + encodeURIComponent(filename) + (force ? '?force=1' : ''), { method: 'DELETE' });
      showToast('Datei gelöscht', 'success');
      loadMediaGrid();
    } catch (err) {
      showToast('Löschen fehlgeschlagen: ' + err.message, 'error', 6000);
    }
  }

  mediaRefreshBtn.addEventListener('click', loadMediaGrid);

  // Duplicate detection + consolidation. Two-step: preview, then execute.
  // The server hashes every upload, groups by content, picks the oldest as
  // canonical and rewrites all references in JSON sources + rendered blog
  // HTML before deleting the duplicates. So no image goes missing.
  const mediaDedupeBtn = $('mediaDedupeBtn');
  mediaDedupeBtn.addEventListener('click', async () => {
    showOverlay('Suche Duplikate…');
    let plan;
    try {
      plan = await api('/api/admin/media/duplicates');
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
      return;
    }
    hideOverlay();
    if (!plan.totalGroups) {
      showToast('Keine Duplikate gefunden.', 'success');
      return;
    }
    const sample = plan.groups.slice(0, 6).map(g => {
      const dupNames = g.duplicates.map(d => d.filename.slice(-40)).join(', ');
      return `· bleibt: ${g.canonical.filename.slice(-40)}\n  ersetzt: ${dupNames}`;
    }).join('\n');
    const more = plan.groups.length > 6 ? `\n…und ${plan.groups.length - 6} weitere Gruppen` : '';
    const proceed = confirm(
      `${plan.totalGroups} Duplikat-Gruppen gefunden.\n` +
      `${plan.totalDupes} Dateien werden gelöscht (~${(plan.sizeReclaimed/1024/1024).toFixed(1)} MB).\n` +
      `Verweise in Pages, Posts, Drafts und Blog-HTML werden vorher auf das Original umgebogen — kein Bild geht verloren.\n\n` +
      `${sample}${more}\n\n` +
      `Bereinigung jetzt durchführen?`
    );
    if (!proceed) return;

    showOverlay('Verweise umbiegen und Duplikate löschen…');
    try {
      const report = await api('/api/admin/media/dedupe', { method: 'POST' });
      showToast(
        `Fertig: ${report.filesDeleted.length} Dateien gelöscht, ${report.filesUpdated.length} Quelldateien aktualisiert.`,
        'success', 6000
      );
      loadMediaGrid();
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error', 6000);
    } finally {
      hideOverlay();
    }
  });

  viewActivators.media = function () { loadMediaGrid(); };

  // --- Media upload ---------------------------------------------------------

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev =>
    dropzone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('admin-dropzone--over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    dropzone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('admin-dropzone--over');
    })
  );
  dropzone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files || []);
    handleFiles(files);
  });
  fileInput.addEventListener('change', e => {
    handleFiles(Array.from(e.target.files || []));
    fileInput.value = '';
  });

  // Revise dropzone — shares handleFiles so new uploads are available to Claude
  reviseDropzone.addEventListener('click', () => reviseFileInput.click());
  reviseDropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reviseFileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev =>
    reviseDropzone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      reviseDropzone.classList.add('admin-dropzone--over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    reviseDropzone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      reviseDropzone.classList.remove('admin-dropzone--over');
    })
  );
  reviseDropzone.addEventListener('drop', e => {
    handleFiles(Array.from(e.dataTransfer.files || []));
  });
  reviseFileInput.addEventListener('change', e => {
    handleFiles(Array.from(e.target.files || []));
    reviseFileInput.value = '';
  });

  async function handleFiles(files) {
    if (!files.length) return;
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        showToast('Unsupported: ' + file.name, 'error');
        continue;
      }
      // Add placeholder to UI immediately
      const placeholder = {
        url: null,
        type: file.type.startsWith('video/') ? 'video' : 'image',
        filename: file.name,
        uploading: true,
        progressText: 'Upload…',
      };
      state.media.push(placeholder);
      renderMediaList();
      try {
        const dataBase64 = await fileToBase64(file);
        const data = await api('/api/admin/upload', {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            dataBase64,
          }),
        });
        placeholder.url = data.url;
        placeholder.type = data.type;
        placeholder.uploading = false;
        delete placeholder.progressText;
        renderMediaList();
      } catch (err) {
        showToast('Upload fehlgeschlagen: ' + err.message, 'error');
        const idx = state.media.indexOf(placeholder);
        if (idx !== -1) state.media.splice(idx, 1);
        renderMediaList();
      }
    }
    // Persist new media on the active draft so revise/publish see them
    if (state.draftId) {
      try { await syncDraftToServer(); } catch {}
    }
  }

  function renderMediaList() {
    mediaListEl.innerHTML = '';
    state.media.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'admin-media-item';

      if (m.url) {
        if (m.type === 'video') {
          const v = document.createElement('video');
          v.src = m.url;
          v.muted = true;
          v.playsInline = true;
          v.preload = 'metadata';
          item.appendChild(v);
        } else {
          const img = document.createElement('img');
          img.src = m.url;
          img.alt = m.filename || '';
          item.appendChild(img);
        }
      }

      const idx = document.createElement('span');
      idx.className = 'admin-media-item__index';
      idx.textContent = '№ ' + (i + 1);
      item.appendChild(idx);

      const typeLabel = document.createElement('span');
      typeLabel.className = 'admin-media-item__type';
      typeLabel.textContent = m.type === 'video' ? 'Video' : 'Foto';
      item.appendChild(typeLabel);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'admin-media-item__remove';
      removeBtn.setAttribute('aria-label', 'Entfernen');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.media.splice(i, 1);
        renderMediaList();
        if (state.draftId) syncDraftToServer().catch(() => {});
      });
      item.appendChild(removeBtn);

      if (m.uploading) {
        const p = document.createElement('div');
        p.className = 'admin-media-item__progress';
        p.textContent = m.progressText || 'Upload…';
        item.appendChild(p);
      }

      mediaListEl.appendChild(item);
    });
  }

  // --- Draft generation -----------------------------------------------------

  generateBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      showToast('Bitte ein Briefing eingeben', 'error');
      return;
    }
    const mediaForApi = state.media
      .filter(m => m.url && !m.uploading)
      .map(m => ({ url: m.url, type: m.type, filename: m.filename }));

    showOverlay('Claude schreibt den Entwurf…');
    try {
      const data = await api('/api/admin/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, media: mediaForApi }),
      });
      state.draftId = data.id;
      state.draft = data.draft;
      renderDraftFields();
      showDraftSections();
      loadPreview();
      showToast('Entwurf erstellt', 'success');
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error', 6000);
    } finally {
      hideOverlay();
    }
  });

  // --- Revision -------------------------------------------------------------

  reviseBtn.addEventListener('click', async () => {
    const revisionPrompt = revisionInput.value.trim();
    if (!revisionPrompt) {
      showToast('Bitte beschreibe, was geändert werden soll', 'error');
      return;
    }
    if (!state.draftId) return;

    // Persist any manual field edits before revising
    await syncDraftToServer();

    showOverlay('Claude überarbeitet den Entwurf…');
    try {
      const data = await api('/api/admin/revise', {
        method: 'POST',
        body: JSON.stringify({
          id: state.draftId,
          revisionPrompt,
        }),
      });
      state.draft = data.draft;
      renderDraftFields();
      revisionInput.value = '';
      loadPreview();
      showToast('Änderungen angewendet', 'success');
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error', 6000);
    } finally {
      hideOverlay();
    }
  });

  // --- Draft fields ---------------------------------------------------------

  function renderDraftFields() {
    if (!state.draft) return;
    document.querySelectorAll('[data-field]').forEach(el => {
      const key = el.getAttribute('data-field');
      el.value = state.draft[key] || '';
    });
  }

  document.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      if (!state.draft) return;
      const key = el.getAttribute('data-field');
      state.draft[key] = el.value;
    });
    el.addEventListener('change', () => {
      syncDraftToServer().then(loadPreview);
    });
  });

  async function syncDraftToServer() {
    if (!state.draftId || !state.draft) return;
    try {
      const mediaForApi = state.media
        .filter(m => m.url && !m.uploading)
        .map(m => ({ url: m.url, type: m.type, filename: m.filename }));
      await api('/api/admin/draft-update', {
        method: 'POST',
        body: JSON.stringify({
          id: state.draftId,
          draft: state.draft,
          media: mediaForApi,
        }),
      });
    } catch (err) {
      showToast('Speichern fehlgeschlagen: ' + err.message, 'error');
      throw err;
    }
  }

  // --- Preview --------------------------------------------------------------

  function loadPreview() {
    if (!state.draftId) return;
    previewPlaceholder.hidden = true;
    previewFrame.hidden = false;
    const src = '/api/admin/preview/' + state.draftId + '?token=' + encodeURIComponent(token) + '&t=' + Date.now();
    previewFrame.src = src;
  }

  refreshPreviewBtn.addEventListener('click', async () => {
    await syncDraftToServer();
    loadPreview();
  });

  // --- Inline edits from preview iframe -------------------------------------
  // The preview injects a script that makes texts contentEditable and images
  // clickable. Changes arrive here as postMessage events.

  let pendingInlineSync = null;
  function queueInlineSync() {
    clearTimeout(pendingInlineSync);
    pendingInlineSync = setTimeout(() => {
      syncDraftToServer().catch(() => {});
    }, 300);
  }

  window.addEventListener('message', async (e) => {
    if (e.origin !== window.location.origin) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (!state.draft) return;

    if (msg.type === 'edit-field') {
      const field = msg.field;
      if (!field) return;
      // For the title field, msg.value is the inner HTML (with <em>). Also sync
      // plainTitle from the text content so both stay in sync.
      state.draft[field] = msg.value;
      if (field === 'title' && msg.plainValue != null) {
        state.draft.plainTitle = msg.plainValue;
        const pt = $('f_plainTitle');
        if (pt) pt.value = msg.plainValue;
      }
      const input = $('f_' + field);
      if (input) input.value = msg.value;
      queueInlineSync();
      return;
    }

    if (msg.type === 'edit-article') {
      state.draft.articleInner = msg.value;
      renderArticleImages();
      queueInlineSync();
      return;
    }

    if (msg.type === 'swap-image') {
      swappingUrl = msg.url;
      swappingContext = msg.context || 'article';
      swappingIndex = msg.imageIndex != null ? msg.imageIndex : -1;
      uploadArticleInput.click();
      return;
    }

    if (msg.type === 'crop-image') {
      const pos = msg.position || '50% 50%';
      if (msg.context === 'hero') {
        state.draft.heroImagePosition = pos;
        state.draft.cardImagePosition = pos;
      }
      // Article images: the position is already in the style attribute of the
      // <img> tag inside articleInner (set by the preview editor). The
      // articleInner is serialized via the 'edit-article' message which fires
      // right after crop-image for article context. For hero, we just need
      // to sync the field values.
      queueInlineSync();
      showToast('Komposition gespeichert', 'success');
      return;
    }
  });

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('admin-tab--active'));
      tab.classList.add('admin-tab--active');
      previewWrap.dataset.device = tab.dataset.device;
    });
  });

  function showDraftSections() {
    draftSection.hidden = false;
    reviseSection.hidden = false;
    publishSection.hidden = false;
    renderArticleImages();
    renderCoverPreviews();
  }

  // --- Cover image upload ---------------------------------------------------

  const uploadHeroInput = $('uploadHeroImage');
  const uploadCardInput = $('uploadCardImage');
  const heroPreview = $('heroImagePreview');
  const cardPreview = $('cardImagePreview');

  function renderCoverPreviews() {
    if (!state.draft) {
      heroPreview.innerHTML = '';
      cardPreview.innerHTML = '';
      return;
    }
    renderCoverThumb(heroPreview, state.draft.heroImageUrl);
    renderCoverThumb(cardPreview, state.draft.cardImageUrl);
  }

  function renderCoverThumb(container, url) {
    if (!url) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<img src="' + escapeHtml(url) + '" alt="Vorschau">';
  }

  document.querySelectorAll('.admin-upload-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.uploadTarget;
      if (target === 'heroImageUrl') uploadHeroInput.click();
      else if (target === 'cardImageUrl') uploadCardInput.click();
    });
  });

  uploadHeroInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadCoverImage(file, 'heroImageUrl');
    uploadHeroInput.value = '';
  });

  uploadCardInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadCoverImage(file, 'cardImageUrl');
    uploadCardInput.value = '';
  });

  async function uploadCoverImage(file, field) {
    showOverlay('Bild wird hochgeladen…');
    try {
      const dataBase64 = await fileToBase64(file);
      const data = await api('/api/admin/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          dataBase64,
        }),
      });
      hideOverlay();
      if (!state.draft) return;
      const oldHero = state.draft.heroImageUrl;
      state.draft[field] = data.url;
      if (field === 'heroImageUrl') {
        const cInput = $('f_cardImageUrl');
        if (!state.draft.cardImageUrl || state.draft.cardImageUrl === oldHero) {
          state.draft.cardImageUrl = data.url;
          if (cInput) cInput.value = data.url;
        }
      }
      const input = $('f_' + field);
      if (input) input.value = data.url;
      renderCoverPreviews();
      await syncDraftToServer();
      loadPreview();
      showToast('Cover-Bild aktualisiert', 'success');
    } catch (err) {
      hideOverlay();
      showToast('Upload fehlgeschlagen: ' + err.message, 'error', 6000);
    }
  }

  $('f_heroImageUrl').addEventListener('change', renderCoverPreviews);
  $('f_cardImageUrl').addEventListener('change', renderCoverPreviews);

  // --- Article image swap ---------------------------------------------------

  const articleImagesSection = $('articleImagesSection');
  const articleImagesList = $('articleImagesList');
  const uploadArticleInput = $('uploadArticleImage');
  let swappingUrl = null;
  let swappingContext = 'article'; // 'article' | 'hero'
  let swappingIndex = -1; // position of the image being swapped in articleInner

  function extractArticleMedia(articleInner) {
    if (!articleInner) return [];
    const media = [];
    const re = /<(?:img|video)[^>]*\bsrc="([^"]+)"/g;
    let m;
    while ((m = re.exec(articleInner)) !== null) {
      const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(m[1]) || m[0].startsWith('<video');
      media.push({ url: m[1], type: isVideo ? 'video' : 'image', offset: m.index });
    }
    return media;
  }

  function replaceNthMediaSrc(html, index, newUrl) {
    const re = /(<(?:img|video)[^>]*\bsrc=")([^"]+)(")/g;
    let count = 0;
    return html.replace(re, (match, pre, oldUrl, post) => {
      if (count++ === index) return pre + newUrl + post;
      return match;
    });
  }

  function toRoman(num) {
    const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    let r = '';
    for (let i = 0; i < vals.length; i++) {
      while (num >= vals[i]) { r += syms[i]; num -= vals[i]; }
    }
    return r;
  }

  function renderArticleImages() {
    if (!state.draft || !state.draft.articleInner) {
      if (articleImagesSection) articleImagesSection.hidden = true;
      return;
    }
    const media = extractArticleMedia(state.draft.articleInner);
    if (!media.length) {
      articleImagesSection.hidden = true;
      return;
    }
    articleImagesSection.hidden = false;
    articleImagesList.innerHTML = '';
    media.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'admin-article-image';
      item.innerHTML =
        (m.type === 'video'
          ? '<video src="' + escapeHtml(m.url) + '" muted playsinline preload="metadata"></video>'
          : '<img src="' + escapeHtml(m.url) + '" alt="Plate ' + (i + 2) + '">') +
        '<div class="admin-article-image__overlay">' +
          '<span class="admin-article-image__plate">Plate ' + toRoman(i + 2) + '</span>' +
          '<button type="button" class="admin-btn admin-btn--ghost admin-btn--small">Austauschen</button>' +
        '</div>';

      const trigger = () => { swappingUrl = m.url; swappingIndex = i; swappingContext = 'article'; uploadArticleInput.click(); };
      item.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); trigger(); });
      item.addEventListener('click', trigger);
      articleImagesList.appendChild(item);
    });
  }

  uploadArticleInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !swappingUrl) return;
    showOverlay('Bild wird ersetzt…');
    try {
      const dataBase64 = await fileToBase64(file);
      const data = await api('/api/admin/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          dataBase64,
        }),
      });
      hideOverlay();
      if (!state.draft) return;
      const oldUrl = swappingUrl;
      const oldHero = state.draft.heroImageUrl;

      if (swappingContext === 'hero') {
        state.draft.heroImageUrl = data.url;
        const heroInput = $('f_heroImageUrl');
        if (heroInput) heroInput.value = data.url;
        // Card follows hero if it was empty or tracking hero
        if (!state.draft.cardImageUrl || state.draft.cardImageUrl === oldHero) {
          state.draft.cardImageUrl = data.url;
          const cardInput = $('f_cardImageUrl');
          if (cardInput) cardInput.value = data.url;
        }
        renderCoverPreviews();
      } else {
        if (state.draft.articleInner) {
          if (swappingIndex >= 0) {
            state.draft.articleInner = replaceNthMediaSrc(state.draft.articleInner, swappingIndex, data.url);
          } else {
            state.draft.articleInner = state.draft.articleInner.split(oldUrl).join(data.url);
          }
          renderArticleImages();
        }
      }
      state.media.forEach(m => { if (m.url === oldUrl) m.url = data.url; });
      swappingUrl = null;
      swappingContext = 'article';
      swappingIndex = -1;
      await syncDraftToServer();
      loadPreview();
      showToast('Bild ersetzt', 'success');
    } catch (err) {
      hideOverlay();
      showToast('Upload fehlgeschlagen: ' + err.message, 'error', 6000);
    }
    uploadArticleInput.value = '';
  });

  // --- Publish --------------------------------------------------------------

  // --- Manage existing posts & drafts ---------------------------------------

  const manageState = {
    tab: 'posts',          // 'posts' | 'drafts'
    posts: [],
    drafts: [],
    search: '',
  };

  function openManageOverlay() {
    manageOverlay.hidden = false;
    document.body.classList.add('admin-no-scroll');
    loadManageData();
  }

  function closeManageOverlay() {
    manageOverlay.hidden = true;
    document.body.classList.remove('admin-no-scroll');
  }

  async function loadManageData() {
    manageList.innerHTML = '<div class="admin-manage__placeholder">Lade…</div>';
    try {
      const [posts, drafts] = await Promise.all([
        api('/api/admin/posts').catch(() => ({ posts: [] })),
        api('/api/admin/drafts').catch(() => ({ drafts: [] })),
      ]);
      manageState.posts = posts.posts || [];
      manageState.drafts = drafts.drafts || [];
      tabPostsCount.textContent = manageState.posts.length ? '(' + manageState.posts.length + ')' : '';
      tabDraftsCount.textContent = manageState.drafts.length ? '(' + manageState.drafts.length + ')' : '';
      renderManageList();
    } catch (err) {
      manageList.innerHTML = '<div class="admin-manage__placeholder admin-manage__placeholder--error">Fehler: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function setManageTab(tab) {
    manageState.tab = tab;
    document.querySelectorAll('.admin-manage-tab').forEach(b => {
      b.classList.toggle('admin-manage-tab--active', b.dataset.tab === tab);
    });
    renderManageList();
  }

  function matchesSearch(needle, haystackParts) {
    if (!needle) return true;
    const n = needle.toLowerCase();
    return haystackParts.some(p => (p || '').toLowerCase().includes(n));
  }

  function renderManageList() {
    const q = manageState.search.trim();
    if (manageState.tab === 'posts') {
      const filtered = manageState.posts.filter(p =>
        matchesSearch(q, [p.title, p.slug, p.excerpt, p.tag])
      );
      managePostCount.textContent = filtered.length
        ? '· ' + filtered.length + (filtered.length === 1 ? ' Geschichte' : ' Geschichten')
        : '';
      if (!filtered.length) {
        const msg = manageState.posts.length
          ? 'Keine Treffer für „' + escapeHtml(q) + '".'
          : 'Noch keine Beiträge veröffentlicht.';
        manageList.innerHTML = '<div class="admin-manage__placeholder">' + msg + '</div>';
        return;
      }
      renderPostsCards(filtered);
    } else {
      const filtered = manageState.drafts.filter(d =>
        matchesSearch(q, [d.plainTitle, d.slug, d.coupleNames, d.eyebrow, d.prompt])
      );
      managePostCount.textContent = filtered.length
        ? '· ' + filtered.length + ' Entwurf' + (filtered.length === 1 ? '' : 'e')
        : '';
      if (!filtered.length) {
        const msg = manageState.drafts.length
          ? 'Keine Treffer für „' + escapeHtml(q) + '".'
          : 'Keine offenen Entwürfe.';
        manageList.innerHTML = '<div class="admin-manage__placeholder">' + msg + '</div>';
        return;
      }
      renderDraftCards(filtered);
    }
  }

  function renderPostsCards(posts) {
    manageList.innerHTML = '';
    posts.forEach((p, i) => {
      const card = document.createElement('article');
      card.className = 'admin-manage-card';
      const plate = String(i + 1).padStart(2, '0');

      const editBtn = p.editable
        ? '<button type="button" class="admin-btn admin-btn--secondary admin-btn--small" data-action="edit" data-slug="' + escapeHtml(p.slug) + '">Bearbeiten</button>'
        : '<button type="button" class="admin-btn admin-btn--ghost admin-btn--small" disabled title="Dieser Legacy-Beitrag hat keine Quelldatei und kann nur angesehen oder gelöscht werden.">Bearbeiten</button>';

      const dupBtn = p.editable
        ? '<button type="button" class="admin-btn admin-btn--ghost admin-btn--small" data-action="duplicate" data-slug="' + escapeHtml(p.slug) + '">Duplizieren</button>'
        : '';

      card.innerHTML =
        '<div class="admin-manage-card__image">' +
          (p.image
            ? '<img src="' + escapeHtml(p.image) + '" alt="' + escapeHtml(p.imageAlt || p.title) + '" loading="lazy">'
            : '<div class="admin-manage-card__noimage">Kein Bild</div>') +
          '<span class="admin-manage-card__plate">№ ' + plate + '</span>' +
          (p.fileExists ? '' : '<span class="admin-manage-card__missing">HTML fehlt</span>') +
          (p.editable ? '' : '<span class="admin-manage-card__legacy">Legacy</span>') +
        '</div>' +
        '<div class="admin-manage-card__body">' +
          '<p class="admin-manage-card__tag">' + escapeHtml(p.tag || 'Journal') + '</p>' +
          '<h3 class="admin-manage-card__title">' + escapeHtml(p.title || p.slug) + '</h3>' +
          '<p class="admin-manage-card__excerpt">' + escapeHtml(p.excerpt || '') + '</p>' +
          '<p class="admin-manage-card__slug"><code>' + escapeHtml(p.url) + '</code></p>' +
          '<div class="admin-manage-card__actions">' +
            '<a href="' + escapeHtml(p.url) + '" target="_blank" rel="noopener" class="admin-btn admin-btn--ghost admin-btn--small">↗ Ansehen</a>' +
            editBtn +
            dupBtn +
            '<button type="button" class="admin-btn admin-btn--danger admin-btn--small" data-action="delete" data-slug="' + escapeHtml(p.slug) + '" data-title="' + escapeHtml(p.title || p.slug) + '">Löschen</button>' +
          '</div>' +
        '</div>';
      manageList.appendChild(card);
    });

    manageList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => handleDeletePost(btn.dataset.slug, btn.dataset.title));
    });
    manageList.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => handleOpenPost(btn.dataset.slug, 'edit'));
    });
    manageList.querySelectorAll('[data-action="duplicate"]').forEach(btn => {
      btn.addEventListener('click', () => handleOpenPost(btn.dataset.slug, 'duplicate'));
    });
  }

  function renderDraftCards(drafts) {
    manageList.innerHTML = '';
    drafts.forEach((d, i) => {
      const card = document.createElement('article');
      card.className = 'admin-manage-card admin-manage-card--draft';
      const plate = String(i + 1).padStart(2, '0');
      const img = d.heroImageUrl || d.cardImageUrl || '';
      const promptPreview = (d.prompt || '').slice(0, 140);
      const updated = d.updatedAt ? new Date(d.updatedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '';
      card.innerHTML =
        '<div class="admin-manage-card__image">' +
          (img
            ? '<img src="' + escapeHtml(img) + '" alt="" loading="lazy">'
            : '<div class="admin-manage-card__noimage">Ohne Bild</div>') +
          '<span class="admin-manage-card__plate">№ ' + plate + '</span>' +
          '<span class="admin-manage-card__draftbadge">Entwurf</span>' +
        '</div>' +
        '<div class="admin-manage-card__body">' +
          '<p class="admin-manage-card__tag">' + escapeHtml(d.eyebrow || 'Entwurf') + '</p>' +
          '<h3 class="admin-manage-card__title">' + escapeHtml(d.plainTitle || d.slug || 'Ohne Titel') + '</h3>' +
          '<p class="admin-manage-card__excerpt">' + escapeHtml(d.coupleNames || '') + (d.location ? ' · ' + escapeHtml(d.location) : '') + '</p>' +
          (promptPreview ? '<p class="admin-manage-card__prompt">„' + escapeHtml(promptPreview) + (d.prompt.length > 140 ? '…' : '') + '"</p>' : '') +
          '<p class="admin-manage-card__slug"><code>' + escapeHtml(d.mediaCount + ' Medien · ' + updated) + '</code></p>' +
          '<div class="admin-manage-card__actions">' +
            '<button type="button" class="admin-btn admin-btn--secondary admin-btn--small" data-action="resume" data-id="' + escapeHtml(d.id) + '">Fortsetzen</button>' +
            '<button type="button" class="admin-btn admin-btn--danger admin-btn--small" data-action="discard" data-id="' + escapeHtml(d.id) + '" data-title="' + escapeHtml(d.plainTitle || d.slug) + '">Verwerfen</button>' +
          '</div>' +
        '</div>';
      manageList.appendChild(card);
    });

    manageList.querySelectorAll('[data-action="resume"]').forEach(btn => {
      btn.addEventListener('click', () => handleResumeDraft(btn.dataset.id));
    });
    manageList.querySelectorAll('[data-action="discard"]').forEach(btn => {
      btn.addEventListener('click', () => handleDiscardDraft(btn.dataset.id, btn.dataset.title));
    });
  }

  async function handleDeletePost(slug, title) {
    if (!slug) return;
    const confirmMsg =
      'Beitrag "' + (title || slug) + '" wirklich löschen?\n\n' +
      'Die HTML-Datei wird entfernt und der Eintrag aus /blog.html gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.';
    if (!confirm(confirmMsg)) return;

    showOverlay('Beitrag wird entfernt…');
    try {
      await api('/api/admin/posts/' + encodeURIComponent(slug), { method: 'DELETE' });
      hideOverlay();
      showToast('Beitrag entfernt', 'success');
      await loadManageData();
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  }

  async function handleOpenPost(slug, mode) {
    if (!slug) return;
    if (state.draftId && !confirm('Der aktuelle Entwurf geht verloren. Trotzdem ' + (mode === 'duplicate' ? 'duplizieren' : 'bearbeiten') + '?')) return;
    showOverlay(mode === 'duplicate' ? 'Kopie wird erstellt…' : 'Beitrag wird geladen…');
    try {
      const data = await api('/api/admin/posts/open', {
        method: 'POST',
        body: JSON.stringify({ slug, mode }),
      });
      hydrateDraft(data, mode === 'duplicate' ? null : data.sourceSlug || slug);
      closeManageOverlay();
      hideOverlay();
      showToast(mode === 'duplicate' ? 'Duplikat geladen — gib ihm einen neuen Slug.' : 'Beitrag im Editor geladen', 'success');
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  }

  async function handleResumeDraft(id) {
    if (!id) return;
    if (state.draftId && state.draftId !== id && !confirm('Der aktuelle Entwurf geht verloren. Diesen Entwurf fortsetzen?')) return;
    showOverlay('Entwurf wird geladen…');
    try {
      const data = await api('/api/admin/drafts/open', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      hydrateDraft(data, null);
      closeManageOverlay();
      hideOverlay();
      showToast('Entwurf geladen', 'success');
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  }

  async function handleDiscardDraft(id, title) {
    if (!id) return;
    if (!confirm('Entwurf "' + (title || id) + '" wirklich verwerfen?')) return;
    try {
      await api('/api/admin/drafts/' + encodeURIComponent(id), { method: 'DELETE' });
      showToast('Entwurf verworfen', 'success');
      await loadManageData();
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  }

  function hydrateDraft(data, sourceSlug) {
    state.draftId = data.id;
    state.draft = data.draft;
    state.media = (data.media || []).map(m => ({ ...m }));
    state.sourceSlug = sourceSlug || null;
    promptInput.value = data.prompt || '';
    renderMediaList();
    renderDraftFields();
    showDraftSections();
    loadPreview();
    updateEditModeBanner();
  }

  function updateEditModeBanner() {
    if (state.sourceSlug) {
      editModeBanner.hidden = false;
      editModeTitle.textContent = (state.draft && state.draft.plainTitle) || state.sourceSlug;
    } else {
      editModeBanner.hidden = true;
      editModeTitle.textContent = '';
    }
  }

  function resetCreator() {
    state.draftId = null;
    state.draft = null;
    state.media = [];
    state.sourceSlug = null;
    promptInput.value = '';
    revisionInput.value = '';
    renderMediaList();
    renderDraftFields();
    draftSection.hidden = true;
    reviseSection.hidden = true;
    publishSection.hidden = true;
    previewFrame.hidden = true;
    previewFrame.src = 'about:blank';
    previewPlaceholder.hidden = false;
    updateEditModeBanner();
  }

  if (newDraftBtn) {
    newDraftBtn.addEventListener('click', () => {
      if (state.draft && !confirm('Aktuellen Entwurf verwerfen und neu beginnen?')) return;
      resetCreator();
      showToast('Bereit für eine neue Geschichte', 'info');
    });
  }

  if (managePostsBtn) managePostsBtn.addEventListener('click', openManageOverlay);
  if (manageCloseBtn) manageCloseBtn.addEventListener('click', closeManageOverlay);
  if (manageRefreshBtn) manageRefreshBtn.addEventListener('click', loadManageData);
  if (manageOverlay) {
    manageOverlay.addEventListener('click', (e) => {
      if (e.target === manageOverlay) closeManageOverlay();
    });
  }
  document.querySelectorAll('.admin-manage-tab').forEach(btn => {
    btn.addEventListener('click', () => setManageTab(btn.dataset.tab));
  });
  if (manageSearch) {
    manageSearch.addEventListener('input', () => {
      manageState.search = manageSearch.value;
      renderManageList();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !manageOverlay.hidden) closeManageOverlay();
  });

  publishBtn.addEventListener('click', async () => {
    if (!state.draftId || !state.draft) return;
    if (!state.draft.slug || !/^[a-z0-9-]+$/.test(state.draft.slug)) {
      showToast('Ungültiger Slug — nur kleine Buchstaben, Zahlen, Bindestriche', 'error');
      return;
    }
    const isUpdate = !!state.sourceSlug;
    const confirmMsg = isUpdate
      ? 'Beitrag "' + (state.draft.plainTitle || state.draft.slug) + '" wirklich aktualisieren?\n\nEr wird als /blog/' + state.draft.slug + '.html gespeichert.'
          + (state.sourceSlug !== state.draft.slug ? '\n\nAchtung: Der Slug hat sich geändert — der alte Beitrag unter /blog/' + state.sourceSlug + '.html wird entfernt.' : '')
      : 'Beitrag "' + (state.draft.plainTitle || state.draft.slug) + '" wirklich veröffentlichen?\n\nEr wird als /blog/' + state.draft.slug + '.html gespeichert und auf der Journal-Seite hinzugefügt.';
    if (!confirm(confirmMsg)) {
      return;
    }
    await syncDraftToServer();
    showOverlay(isUpdate ? 'Beitrag wird aktualisiert…' : 'Beitrag wird veröffentlicht…');
    try {
      const data = await api('/api/admin/publish', {
        method: 'POST',
        body: JSON.stringify({
          id: state.draftId,
          cardImageUrl: state.draft.cardImageUrl,
          sourceSlug: state.sourceSlug || null,
        }),
      });
      hideOverlay();
      showToast('Veröffentlicht! ' + data.url, 'success', 6000);

      // Reset UI after short delay so user can see the toast
      setTimeout(() => {
        if (confirm('Beitrag wurde veröffentlicht.\n\nMöchtest du den Beitrag jetzt ansehen?')) {
          window.open(data.url, '_blank');
        }
        resetCreator();
      }, 600);
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  });

  // --- Grid Editor ----------------------------------------------------------

  const gridOverlay = $('gridOverlay');
  const gridPreview = $('gridPreview');
  const gridSaveBtn = $('gridSaveBtn');
  const gridCloseBtn = $('gridCloseBtn');
  const gridEditorBtn = $('gridEditorBtn');
  const gridCardUpload = $('gridCardUpload');
  let gridPosts = [];
  let gridSwapSlug = null;
  let gridCropState = null; // { slug, img, dot }

  function openGridEditor() {
    gridOverlay.hidden = false;
    document.body.classList.add('admin-no-scroll');
    loadGridPosts();
  }

  function closeGridEditor() {
    gridOverlay.hidden = true;
    document.body.classList.remove('admin-no-scroll');
    if (gridCropState) exitGridCrop(false);
  }

  async function loadGridPosts() {
    gridPreview.innerHTML = '<div class="admin-manage__placeholder">Lade Grid…</div>';
    try {
      const data = await api('/api/admin/posts');
      gridPosts = data.posts || [];
      renderGrid();
    } catch (err) {
      gridPreview.innerHTML = '<div class="admin-manage__placeholder admin-manage__placeholder--error">' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderGrid() {
    gridPreview.innerHTML = '';
    gridPosts.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'admin-grid-card';
      card.draggable = true;
      card.dataset.slug = p.slug;
      card.dataset.index = idx;

      const imgPos = p.imagePosition || '';
      const posStyle = imgPos ? ' style="object-position: ' + escapeHtml(imgPos) + '"' : '';

      card.innerHTML =
        '<div class="admin-grid-card__image">' +
          (p.image
            ? '<img src="' + escapeHtml(p.image) + '" alt=""' + posStyle + ' loading="lazy">'
            : '<div class="admin-grid-card__noimage">—</div>') +
          '<span class="admin-grid-card__num">' + (idx + 1) + '</span>' +
          '<div class="admin-grid-card__dot" style="left:' + (parseInt(imgPos) || 50) + '%;top:' + (parseInt((imgPos || '').split(' ')[1]) || 50) + '%"></div>' +
          '<div class="admin-grid-card__tools">' +
            '<button type="button" class="admin-gc-btn" data-action="swap" title="Bild tauschen">↑</button>' +
            '<button type="button" class="admin-gc-btn" data-action="crop" title="Fokuspunkt">✛</button>' +
          '</div>' +
        '</div>' +
        '<div class="admin-grid-card__body">' +
          '<span class="admin-grid-card__tag">' + escapeHtml(p.tag || 'Journal') + '</span>' +
          '<p class="admin-grid-card__title">' + escapeHtml(p.title || p.slug) + '</p>' +
        '</div>';

      // Drag & drop
      card.addEventListener('dragstart', onDragStart);
      card.addEventListener('dragover', onDragOver);
      card.addEventListener('dragend', onDragEnd);
      card.addEventListener('drop', onDrop);

      // Tool buttons
      card.querySelector('[data-action="swap"]').addEventListener('click', (e) => {
        e.stopPropagation();
        gridSwapSlug = p.slug;
        gridCardUpload.click();
      });
      card.querySelector('[data-action="crop"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const img = card.querySelector('.admin-grid-card__image img');
        const dot = card.querySelector('.admin-grid-card__dot');
        if (img) enterGridCrop(p.slug, img, dot, card);
      });

      gridPreview.appendChild(card);
    });
  }

  // --- Drag & drop reorder ---

  let dragSrcIdx = null;

  function onDragStart(e) {
    dragSrcIdx = +this.dataset.index;
    this.classList.add('admin-grid-card--dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcIdx);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    card.classList.toggle('admin-grid-card--drop-before', e.clientX < mid);
    card.classList.toggle('admin-grid-card--drop-after', e.clientX >= mid);
  }

  function onDragEnd() {
    this.classList.remove('admin-grid-card--dragging');
    gridPreview.querySelectorAll('.admin-grid-card').forEach(c => {
      c.classList.remove('admin-grid-card--drop-before', 'admin-grid-card--drop-after');
    });
  }

  function onDrop(e) {
    e.preventDefault();
    const destIdx = +this.dataset.index;
    if (dragSrcIdx == null || dragSrcIdx === destIdx) return;
    const item = gridPosts.splice(dragSrcIdx, 1)[0];
    gridPosts.splice(destIdx, 0, item);
    renderGrid();
    showToast('Reihenfolge geändert — klick "Speichern" um zu übernehmen', 'info');
  }

  // --- Save order ---

  gridSaveBtn.addEventListener('click', async () => {
    const slugs = gridPosts.map(p => p.slug);
    showOverlay('Reihenfolge wird gespeichert…');
    try {
      await api('/api/admin/posts/reorder', {
        method: 'POST',
        body: JSON.stringify({ slugs }),
      });
      hideOverlay();
      showToast('Reihenfolge gespeichert', 'success');
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  });

  // --- Card image swap ---

  gridCardUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !gridSwapSlug) return;
    showOverlay('Bild wird hochgeladen…');
    try {
      const dataBase64 = await fileToBase64(file);
      const data = await api('/api/admin/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 }),
      });
      await api('/api/admin/posts/update-card', {
        method: 'POST',
        body: JSON.stringify({ slug: gridSwapSlug, image: data.url }),
      });
      hideOverlay();
      showToast('Card-Bild aktualisiert', 'success');
      gridSwapSlug = null;
      await loadGridPosts();
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
    gridCardUpload.value = '';
  });

  // --- Card focal-point crop ---

  function enterGridCrop(slug, img, dot, card) {
    if (gridCropState) exitGridCrop(false);
    card.classList.add('admin-grid-card--crop');
    dot.classList.add('admin-grid-card__dot--active');
    gridCropState = { slug, img, dot, card };

    function onPointer(e) {
      e.preventDefault();
      e.stopPropagation();
      const rect = img.getBoundingClientRect();
      let x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      let y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      x = Math.round(x); y = Math.round(y);
      img.style.objectPosition = x + '% ' + y + '%';
      dot.style.left = x + '%';
      dot.style.top = y + '%';
    }
    function onDown(e) {
      onPointer(e);
      const onMove = (ev) => onPointer(ev);
      const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const pos = img.style.objectPosition || '50% 50%';
        try {
          await api('/api/admin/posts/update-card', {
            method: 'POST',
            body: JSON.stringify({ slug, imagePosition: pos }),
          });
          showToast('Fokuspunkt gespeichert', 'success');
        } catch (err) {
          showToast('Fehler: ' + err.message, 'error');
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }
    img.addEventListener('pointerdown', onDown);
    img._gcDown = onDown;

    const done = document.createElement('button');
    done.className = 'admin-crop-done';
    done.textContent = '✓ Fertig';
    done.addEventListener('click', (e) => { e.stopPropagation(); exitGridCrop(true); });
    card.querySelector('.admin-grid-card__image').appendChild(done);
    card._gcDone = done;

    function onKey(e) { if (e.key === 'Escape') exitGridCrop(true); }
    document.addEventListener('keydown', onKey);
    card._gcKey = onKey;
  }

  function exitGridCrop(save) {
    if (!gridCropState) return;
    const { slug, img, dot, card } = gridCropState;
    card.classList.remove('admin-grid-card--crop');
    dot.classList.remove('admin-grid-card__dot--active');
    if (img._gcDown) { img.removeEventListener('pointerdown', img._gcDown); delete img._gcDown; }
    if (card._gcDone) { card._gcDone.remove(); delete card._gcDone; }
    if (card._gcKey) { document.removeEventListener('keydown', card._gcKey); delete card._gcKey; }
    gridCropState = null;
  }

  gridEditorBtn.addEventListener('click', openGridEditor);
  gridCloseBtn.addEventListener('click', closeGridEditor);
  gridOverlay.addEventListener('click', (e) => { if (e.target === gridOverlay) closeGridEditor(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !gridOverlay.hidden) closeGridEditor();
  });

})();
