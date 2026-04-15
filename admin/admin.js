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

  publishBtn.addEventListener('click', async () => {
    if (!state.draftId || !state.draft) return;
    if (!state.draft.slug || !/^[a-z0-9-]+$/.test(state.draft.slug)) {
      showToast('Ungültiger Slug — nur kleine Buchstaben, Zahlen, Bindestriche', 'error');
      return;
    }
    if (!confirm('Beitrag "' + (state.draft.plainTitle || state.draft.slug) + '" wirklich veröffentlichen?\n\nEr wird als /blog/' + state.draft.slug + '.html gespeichert und auf der Journal-Seite hinzugefügt.')) {
      return;
    }
    await syncDraftToServer();
    showOverlay('Beitrag wird veröffentlicht…');
    try {
      const data = await api('/api/admin/publish', {
        method: 'POST',
        body: JSON.stringify({
          id: state.draftId,
          cardImageUrl: state.draft.cardImageUrl,
        }),
      });
      hideOverlay();
      showToast('Veröffentlicht! ' + data.url, 'success', 6000);

      // Reset UI after short delay so user can see the toast
      setTimeout(() => {
        if (confirm('Beitrag wurde veröffentlicht.\n\nMöchtest du den Beitrag jetzt ansehen?')) {
          window.open(data.url, '_blank');
        }
        // Reset state for a new post
        state.draftId = null;
        state.draft = null;
        state.media = [];
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
      }, 600);
    } catch (err) {
      hideOverlay();
      showToast('Fehler: ' + err.message, 'error', 6000);
    }
  });

})();
