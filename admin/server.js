// Admin backend for the Walking Weddings Journal Creator.
// Handles: login, media uploads, Claude draft generation, revision prompts,
// and publishing finished posts to /blog/ + updating blog.html.

const crypto = require('crypto');
const {
  readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync,
} = require('fs');
const { join } = require('path');
const { buildPostHtml, buildBlogCard } = require('./template');

const ROOT = join(__dirname, '..');

// --- Credentials / config ---------------------------------------------------

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'contact@walkingweddings.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Kiranianwalkingweddings2024#';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const UPLOAD_LIMIT = 200 * 1024 * 1024; // 200 MB per request

const DRAFTS_DIR = join(__dirname, 'drafts');
const UPLOADS_DIR = join(ROOT, 'assets', 'images', 'journal');
if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Sessions (in-memory) ---------------------------------------------------

const sessions = new Map(); // token -> { email, createdAt }
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function safeCompare(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function createSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email, createdAt: Date.now() });
  return token;
}

function verifyToken(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

function getQueryParam(req, name) {
  const q = req.url.indexOf('?');
  if (q === -1) return null;
  const params = new URLSearchParams(req.url.slice(q + 1));
  return params.get(name);
}

// --- HTTP helpers -----------------------------------------------------------

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > UPLOAD_LIMIT) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function requireAuth(req, res) {
  const token = getBearerToken(req);
  const s = verifyToken(token);
  if (!s) { json(res, 401, { error: 'Nicht eingeloggt' }); return false; }
  return true;
}

// --- Claude API -------------------------------------------------------------

async function callClaude(systemPrompt, messages) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt. Bitte Umgebungsvariable setzen und Server neu starten.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || JSON.stringify(data));
  }
  return data.content.map(b => b.text || '').join('');
}

function extractJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Claude hat keine JSON-Antwort zurückgegeben. Rohtext: ' + text.slice(0, 400));
  }
  return JSON.parse(t.slice(start, end + 1));
}

