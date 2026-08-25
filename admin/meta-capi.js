// Meta Conversions API (serverseitiges Event-Tracking)
//
// WARUM
// Das Browser-Pixel meldet einen Lead nur, wenn der Request von der Seite aus
// tatsächlich bei Meta ankommt. Adblocker, Tracking-Schutz (Safari ITP,
// Firefox ETP), Firmennetze und schlicht ein zu früh geschlossener Tab
// verhindern das regelmäßig — Meta optimiert die Kampagne dann auf
// lückenhafte Daten. Dieselbe Anfrage vom Server aus gemeldet kommt an.
//
// Zusätzlich ist die Zuordnung besser: Das Pixel kennt nur das _fbp-Cookie,
// hier schicken wir gehashte E-Mail, Telefonnummer und Namen mit. Meta nennt
// das "Match Quality" — je höher, desto zuverlässiger landet die Conversion
// bei der richtigen Anzeige.
//
// EINWILLIGUNG
// Serverseitig ist kein Freifahrtschein. Wir übertragen personenbezogene
// Daten (wenn auch gehasht) zu Werbezwecken an Meta — das braucht dieselbe
// Einwilligung wie das Pixel im Browser. Deshalb sendet dieses Modul nur,
// wenn der Client eine erteilte Marketing-Einwilligung mitschickt. Ohne
// Einwilligung passiert hier nichts, und zwar bewusst: die Alternative wäre
// genau die Consent-Umgehung, auf die Aufsichtsbehörden bei der Conversions
// API schauen.
//
// DEDUPLIZIERUNG
// Browser und Server melden dasselbe Ereignis. Damit Meta daraus einen Lead
// macht und nicht zwei, tragen beide dieselbe event_id (im Pixel heißt der
// Parameter eventID) beim selben event_name. serve.js erzeugt die ID, gibt
// sie in der Antwort zurück, und das Formular feuert das Pixel damit.
//
// KONFIGURATION (Environment, in Railway zu setzen)
//   META_CAPI_TOKEN       Pflicht. System-User-Token aus dem Events Manager.
//                         Fehlt er, ist das Modul still deaktiviert.
//   META_PIXEL_ID         Optional, Vorgabe ist die ID aus consent.js.
//   META_TEST_EVENT_CODE  Optional. Solange gesetzt, erscheinen die Events im
//                         Events Manager unter "Testereignisse" und zählen
//                         NICHT als echte Conversions. Zum Prüfen setzen,
//                         danach wieder entfernen.
//   META_API_VERSION      Optional, z.B. "v23.0". Ohne Angabe rufen wir die
//                         Graph API unversioniert auf; sie beantwortet das
//                         mit der ältesten noch unterstützten Version. Das
//                         ist absichtlich so: eine fest verdrahtete Version
//                         läuft irgendwann aus und der Aufruf schlägt fehl,
//                         ohne dass es jemandem auffällt.

'use strict';

const crypto = require('crypto');

const PIXEL_ID = process.env.META_PIXEL_ID || '1069216136085670';
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN || '';
const API_VERSION = process.env.META_API_VERSION || '';
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';

// Meta antwortet normalerweise in deutlich unter einer Sekunde. Der Timeout
// ist nur die Reißleine: das Kontaktformular soll nicht auf Meta warten.
const TIMEOUT_MS = 5000;

function isConfigured() {
  return Boolean(ACCESS_TOKEN);
}

function endpoint() {
  const version = API_VERSION ? `/${API_VERSION}` : '';
  return `https://graph.facebook.com${version}/${PIXEL_ID}/events`;
}

function newEventId() {
  return crypto.randomBytes(8).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// ── Normalisierung ──────────────────────────────────────────────────────────
// Meta hasht auf seiner Seite exakt genauso. Weicht unsere Normalisierung ab,
// stimmen die Hashes nicht überein und der Treffer geht verloren — deshalb
// hier streng nach Metas Vorgaben: trimmen, Kleinschreibung, keine Leer- und
// Sonderzeichen.

function normEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  // Grobe Plausibilität genügt; validateLead() in serve.js hat schon geprüft.
  return v.includes('@') ? v : '';
}

// Telefonnummern will Meta als reine Ziffernfolge MIT Ländervorwahl, ohne
// "+" und ohne führende Nullen. Was Paare tippen, sieht anders aus:
// "+43 660 …", "0043 660 …", "0660 …".
//
// Die nationale Schreibweise mit einer führenden 0 verrät das Land nicht. Wir
// ergänzen dann 43 (Österreich) — das Studio sitzt in Wien, der Großteil der
// national geschriebenen Nummern ist österreichisch. Liegen wir daneben,
// entsteht ein Hash, der bei Meta schlicht auf niemanden passt: die Zuordnung
// über E-Mail und Name bleibt davon unberührt, es geht nichts kaputt.
function normPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  let normalized;
  if (raw.startsWith('+')) normalized = digits;
  else if (digits.startsWith('00')) normalized = digits.slice(2);
  else if (digits.startsWith('0')) normalized = '43' + digits.slice(1);
  else normalized = digits;

  // Kürzer als 8 Ziffern ist keine erreichbare Nummer, länger als 15 verbietet
  // die E.164-Norm. Beides lieber weglassen als Müll hashen.
  return normalized.length >= 8 && normalized.length <= 15 ? normalized : '';
}

