#!/usr/bin/env node
// Parses existing blog/*.html files and generates sidecar JSON in admin/published/
// so all legacy posts become editable in the admin Journal Creator.

const { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } = require('fs');
const { join, basename } = require('path');

const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'blog');
const PUBLISHED_DIR = join(__dirname, 'published');
if (!existsSync(PUBLISHED_DIR)) mkdirSync(PUBLISHED_DIR, { recursive: true });

function decodeEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extract(html, regex, group) {
  const m = html.match(regex);
  return m ? decodeEntities(m[group || 1] || '') : '';
}

function extractAllMedia(html) {
  const urls = new Set();
  const re = /<(?:img|video)[^>]*\bsrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    // Skip logos and nav images
    if (u.includes('logo/') || u.includes('favicon')) continue;
    urls.add(u);
  }
  return Array.from(urls).map(url => ({
    url,
    type: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : 'image',
    filename: url.split('/').pop().split('?')[0],
  }));
}

function extractArticleInner(html) {
  // Everything between <article class="editorial-post"> and the <aside class="editorial-ticket">
  const articleStart = html.indexOf('<article class="editorial-post">');
  if (articleStart === -1) return '';
  const inner = html.slice(articleStart + '<article class="editorial-post">'.length);
  // End before the ticket/signature/closing
  const ticketIdx = inner.indexOf('<aside class="editorial-ticket">');
  const signatureIdx = inner.indexOf('<div class="editorial-signature">');
  const endIdx = Math.min(
    ticketIdx === -1 ? inner.length : ticketIdx,
    signatureIdx === -1 ? inner.length : signatureIdx
  );
  return inner.slice(0, endIdx).trim();
}

function extractMarqueeTags(html) {
  const track = html.match(/<div class="editorial-marquee__track">([\s\S]*?)<\/div>/);
  if (!track) return [];
  const tags = [];
  const re = /<span>(.*?)<\/span>/g;
  let m;
  while ((m = re.exec(track[1])) !== null) {
    const t = decodeEntities(m[1]);
    if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}

function parsePost(filePath) {
  const html = readFileSync(filePath, 'utf8');
  const slug = basename(filePath, '.html');

  const plainTitle = extract(html, /<title>([^|<]+)/);
  const title = extract(html, /<h1 class="editorial-hero__title">([\s\S]*?)<\/h1>/);
  const metaDescription = extract(html, /<meta name="description" content="([^"]*)"/);
  const eyebrow = extract(html, /<p class="editorial-hero__eyebrow">(.*?)<\/p>/);

  // Issue number from topbar
  const issueMatch = html.match(/Issue №(\d+)/);
  const issueNumber = issueMatch ? issueMatch[1] : '01';

  // Meta spans: coupleNames, location, services
  const metaBlock = extract(html, /<p class="editorial-hero__meta">([\s\S]*?)<\/p>/);
  const metaSpans = [];
  const spanRe = /<span>(.*?)<\/span>/g;
  let sm;
  while ((sm = spanRe.exec(metaBlock)) !== null) {
    metaSpans.push(decodeEntities(sm[1]));
  }
  const coupleNames = metaSpans[0] || '';
  const location = metaSpans[1] || '';
  const services = metaSpans[2] || 'Foto + Film';

  // Hero image
  const heroFigure = html.match(/<figure class="editorial-hero__figure">\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<figcaption>(.*?)<\/figcaption>/);
  const heroImageUrl = heroFigure ? heroFigure[1] : '';
  const heroImageAlt = heroFigure ? decodeEntities(heroFigure[2]) : '';
  const heroCaption = heroFigure ? decodeEntities(heroFigure[3].replace(/^Plate\s+I\s*[—–-]\s*/, '')) : '';

  // Gallery URL from ticket
  const galleryMatch = html.match(/<a href="([^"]*)"[^>]*class="editorial-ticket__link"/);
  const galleryUrl = galleryMatch ? galleryMatch[1] : '';

  // Card info from blog.html
  let cardTitle = plainTitle;
  let excerpt = '';
  let tag = 'Hochzeit';
  let cardImageUrl = heroImageUrl;
  try {
    const blogHtml = readFileSync(join(ROOT, 'blog.html'), 'utf8');
    const cardRegex = new RegExp(
      `<article class="blog-card reveal">[\\s\\S]*?href="blog/${slug}\\.html"[\\s\\S]*?<\\/article>`
    );
    const cardBlock = blogHtml.match(cardRegex);
    if (cardBlock) {
      const cb = cardBlock[0];
      const ct = cb.match(/blog-card__title">(.*?)</);
      if (ct) cardTitle = decodeEntities(ct[1]);
      const ce = cb.match(/blog-card__excerpt">(.*?)</);
      if (ce) excerpt = decodeEntities(ce[1]);
      const ctag = cb.match(/blog-card__tag">(.*?)</);
      if (ctag) tag = decodeEntities(ctag[1]);
      const cimg = cb.match(/<img[^>]*src="([^"]+)"/);
      if (cimg) cardImageUrl = cimg[1];
    }
  } catch {}

  const marqueeTags = extractMarqueeTags(html);
  const articleInner = extractArticleInner(html);
  const media = extractAllMedia(html);

  return {
    plainTitle: plainTitle.trim(),
    title: title.trim(),
    eyebrow,
    issueNumber,
    metaDescription,
    coupleNames,
    location,
    services,
    slug,
    excerpt,
    cardTitle,
    tag,
    heroImageUrl,
    heroImageAlt,
    heroCaption,
    cardImageUrl,
    marqueeTags,
    galleryUrl,
    articleInner,
    _media: media,
    _prompt: '',
    _publishedAt: Date.now(),
    _migratedFromLegacy: true,
  };
}

// --- Run ---

const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.html'));
let created = 0;
let skipped = 0;

for (const file of files) {
  const slug = basename(file, '.html');
  const sidecarPath = join(PUBLISHED_DIR, `${slug}.json`);
  if (existsSync(sidecarPath)) {
    console.log(`  SKIP  ${slug} (sidecar already exists)`);
    skipped++;
    continue;
  }
  try {
    const draft = parsePost(join(BLOG_DIR, file));
    writeFileSync(sidecarPath, JSON.stringify(draft, null, 2));
    console.log(`  OK    ${slug} — ${draft.plainTitle}`);
    created++;
  } catch (err) {
    console.error(`  FAIL  ${slug}: ${err.message}`);
  }
}

console.log(`\nFertig: ${created} Sidecars erstellt, ${skipped} übersprungen.`);
console.log('Alle Legacy-Posts sind jetzt im Admin-Panel editierbar.');
