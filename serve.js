const { createServer } = require('http');
const { readFileSync, existsSync, statSync } = require('fs');
const { join, extname } = require('path');
const { createHash } = require('crypto');

const PORT = process.env.PORT || 8082;
const ROOT = __dirname;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Walking Weddings <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://walkingweddings.com';

// Meta Conversions API config (optional — server-side events for Instagram Ads tracking)
const META_PIXEL_ID = process.env.META_PIXEL_ID || '';
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN || '';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json'
};

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}

async function sendEmail({ to, subject, html, replyTo }) {
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set — email skipped');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: replyTo || undefined })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || JSON.stringify(data));
  return true;
}

function renderAttributionRows(lead) {
  const utm = lead.utm || {};
  const hasAttribution = utm.utm_source || utm.utm_medium || utm.utm_campaign || utm.utm_content || utm.utm_term || lead.landing_page || lead.referrer;
  if (!hasAttribution) return '';
  const row = (label, value) => value
    ? `<tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#eef3f1;">${esc(label)}</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(value)}</td></tr>`
    : '';
  return `
            <tr><td colspan="2" style="padding:14px 12px 6px;font-weight:bold;color:#393e3f;border-top:2px solid #B8A88A;">Herkunft / Attribution</td></tr>
            ${row('Quelle', utm.utm_source)}
            ${row('Medium', utm.utm_medium)}
            ${row('Kampagne', utm.utm_campaign)}
            ${row('Content', utm.utm_content)}
            ${row('Term', utm.utm_term)}
            ${row('Landing Page', lead.landing_page)}
            ${row('Referrer', lead.referrer)}`;
}

async function sendTeamEmail(lead) {
  const dateStr = lead.noDate ? 'Noch kein fixes Datum' : (lead.dates?.join(', ') || 'Nicht angegeben');
  const locStr = lead.noLocation ? 'Noch keine Location' : (lead.locations?.join(', ') || 'Nicht angegeben');

  return sendEmail({
    to: 'contact@walkingweddings.com',
    subject: `Neue Website-Anfrage: ${lead.name}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#393e3f;">
        <div style="text-align:center;padding:30px 0;background:#393e3f;">
          <img src="${SITE_URL}/assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width:180px;height:auto;" />
        </div>
        <div style="padding:30px 20px;">
          <h2 style="font-family:Georgia,serif;color:#393e3f;margin:0 0 20px;">Neue Anfrage über die Website</h2>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;width:160px;">Name</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.name)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Telefon</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.phone)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">E-Mail</td><td style="padding:10px 12px;border:1px solid #d4c4a8;"><a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a></td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Hochzeitsdatum</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(dateStr)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Location</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(locStr)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Interesse</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.interesse?.join(', ') || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Zusatzprodukte</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.zusatz?.join(', ') || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Stunden</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.hours || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Budget</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.budget || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Anmerkungen</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.message || '-')}</td></tr>
            ${renderAttributionRows(lead)}
          </table>
        </div>
      </div>
    `
  });
}