const SYSTEM_PROMPT = `Du bist der Editorial-Director des Walking Weddings Journal und erstellst hochwertige, deutschsprachige Hochzeits-Blog-Beiträge für walkingweddings.com.

STIL
- Literarisch, warm, poetisch — im Stil eines hochwertigen Print-Magazins (Vogue, The Gentlewoman, Kinfolk).
- Auf Deutsch, gehoben aber nicht steif. Lebendige Bilder, echte Emotionen.
- Immer in "Kapitel I", "Kapitel II", "Kapitel III" … gegliedert, mit römischen Zahlen.
- Vollständige, flüssige Absätze. Keine Aufzählungslisten.

OUTPUT-FORMAT
Antworte AUSSCHLIESSLICH mit einem einzelnen gültigen JSON-Objekt, ohne Code-Fences, ohne Prosa davor oder danach. Struktur:

{
  "plainTitle": "Haupttitel ohne HTML",
  "title": "Haupttitel mit <em>akzent</em>-Tag um 1–2 Schlüsselwörter",
  "eyebrow": "Kurze Überkategorie wie 'Urban Love Story' oder 'Alpine Romance'",
  "issueNumber": "zweistellig, z.B. '12'",
  "metaDescription": "SEO-Beschreibung, max 160 Zeichen",
  "coupleNames": "Name1 & Name2",
  "location": "Ort, Land",
  "services": "Foto + Film | Foto | Film",
  "slug": "kebab-case-namen",
  "excerpt": "Kurzer Teaser für das Journal-Grid (1–2 Sätze)",
  "cardTitle": "Kurzer Titel für die Grid-Karte",
  "tag": "Hochzeit | Pre-Wedding | Engagement",
  "heroImageUrl": "URL eines der bereitgestellten Medien (Hero-Bild)",
  "heroImageAlt": "Alt-Text fürs Hero-Bild",
  "heroCaption": "Kurze Bildunterschrift fürs Hero",
  "cardImageUrl": "URL eines der bereitgestellten Medien (Grid-Karte)",
  "marqueeTags": ["vier", "kurze", "thematische", "schlagwörter"],
  "galleryUrl": "optional, sonst leerer String",
  "articleInner": "HTML-String mit den Artikel-Sektionen (siehe unten)"
}

ERLAUBTE BAUSTEINE für articleInner (mehrere nutzen, abwechselnd für editorialen Rhythmus):

1) Erstes Kapitel mit Drop-Cap (Prolog):
    <section class="editorial-chapter editorial-chapter--intro">
      <p class="editorial-chapter__label">Kapitel I<br>Prolog</p>
      <div class="editorial-chapter__body">
        <p>…Einleitungstext…</p>
      </div>
    </section>

2) Weitere Kapitel:
    <section class="editorial-chapter">
      <p class="editorial-chapter__label">Kapitel II<br>Untertitel</p>
      <div class="editorial-chapter__body"><p>…</p></div>
    </section>

3) Zwei asymmetrische Bilder nebeneinander:
    <section class="editorial-duo">
      <figure class="editorial-figure editorial-duo__primary">
        <img src="URL" alt="..." loading="lazy">
        <figcaption>Plate II — …</figcaption>
      </figure>
      <figure class="editorial-figure editorial-duo__secondary">
        <img src="URL" alt="..." loading="lazy">
        <figcaption>Plate III — …</figcaption>
      </figure>
    </section>

4) Triptychon (drei Bilder nebeneinander):
    <section class="editorial-triptych">
      <figure class="editorial-figure"><img src="URL" alt="" loading="lazy"><figcaption>Plate IV — …</figcaption></figure>
      <figure class="editorial-figure"><img src="URL" alt="" loading="lazy"><figcaption>Plate V — …</figcaption></figure>
      <figure class="editorial-figure"><img src="URL" alt="" loading="lazy"><figcaption>Plate VI — …</figcaption></figure>
    </section>

5) Vollbild-Bild:
    <figure class="editorial-fullbleed">
      <img src="URL" alt="..." loading="lazy">
      <figcaption>Plate VII — …</figcaption>
    </figure>

6) Pull-Quote (max 1–2 pro Beitrag):
    <blockquote class="editorial-quote">
      <p>Zitattext.</p>
      <cite>— Walking Weddings</cite>
    </blockquote>

7) Für Videos nutze <video controls muted playsinline preload="metadata"> statt <img>:
    <figure class="editorial-fullbleed">
      <video src="URL" controls muted playsinline preload="metadata"></video>
      <figcaption>Plate VIII — …</figcaption>
    </figure>

REGELN
- Generiere NIEMALS <header>, <article>-Tag, Credits-Aside, Signature, Nav, Footer — das macht das Template.
- "Plate I" ist RESERVIERT für das Hero-Bild. Starte Sektionen bei Plate II aufsteigend.
- Nutze ALLE bereitgestellten Medien sinnvoll — jedes Medium sollte mindestens einmal im Beitrag erscheinen.
- Mindestens 3 Kapitel, idealerweise 4–5.
- Bilder und Text durchmischen.
- heroImageUrl und cardImageUrl MÜSSEN aus den bereitgestellten Medien stammen (exakte URL übernehmen).`;

