const { createServer } = require('http');
const { readFileSync, readdirSync, existsSync, statSync, createReadStream } = require('fs');
const { join, extname, basename } = require('path');
const admin = require('./admin/server');
const { renderPage } = require('./admin/page-template');
const { findBySlug, PAGES } = require('./admin/pages-registry');
const { loadPageJson } = require('./admin/pages-api');
const { persistLead } = require('./admin/leads-api');
const i18n = require('./admin/i18n');
const { resolveRedirect } = require('./admin/redirects');

const PORT = process.env.PORT || 8082;
const ROOT = __dirname;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Walking Weddings <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://www.walkingweddings.com';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json'
};

const { addCacheBusters } = require('./cache-buster');

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Spam protection ─────────────────────────────────────────────────────────

const RATE_WINDOW = 10 * 60 * 1000; // 10 minutes
const RATE_MAX = 3;
const rateMap = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress;
}

function isRateLimited(ip) {
  const now = Date.now();
  let hits = rateMap.get(ip) || [];
  hits = hits.filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) return true;
  hits.push(now);
  rateMap.set(ip, hits);
  return false;
}

// Clean up stale entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateMap) {
    const fresh = hits.filter(t => now - t < RATE_WINDOW);
    if (fresh.length === 0) rateMap.delete(ip);
    else rateMap.set(ip, fresh);
  }
}, 15 * 60 * 1000);

function looksLikeGibberish(str) {
  if (!str || str.length < 6) return false;
  const consonants = str.replace(/[^bcdfghjklmnpqrstvwxyz]/gi, '').length;
  const ratio = consonants / str.length;
  if (ratio > 0.8 && str.length > 8) return true;
  if (/^[A-Za-z]{12,}$/.test(str) && !/\s/.test(str)) return true;
  return false;
}

function validateLead(lead) {
  if (lead._hp) return 'honeypot';

  const ts = parseInt(lead._ts, 10);
  if (!ts || Date.now() - ts < 3000) return 'too_fast';

  if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return 'invalid_email';

  if (!lead.name || lead.name.length < 2 || lead.name.length > 100) return 'invalid_name';

  if (looksLikeGibberish(lead.name)) return 'gibberish_name';
  if (looksLikeGibberish(lead.hours)) return 'gibberish_hours';
  if (looksLikeGibberish(lead.budget)) return 'gibberish_budget';
  if (looksLikeGibberish(lead.message)) return 'gibberish_message';

  const allowed = ['Hochzeit', 'Destination Wedding', 'Elopement'];
  if (!allowed.includes(lead.eventType)) return 'invalid_event_type';

  const allowedInterests = ['Foto', 'Film', 'Hybrid', 'Noch offen'];
  if (!Array.isArray(lead.interesse) || lead.interesse.length === 0 ||
      lead.interesse.some(i => !allowedInterests.includes(i))) return 'invalid_interest';

  const allowedAddons = ['Album', 'Portrait Lounge', 'Social Media Paket', 'Pre Wedding Shoot'];
  if (Array.isArray(lead.zusatz) && lead.zusatz.some(z => !allowedAddons.includes(z))) return 'invalid_addon';

  return null;
}