async function sendLeadMagnetGuideEmail(lead) {
  return sendEmail({
    to: lead.email,
    replyTo: 'contact@walkingweddings.com',
    subject: 'Euer Hochzeitsguide — Walking Weddings',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#393e3f;">
        <div style="text-align:center;padding:30px 0;background:#131B1B;">
          <img src="${SITE_URL}/assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width:220px;height:auto;margin:0 auto;" />
        </div>
        <div style="padding:30px 20px;">
          <p style="font-size:16px;">Hallo ${esc(lead.name || 'ihr Lieben')},</p>
          <p>vielen Dank für euer Interesse an Walking Weddings! Wie versprochen hier euer kostenloser <strong>Hochzeitsguide</strong> — mit unseren wichtigsten Tipps, Checklisten und Inspiration für eure Planung:</p>

          <p style="text-align:center;margin:32px 0;">
            <a href="${SITE_URL}/hochzeitsguide.html" style="display:inline-block;padding:16px 36px;background:#B8A88A;color:#131B1B;text-decoration:none;letter-spacing:2px;font-size:14px;text-transform:uppercase;font-weight:bold;">Hochzeitsguide öffnen</a>
          </p>

          <p>Wir hoffen, der Guide hilft euch weiter. Falls ihr konkrete Fragen zu Foto &amp; Film für eure Hochzeit habt oder ein unverbindliches Kennenlerngespräch möchtet — meldet euch jederzeit. Wir antworten meistens innerhalb von 24 Stunden.</p>

          <p style="text-align:center;margin:24px 0;">
            <a href="${SITE_URL}/contact.html" style="display:inline-block;padding:12px 28px;background:#131B1B;color:#fff;text-decoration:none;letter-spacing:2px;font-size:13px;text-transform:uppercase;">Beratung Vereinbaren</a>
          </p>

          <p>Viel Freude beim Lesen &mdash; und viel Vorfreude auf euren großen Tag!</p>

          <div style="margin-top:30px;padding-top:20px;border-top:1px solid #d4c4a8;">
            <p style="margin:0;font-weight:bold;">Kiran &amp; Ian — Walking Weddings</p>
            <p style="margin:4px 0;color:#6B7374;">contact@walkingweddings.com</p>
            <p style="margin:4px 0;color:#6B7374;">www.walkingweddings.com</p>
            <p style="margin:4px 0;color:#6B7374;">@walkingweddings auf Instagram</p>
          </div>
        </div>
      </div>
    `
  });
}

async function sendLeadMagnetTeamNotification(lead) {
  return sendEmail({
    to: 'contact@walkingweddings.com',
    subject: `Neuer Guide-Download: ${lead.name || lead.email}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#393e3f;">
        <div style="text-align:center;padding:24px 0;background:#131B1B;">
          <img src="${SITE_URL}/assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width:160px;height:auto;" />
        </div>
        <div style="padding:24px 20px;">
          <h2 style="font-family:Georgia,serif;color:#393e3f;margin:0 0 16px;">Neuer Hochzeitsguide-Download</h2>
          <p style="margin:0 0 16px;color:#6B7374;font-size:13px;">Ein Interessent hat den Hochzeitsguide angefordert — noch kein heißer Lead, aber warm genug fürs Retargeting &amp; die Nurture-Liste.</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;width:160px;">Name</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.name || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">E-Mail</td><td style="padding:10px 12px;border:1px solid #d4c4a8;"><a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a></td></tr>
            ${renderAttributionRows(lead)}
          </table>
        </div>
      </div>
    `
  });
}

// ============================================================================
// Meta Conversions API (server-side pixel events)
// ============================================================================
function sha256Lower(value) {
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

async function sendCapiEvent({ eventName, eventId, email, phone, firstName, lastName, clientIp, userAgent, fbp, fbc, sourceUrl, utm }) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return;
  try {
    const userData = {
      client_ip_address: clientIp || undefined,
      client_user_agent: userAgent || undefined,
      fbp: fbp || undefined,
      fbc: fbc || undefined
    };
    if (email) userData.em = [sha256Lower(email)];
    if (phone) userData.ph = [sha256Lower(String(phone).replace(/[^0-9]/g, ''))];
    if (firstName) userData.fn = [sha256Lower(firstName)];
    if (lastName) userData.ln = [sha256Lower(lastName)];

    const payload = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId || undefined,
        action_source: 'website',
        event_source_url: sourceUrl || `${SITE_URL}/lp/instagram`,
        user_data: userData,
        custom_data: {
          utm_source: utm?.utm_source || undefined,
          utm_medium: utm?.utm_medium || undefined,
          utm_campaign: utm?.utm_campaign || undefined,
          utm_content: utm?.utm_content || undefined,
          utm_term: utm?.utm_term || undefined
        }
      }]
    };
    if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

    const res = await fetch(`https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`CAPI ${eventName} failed:`, data.error?.message || JSON.stringify(data));
    } else {
      console.log(`CAPI ${eventName} sent (events_received: ${data.events_received ?? '?'})`);
    }
  } catch (err) {
    console.error(`CAPI ${eventName} error:`, err.message);
  }
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendCoupleEmail(lead) {
  const dateStr = lead.noDate ? 'Noch kein fixes Datum' : (lead.dates?.join(', ') || '-');
  const locStr = lead.noLocation ? 'Noch keine Location' : (lead.locations?.join(', ') || '-');

  return sendEmail({
    to: lead.email,
    replyTo: 'contact@walkingweddings.com',
    subject: 'Danke für eure Anfrage — Walking Weddings',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#393e3f;">
        <div style="text-align:center;padding:30px 0;background:#393e3f;">
          <img src="${SITE_URL}/assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width:220px;height:auto;margin:0 auto;" />
        </div>
        <div style="padding:30px 20px;">
          <p style="font-size:16px;">Liebe/r ${esc(lead.name)},</p>
          <p>vielen Dank für eure Anfrage bei Walking Weddings!</p>
          <p>Wir freuen uns sehr über euer Interesse und melden uns in Kürze bei euch, um ein unverbindliches Kennenlerngespräch zu vereinbaren.</p>

          <div style="background:#f5f0e8;border:1px solid #d4c4a8;padding:20px;margin:24px 0;">
            <p style="font-family:Georgia,serif;font-size:16px;margin:0 0 12px;letter-spacing:2px;text-transform:uppercase;">Eure Angaben</p>
            <table style="border-collapse:collapse;width:100%;font-size:14px;">
              <tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;width:140px;">Datum</td><td style="padding:6px 8px;">${esc(dateStr)}</td></tr>
              <tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Location</td><td style="padding:6px 8px;">${esc(locStr)}</td></tr>
              <tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Interesse</td><td style="padding:6px 8px;">${esc(lead.interesse?.join(', ') || '-')}</td></tr>
              ${lead.hours ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Stunden</td><td style="padding:6px 8px;">${esc(lead.hours)}</td></tr>` : ''}
              ${lead.zusatz?.length ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Zusatzprodukte</td><td style="padding:6px 8px;">${esc(lead.zusatz.join(', '))}</td></tr>` : ''}
              ${lead.budget ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Budget</td><td style="padding:6px 8px;">${esc(lead.budget)}</td></tr>` : ''}
              ${lead.message ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Anmerkungen</td><td style="padding:6px 8px;">${esc(lead.message)}</td></tr>` : ''}
            </table>
          </div>

          <p>In der Zwischenzeit haben wir etwas Besonderes für euch vorbereitet — unseren <strong>Hochzeitsguide</strong> mit Tipps, Inspiration und allem, was ihr für eure Planung braucht:</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${SITE_URL}/hochzeitsguide.html" style="display:inline-block;padding:14px 32px;background:#B8A88A;color:#131B1B;text-decoration:none;letter-spacing:2px;font-size:14px;text-transform:uppercase;font-weight:bold;">Euer Hochzeitsguide</a>
          </p>

          <p>Schaut euch auch gerne auf unserer Website um oder folgt uns auf Instagram:</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${SITE_URL}" style="display:inline-block;padding:12px 28px;background:#131B1B;color:#fff;text-decoration:none;letter-spacing:2px;font-size:13px;text-transform:uppercase;">Unsere Website</a>
          </p>
          <p style="text-align:center;">
            <a href="https://www.instagram.com/walkingweddings" style="color:#6B7374;text-decoration:none;">@walkingweddings auf Instagram</a>
          </p>

          <p>Wir freuen uns auf eure Hochzeit!</p>
          <div style="margin-top:30px;padding-top:20px;border-top:1px solid #d4c4a8;">
            <p style="margin:0;font-weight:bold;">Walking Weddings OG</p>
            <p style="margin:4px 0;color:#6B7374;">Kiran: 0660 4822420</p>
            <p style="margin:4px 0;color:#6B7374;">Ian: 0660 6357799</p>
            <p style="margin:4px 0;color:#6B7374;">contact@walkingweddings.com</p>
            <p style="margin:4px 0;color:#6B7374;">www.walkingweddings.com</p>
          </div>
        </div>
      </div>
    `
  });
}

createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // API: Contact form submission
  if (req.method === 'POST' && url === '/api/contact') {
    try {
      const lead = await parseBody(req);
      console.log(`New contact: ${lead.name} (${lead.email})`);

      const results = { team: false, couple: false };

      try {
        await sendTeamEmail(lead);
        results.team = true;
        console.log(`Team email sent for: ${lead.name}`);
      } catch (err) {
        console.error('Team email failed:', err.message);
      }

      if (lead.email) {
        try {
          await sendCoupleEmail(lead);
          results.couple = true;
          console.log(`Couple email sent to: ${lead.email}`);
        } catch (err) {
          console.error('Couple email failed:', err.message);
        }
      }

      // Fire server-side Meta CAPI event (deduped with client-side via event_id)
      sendCapiEvent({
        eventName: 'Lead',
        eventId: lead.event_id,
        email: lead.email,
        phone: lead.phone,
        firstName: (lead.name || '').split(' ')[0],
        lastName: (lead.name || '').split(' ').slice(1).join(' '),
        clientIp: getClientIp(req),
        userAgent: req.headers['user-agent'],
        fbp: lead.fbp,
        fbc: lead.fbc,
        sourceUrl: lead.landing_page || `${SITE_URL}/contact.html`,
        utm: lead.utm
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (err) {
      console.error('Contact API error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // API: Lead magnet opt-in (Hochzeitsguide download)
  if (req.method === 'POST' && url === '/api/lead-magnet') {
    try {
      const lead = await parseBody(req);

      if (!isValidEmail(lead.email)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }));
        return;
      }

      console.log(`New guide opt-in: ${lead.name || '(no name)'} (${lead.email})`);

      const results = { guide: false, team: false };

      try {
        await sendLeadMagnetGuideEmail(lead);
        results.guide = true;
        console.log(`Guide email sent to: ${lead.email}`);
      } catch (err) {
        console.error('Guide email failed:', err.message);
      }

      try {
        await sendLeadMagnetTeamNotification(lead);
        results.team = true;
      } catch (err) {
        console.error('Guide team notification failed:', err.message);
      }

      // TODO: add multi-touch nurture sequence (e.g. via Resend Audiences or a cron job)

      sendCapiEvent({
        eventName: 'CompleteRegistration',
        eventId: lead.event_id,
        email: lead.email,
        firstName: lead.name,
        clientIp: getClientIp(req),
        userAgent: req.headers['user-agent'],
        fbp: lead.fbp,
        fbc: lead.fbc,
        sourceUrl: lead.landing_page || `${SITE_URL}/lp/instagram`,
        utm: lead.utm
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (err) {
      console.error('Lead-magnet API error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Pretty URL alias: /lp/instagram -> /lp/instagram.html
  let filePath = url === '/' ? '/index.html' : url;
  if (/^\/lp\/[A-Za-z0-9_-]+$/.test(filePath)) filePath = `${filePath}.html`;

  const file = join(ROOT, decodeURIComponent(filePath));
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`Walking Weddings server running on port ${PORT}`));
