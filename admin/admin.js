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
      await api('/api/admin/draft-update', {
        method: 'POST',
        body: JSON.stringify({ id: state.draftId, draft: state.draft }),
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
  }

  // --- Publish --------------------------------------------------------------

  // --- Manage existing posts & drafts ---------------------------------------

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

})();