// Dynamic sitemap with hreflang alternates. Static pages always have an
// English mirror; blog posts only when a pre-built `<slug>.en.html` exists.
// Each language URL is emitted as its own <url> listing the full alternate set
// (Google's recommended bidirectional form).
//
// Blog posts are enumerated directly from the blog/ directory so newly
// published articles land in the sitemap without needing to be linked from
// blog.html first.
function buildSitemap() {
  const base = SITE_URL.replace(/\/$/, '');
  const entries = [];
  for (const p of PAGES) {
    // hochzeitsguide is a noindex lead-magnet — don't advertise it to Google.
    if (p.slug === 'hochzeitsguide') continue;
    entries.push({ path: p.slug === 'index' ? '/' : `/${p.slug}.html`, en: true });
  }
  for (const lp of ['impressum', 'privacy', 'agb']) entries.push({ path: `/${lp}.html`, en: true });
  try {
    const files = readdirSync(join(ROOT, 'blog'))
      .filter(f => f.endsWith('.html') && !f.endsWith('.en.html'))
      .sort();
    for (const f of files) {
      const slug = f.slice(0, -'.html'.length);
      entries.push({ path: `/blog/${slug}.html`, en: existsSync(join(ROOT, 'blog', `${slug}.en.html`)) });
    }
  } catch {}

  const urlBlock = (loc, alts) =>
    `  <url>\n    <loc>${loc}</loc>\n` +
    alts.map(a => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${a.href}"/>`).join('\n') +
    `\n  </url>\n`;

  let body = '';
  for (const { path, en } of entries) {
    const deUrl = base + path;
    const enUrl = base + '/en' + (path === '/' ? '/' : path);
    const alts = [{ lang: 'de', href: deUrl }];
    if (en) alts.push({ lang: 'en', href: enUrl });
    alts.push({ lang: 'x-default', href: deUrl });
    body += urlBlock(deUrl, alts);
    if (en) body += urlBlock(enUrl, alts);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    body + `</urlset>\n`;
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

function referralSummary(lead) {
  const v = lead.referral;
  if (!v) return '-';
  if (v === 'Wedding Planner' && lead.referralPlanner) return `Wedding Planner — ${lead.referralPlanner}`;
  if (v === 'Hochzeit' && lead.referralWedding) return `Hochzeit — ${lead.referralWedding}`;
  if (v === 'Sonstiges' && lead.referralOther) return `Sonstiges — ${lead.referralOther}`;
  return v;
}

async function sendTeamEmail(lead) {
  const dateStr = lead.noDate ? 'Noch kein fixes Datum' : (lead.dates?.join(', ') || 'Nicht angegeben');
  const locStr = lead.noLocation ? 'Noch keine Location' : (lead.locations?.join(', ') || 'Nicht angegeben');
  const roleStr = lead.role === 'planner' ? 'Wedding Planner' : 'Hochzeitspaar';
  const refStr = referralSummary(lead);
  const subjectLabel = lead.role === 'planner' ? `${lead.name}${lead.company ? ' (' + lead.company + ')' : ''}` : lead.name;
  const packageTag = lead.package ? ` [${lead.package}]` : '';

  return sendEmail({
    to: 'contact@walkingweddings.com',
    subject: `Neue Website-Anfrage: ${subjectLabel}${packageTag}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#393e3f;">
        <div style="text-align:center;padding:30px 0;background:#393e3f;">
          <img src="${SITE_URL}/assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width:180px;height:auto;" />
        </div>
        <div style="padding:30px 20px;">
          <h2 style="font-family:Georgia,serif;color:#393e3f;margin:0 0 20px;">Neue Anfrage über die Website</h2>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;width:180px;">Sprache der Anfrage</td><td style="padding:10px 12px;border:1px solid #d4c4a8;"><strong>${lead.lang === 'en' ? 'Englisch — bitte auf Englisch antworten' : 'Deutsch'}</strong></td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;width:180px;">Anfrage von</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(roleStr)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Name</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.name)}</td></tr>
            ${lead.company ? `<tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Firmenname</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.company)}</td></tr>` : ''}
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Telefon</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.phone)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">E-Mail</td><td style="padding:10px 12px;border:1px solid #d4c4a8;"><a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a></td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Art der Veranstaltung</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.eventType || '-')}</td></tr>
            ${lead.package ? `<tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Gewähltes Paket</td><td style="padding:10px 12px;border:1px solid #d4c4a8;"><strong style="color:#B8A88A;letter-spacing:1px;">${esc(lead.package)}</strong></td></tr>` : ''}
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Datum</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(dateStr)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Location</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(locStr)}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Interesse</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.interesse?.join(', ') || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Zusatzprodukte</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.zusatz?.join(', ') || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Stunden</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.hours || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Budget</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.budget || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Anmerkungen</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(lead.message || '-')}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #d4c4a8;font-weight:bold;background:#f5f0e8;">Woher</td><td style="padding:10px 12px;border:1px solid #d4c4a8;">${esc(refStr)}</td></tr>
          </table>
        </div>
      </div>
    `
  });
}

async function sendCoupleEmailEn(lead) {
  const dateStr = lead.noDate ? 'No fixed date yet' : (lead.dates?.join(', ') || '-');
  const locStr = lead.noLocation ? 'No location yet' : (lead.locations?.join(', ') || '-');

  return sendEmail({
    to: lead.email,
    replyTo: 'contact@walkingweddings.com',
    subject: 'Thank you for your enquiry — Walking Weddings',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#393e3f;">
        <div style="text-align:center;padding:30px 0;background:#393e3f;">
          <img src="${SITE_URL}/assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width:220px;height:auto;margin:0 auto;" />
        </div>
        <div style="padding:30px 20px;">
          <p style="font-size:16px;">Dear ${esc(lead.name)},</p>
          <p>thank you so much for your enquiry with Walking Weddings!</p>
          <p>We're delighted by your interest and will be in touch shortly to arrange a no-obligation introductory call.</p>

          <div style="background:#f5f0e8;border:1px solid #d4c4a8;padding:20px;margin:24px 0;">
            <p style="font-family:Georgia,serif;font-size:16px;margin:0 0 12px;letter-spacing:2px;text-transform:uppercase;">Your details</p>
            <table style="border-collapse:collapse;width:100%;font-size:14px;">
              ${lead.package ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;width:140px;">Package</td><td style="padding:6px 8px;">${esc(lead.package)}</td></tr>` : ''}
              <tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;width:140px;">Date</td><td style="padding:6px 8px;">${esc(dateStr)}</td></tr>
              <tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Location</td><td style="padding:6px 8px;">${esc(locStr)}</td></tr>
              <tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Interest</td><td style="padding:6px 8px;">${esc(lead.interesse?.join(', ') || '-')}</td></tr>
              ${lead.hours ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Hours</td><td style="padding:6px 8px;">${esc(lead.hours)}</td></tr>` : ''}
              ${lead.zusatz?.length ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Add-ons</td><td style="padding:6px 8px;">${esc(lead.zusatz.join(', '))}</td></tr>` : ''}
              ${lead.budget ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Budget</td><td style="padding:6px 8px;">${esc(lead.budget)}</td></tr>` : ''}
              ${lead.message ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;">Notes</td><td style="padding:6px 8px;">${esc(lead.message)}</td></tr>` : ''}
            </table>
          </div>

          <p>In the meantime, we've prepared something special for you — our <strong>Wedding Guide</strong> with tips, inspiration and everything you need for your planning:</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${SITE_URL}/en/hochzeitsguide.html" style="display:inline-block;padding:14px 32px;background:#B8A88A;color:#131B1B;text-decoration:none;letter-spacing:2px;font-size:14px;text-transform:uppercase;font-weight:bold;">Your Wedding Guide</a>
          </p>

          <p>Feel free to explore our website or follow us on Instagram:</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${SITE_URL}/en/" style="display:inline-block;padding:12px 28px;background:#131B1B;color:#fff;text-decoration:none;letter-spacing:2px;font-size:13px;text-transform:uppercase;">Our Website</a>
          </p>
          <p style="text-align:center;">
            <a href="https://www.instagram.com/walkingweddings" style="color:#6B7374;text-decoration:none;">@walkingweddings on Instagram</a>
          </p>

          <p>We can't wait to hear about your wedding!</p>
          <div style="margin-top:30px;padding-top:20px;border-top:1px solid #d4c4a8;">
            <p style="margin:0;font-weight:bold;">Walking Weddings OG</p>
            <p style="margin:4px 0;color:#6B7374;">Kiran: +43 660 4822420</p>
            <p style="margin:4px 0;color:#6B7374;">Ian: +43 660 6357799</p>
            <p style="margin:4px 0;color:#6B7374;">contact@walkingweddings.com</p>
            <p style="margin:4px 0;color:#6B7374;">www.walkingweddings.com</p>
          </div>
        </div>
      </div>
    `
  });
}

async function sendCoupleEmail(lead) {
  if (lead.lang === 'en') return sendCoupleEmailEn(lead);
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
              ${lead.package ? `<tr><td style="padding:6px 8px;font-weight:bold;vertical-align:top;width:140px;">Paket</td><td style="padding:6px 8px;">${esc(lead.package)}</td></tr>` : ''}
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // Canonical host: walkingweddings.com → www.walkingweddings.com (301).
  // www is the canonical host (apex stays on Hetzner with its own HTTP redirect
  // to www, so apex never reaches Railway in production). We only collapse if
  // someone explicitly hits the bare apex on Railway (e.g. via direct IP or a
  // future DNS misconfig). Other hosts (localhost, *.up.railway.app) untouched.
  const host = (req.headers.host || '').toLowerCase();
  if (host === 'walkingweddings.com') {
    res.writeHead(301, { Location: `https://www.walkingweddings.com${req.url}` });
    res.end();
    return;
  }

  // Legacy WordPress (WPML /en/ + /de/ slugs) → new URLs. 301 so Google
  // transfers ranking. Unknown legacy paths fall back to the language home
  // instead of 404. New /en/…html URLs are never matched here.
  const redirectTo = resolveRedirect(url);
  if (redirectTo) {
    res.writeHead(301, { Location: redirectTo });
    res.end();
    return;
  }

  // Admin / Journal Creator routes (auth, upload, Claude, publish)
  try {
    if (await admin.handle(req, res, url)) return;
  } catch (err) {
    console.error('Admin handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Contact form submission
  if (req.method === 'POST' && url === '/api/contact') {
    try {
      const clientIp = getClientIp(req);

      if (isRateLimited(clientIp)) {
        console.log(`Rate limited: ${clientIp}`);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Too many requests. Please try again later.' }));
        return;
      }

      const lead = await parseBody(req);

      const spamReason = validateLead(lead);
      if (spamReason) {
        console.log(`Spam blocked (${spamReason}): ${lead.name || '?'} / ${lead.email || '?'} [${clientIp}]`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, results: { team: true, couple: true } }));
        return;
      }

      delete lead._hp;
      delete lead._ts;

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

      // Persist for the admin Inquiries dashboard. Wrapped so a failure here
      // (e.g. volume not mounted yet) never breaks the response — emails are
      // the source of truth.
      try {
        const saved = persistLead(lead, results);
        console.log(`Lead persisted: ${saved.id}`);
      } catch (err) {
        console.error('Lead persistence failed:', err.message);
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

  // Dynamic sitemap + robots
  if (url === '/sitemap.xml') {
    const xml = buildSitemap();
    const buf = Buffer.from(xml);
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }

  // English mirror: /en/<path> renders the same source file with an English
  // overlay. logicalPath is the language-agnostic path used for canonical /
  // hreflang / the language switch.
  const isEn = url === '/en' || url.startsWith('/en/');
  const logicalPath = isEn ? (url.replace(/^\/en/, '') || '/') : url;

  // Static files
  let filePath = logicalPath;
  if (filePath === '/') filePath = '/index.html';
  else if (filePath.endsWith('/')) filePath += 'index.html';

  // For English blog posts we serve the pre-built `<slug>.en.html` sibling when
  // it exists (generated at publish time); otherwise we fall through to the
  // German source + (empty) i18n pass.
  let enBlogFile = null;
  if (isEn) {
    const m = filePath.match(/^\/blog\/([a-z0-9-]+)\.html$/i);
    if (m) {
      const cand = join(ROOT, 'blog', `${m[1]}.en.html`);
      if (existsSync(cand) && statSync(cand).isFile()) enBlogFile = cand;
    }
  }

  const file = enBlogFile || join(ROOT, decodeURIComponent(filePath));
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = extname(file);
  const contentType = MIME[ext] || 'application/octet-stream';
  const stat = statSync(file);
  const fileSize = stat.size;

  // For HTML, read into memory, apply CMS templating if this is a registered
  // editable page, then inject cache-busting ?v=<hash> into <script>/<link>
  // tags so JS/CSS changes propagate without manual bumps.
  if (ext === '.html') {
    let html = readFileSync(file, 'utf8');
    // Top-level pages (about.html etc) opt into the page-templating pass via
    // pages-registry. Blog post HTML is generated separately and isn't
    // registered, so it bypasses this transformation.
    const baseName = basename(file, '.html');
    const pageMeta = file === join(ROOT, baseName + '.html') ? findBySlug(baseName) : null;
    if (pageMeta) {
      try { html = renderPage(html, loadPageJson(baseName)); }
      catch (err) { console.error('[cms] renderPage failed for', baseName, ':', err.message); }
    }
    // English overlay. Pre-built blog .en.html files are already English, so
    // they only need link localisation; everything else gets the dictionary
    // pass. Order matters: CMS (DE) → i18n text → lang → link rewrite →
    // hreflang/lang-switch (injected last so their absolute URLs aren't
    // touched by localizeLinks).
    if (isEn) {
      if (!enBlogFile) html = i18n.applyI18n(html, i18n.getEnDict());
      html = i18n.setHtmlLang(html, 'en');
      html = i18n.localizeLinks(html, logicalPath);
    }
    html = i18n.injectHreflang(html, { logicalPath, locale: isEn ? 'en' : 'de', siteUrl: SITE_URL });
    html = i18n.renderLangSwitch(html, { logicalPath, locale: isEn ? 'en' : 'de' });
    html = addCacheBusters(html);
    const buf = Buffer.from(html);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
    return;
  }

  // Handle HTTP Range requests — mandatory for iOS Safari video playback
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
    if (start >= fileSize || end >= fileSize) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes'
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Walking Weddings server running on port ${PORT}`));