async function generateDraft(prompt, media) {
  const mediaList = media
    .map((m, i) => `- [${i}] ${m.type || 'image'}: ${m.url}${m.caption ? ' — "' + m.caption + '"' : ''}`)
    .join('\n');
  const userMessage = `Erstelle einen neuen Journal-Beitrag für Walking Weddings.

Briefing des Users:
"""
${prompt}
"""

Verfügbare Medien (in Upload-Reihenfolge):
${mediaList || '(keine Medien hochgeladen)'}

Antworte nur mit dem JSON-Objekt.`;
  const text = await callClaude(SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  return extractJson(text);
}

async function reviseDraft(currentDraft, revisionPrompt, media) {
  const mediaList = media
    .map((m, i) => `- [${i}] ${m.type || 'image'}: ${m.url}`)
    .join('\n');
  const userMessage = `Dies ist der aktuelle Entwurf (JSON):
${JSON.stringify(currentDraft, null, 2)}

Verfügbare Medien:
${mediaList || '(keine)'}

Änderungsanweisung:
"""
${revisionPrompt}
"""

Gib den kompletten überarbeiteten Entwurf im selben JSON-Format zurück. Behalte alles, was nicht geändert werden soll, unverändert bei.`;
  const text = await callClaude(SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  return extractJson(text);
}

// --- Draft storage ----------------------------------------------------------

function saveDraft(id, data) {
  writeFileSync(join(DRAFTS_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

function loadDraft(id) {
  if (!/^[a-f0-9]+$/.test(id)) return null;
  const p = join(DRAFTS_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function deleteDraft(id) {
  try { unlinkSync(join(DRAFTS_DIR, `${id}.json`)); } catch {}
}

// --- Publishing -------------------------------------------------------------

function updateBlogGrid(draft, cardImageUrl) {
  const blogHtmlPath = join(ROOT, 'blog.html');
  let html = readFileSync(blogHtmlPath, 'utf8');
  const newCard = buildBlogCard(draft, cardImageUrl);
  const slugHref = `blog/${draft.slug}.html`;

  if (html.includes(slugHref)) {
    // Replace existing card (republish)
    const escapedHref = slugHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const articleRegex = new RegExp(
      `\\n?\\s*<article class="blog-card reveal">[\\s\\S]*?${escapedHref}[\\s\\S]*?<\\/article>`
    );
    html = html.replace(articleRegex, newCard.replace(/\s+$/, ''));
  } else {
    // Insert before the first existing card so newest appears first
    const marker = '<article class="blog-card reveal">';
    const idx = html.indexOf(marker);
    if (idx === -1) throw new Error('blog.html Grid-Struktur nicht gefunden');
    html = html.slice(0, idx) + newCard.trimStart() + '\n        ' + html.slice(idx);
  }
  writeFileSync(blogHtmlPath, html);
}

function publishDraft(draft, cardImageUrl) {
  if (!draft.slug || !/^[a-z0-9-]+$/.test(draft.slug)) {
    throw new Error('Ungültiger Slug (nur a-z, 0-9, Bindestriche erlaubt)');
  }
  const postPath = join(ROOT, 'blog', `${draft.slug}.html`);
  const postHtml = buildPostHtml(draft);
  writeFileSync(postPath, postHtml);
  updateBlogGrid(draft, cardImageUrl || draft.cardImageUrl || draft.heroImageUrl);
  return `/blog/${draft.slug}.html`;
}

// --- HTTP handler -----------------------------------------------------------

async function handle(req, res, url) {
  // /admin -> /admin/
  if (url === '/admin') {
    res.writeHead(302, { Location: '/admin/' });
    res.end();
    return true;
  }

  // Preview endpoint (iframe) — auth via ?token=… query param
  if (req.method === 'GET' && url.startsWith('/api/admin/preview/')) {
    const token = getQueryParam(req, 'token') || getBearerToken(req);
    if (!verifyToken(token)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return true;
    }
    const id = url.split('/').pop();
    const draft = loadDraft(id);
    if (!draft) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Entwurf nicht gefunden');
      return true;
    }
    const { _media, ...cleanDraft } = draft;
    const html = buildPostHtml(cleanDraft);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }

  // Login (public)
  if (req.method === 'POST' && url === '/api/admin/login') {
    try {
      const { email, password } = await readJson(req);
      if (!email || !password) {
        json(res, 400, { error: 'Email und Passwort erforderlich' });
        return true;
      }
      const okEmail = safeCompare(String(email).toLowerCase(), ADMIN_EMAIL.toLowerCase());
      const okPass = safeCompare(String(password), ADMIN_PASSWORD);
      if (!okEmail || !okPass) {
        json(res, 401, { error: 'Ungültige Zugangsdaten' });
        return true;
      }
      const token = createSession(ADMIN_EMAIL);
      json(res, 200, { ok: true, token });
      return true;
    } catch (e) {
      json(res, 400, { error: 'Ungültiger Request' });
      return true;
    }
  }

  // All remaining /api/admin/* require Bearer auth
  if (url.startsWith('/api/admin/')) {
    if (!requireAuth(req, res)) return true;
  }

  if (req.method === 'GET' && url === '/api/admin/me') {
    json(res, 200, { ok: true, email: ADMIN_EMAIL, hasClaudeKey: !!ANTHROPIC_API_KEY, model: CLAUDE_MODEL });
    return true;
  }

  if (req.method === 'POST' && url === '/api/admin/logout') {
    const token = getBearerToken(req);
    if (token) sessions.delete(token);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url === '/api/admin/upload') {
    try {
      const { filename, dataBase64, contentType } = await readJson(req);
      if (!filename || !dataBase64) {
        json(res, 400, { error: 'filename und dataBase64 erforderlich' });
        return true;
      }
      const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const ts = Date.now();
      const rand = crypto.randomBytes(4).toString('hex');
      const finalName = `${ts}-${rand}-${safe}`;
      const fullPath = join(UPLOADS_DIR, finalName);
      writeFileSync(fullPath, Buffer.from(dataBase64, 'base64'));
      const urlPath = `/assets/images/journal/${finalName}`;
      const isVideo = String(contentType || '').startsWith('video/') || /\.(mp4|mov|webm)$/i.test(finalName);
      json(res, 200, { ok: true, url: urlPath, type: isVideo ? 'video' : 'image', filename: finalName });
    } catch (e) {
      console.error('[admin] upload error:', e);
      json(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === 'POST' && url === '/api/admin/generate') {
    try {
      const { prompt, media = [] } = await readJson(req);
      if (!prompt) { json(res, 400, { error: 'prompt erforderlich' }); return true; }
      const draft = await generateDraft(prompt, media);
      const id = crypto.randomBytes(8).toString('hex');
      saveDraft(id, { ...draft, _media: media, _prompt: prompt });
      json(res, 200, { ok: true, id, draft });
    } catch (e) {
      console.error('[admin] generate error:', e);
      json(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === 'POST' && url === '/api/admin/revise') {
    try {
      const { id, revisionPrompt } = await readJson(req);
      if (!id || !revisionPrompt) { json(res, 400, { error: 'id und revisionPrompt erforderlich' }); return true; }
      const current = loadDraft(id);
      if (!current) { json(res, 404, { error: 'Entwurf nicht gefunden' }); return true; }
      const media = current._media || [];
      const { _media, _prompt, ...cleanDraft } = current;
      const revised = await reviseDraft(cleanDraft, revisionPrompt, media);
      saveDraft(id, { ...revised, _media: media, _prompt });
      json(res, 200, { ok: true, id, draft: revised });
    } catch (e) {
      console.error('[admin] revise error:', e);
      json(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === 'POST' && url === '/api/admin/draft-update') {
    try {
      const { id, draft } = await readJson(req);
      const current = loadDraft(id);
      if (!current) { json(res, 404, { error: 'Entwurf nicht gefunden' }); return true; }
      saveDraft(id, { ...draft, _media: current._media, _prompt: current._prompt });
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === 'POST' && url === '/api/admin/publish') {
    try {
      const { id, cardImageUrl } = await readJson(req);
      const current = loadDraft(id);
      if (!current) { json(res, 404, { error: 'Entwurf nicht gefunden' }); return true; }
      const { _media, _prompt, ...cleanDraft } = current;
      const postUrl = publishDraft(cleanDraft, cardImageUrl);
      deleteDraft(id);
      json(res, 200, { ok: true, url: postUrl });
    } catch (e) {
      console.error('[admin] publish error:', e);
      json(res, 500, { error: e.message });
    }
    return true;
  }

  return false; // not an admin route
}

module.exports = { handle };
