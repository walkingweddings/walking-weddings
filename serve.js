const { createServer } = require('http');
const { readFileSync, existsSync, statSync } = require('fs');
const { join, extname } = require('path');

const PORT = process.env.PORT || 8082;
const ROOT = __dirname;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Walking Weddings <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://walkingweddings.com';

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
          </table>
        </div>
      </div>
    `
  });
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

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (err) {
      console.error('Contact API error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Static files
  let filePath = url === '/' ? '/index.html' : url;
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