function normName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Das Formular hat ein einziges Namensfeld. Erstes Wort als Vorname, der Rest
// als Nachname — bei einem einzelnen Wort bleibt der Nachname leer.
function splitName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// _fbp und _fbc sind First-Party-Cookies auf unserer eigenen Domain — sie
// stehen also im Cookie-Header des Formular-POSTs und müssen nicht durch den
// Client gereicht werden.
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return '';
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

// IPv6-Adressen kommen bei Node in der Form "::ffff:1.2.3.4" an, wenn ein
// IPv4-Client über einen Dual-Stack-Socket verbindet. Meta will die echte
// Adresse.
function normIp(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return v.startsWith('::ffff:') ? v.slice(7) : v;
}

// ── Nutzerdaten ─────────────────────────────────────────────────────────────

function buildUserData(lead, ctx) {
  const userData = {};

  const email = normEmail(lead.email);
  if (email) userData.em = [sha256(email)];

  const phone = normPhone(lead.phone);
  if (phone) userData.ph = [sha256(phone)];

  const { first, last } = splitName(lead.name);
  const fn = normName(first);
  const ln = normName(last);
  if (fn) userData.fn = [sha256(fn)];
  if (ln) userData.ln = [sha256(ln)];

  // IP und User-Agent gehen ungehasht — so verlangt Meta es, beide sind für
  // die Zuordnung Pflichtfelder-Ersatz, wenn die Cookies fehlen.
  if (ctx.ip) userData.client_ip_address = ctx.ip;
  if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;

  if (ctx.fbp) userData.fbp = ctx.fbp;
  if (ctx.fbc) userData.fbc = ctx.fbc;

  return userData;
}

// ── Versand ─────────────────────────────────────────────────────────────────

// Meldet einen bestätigten Lead an Meta. Wirft nie — der Aufrufer soll sich
// nicht darum kümmern müssen, ob Meta gerade erreichbar ist. Rückgabe sagt,
// was passiert ist, damit serve.js es protokollieren kann.
async function sendLead(lead, ctx) {
  // Einwilligung zuerst — vor jeder anderen Bedingung. Diese Prüfung ist das
  // Sicherheitsgatter, und ein Gatter, das erst nach zwei anderen Abfragen
  // greift, überlebt die nächste Umbauaktion womöglich nicht.
  if (!ctx.consent) return { sent: false, reason: 'no-consent' };
  if (!isConfigured()) return { sent: false, reason: 'not-configured' };
  if (!ctx.eventId) return { sent: false, reason: 'no-event-id' };

  const userData = buildUserData(lead, ctx);

  // Ohne mindestens ein Identifikationsmerkmal weist Meta das Event ohnehin
  // zurück. Dann sparen wir uns den Aufruf.
  const hasIdentifier = userData.em || userData.ph || userData.fbp || userData.fbc ||
    (userData.client_ip_address && userData.client_user_agent);
  if (!hasIdentifier) return { sent: false, reason: 'no-identifier' };

  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: ctx.eventId,
      event_source_url: ctx.sourceUrl || undefined,
      action_source: 'website',
      user_data: userData,
      custom_data: {
        // Beschreibt die Anfrage, ohne Freitext des Paares zu übertragen:
        // Nachricht, Budget und Wunschtermine bleiben bei uns.
        content_category: lead.eventType || 'wedding',
        content_name: Array.isArray(lead.interesse) && lead.interesse.length
          ? lead.interesse.join(', ')
          : undefined,
      },
    }],
  };

  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${endpoint()}?access_token=${encodeURIComponent(ACCESS_TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = body && body.error ? body.error.message : `HTTP ${res.status}`;
      return { sent: false, reason: 'api-error', error: msg };
    }

    return {
      sent: true,
      received: body.events_received,
      test: Boolean(TEST_EVENT_CODE),
      // Wie viele Merkmale wir mitgeschickt haben — hilft beim Beurteilen der
      // Match Quality im Events Manager.
      identifiers: Object.keys(userData).length,
    };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : 'network-error';
    return { sent: false, reason, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isConfigured,
  newEventId,
  readCookie,
  normIp,
  sendLead,
  // Für die Tests:
  _internals: { normEmail, normPhone, normName, splitName, buildUserData, sha256 },
};
