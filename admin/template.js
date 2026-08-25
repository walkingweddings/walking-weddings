// Server-side editorial post template for Walking Weddings Journal.
// Takes a draft object (from Claude or manual edits) and produces the full
// blog post HTML matching the existing editorial design system.

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Allow only <em>/</em> tags in the hero title, strip everything else.
function sanitizeTitle(html) {
  return String(html == null ? '' : html)
    .replace(/<(?!\/?em\b)[^>]*>/gi, '');
}

// Strip an existing "Plate <numeral> — " prefix from a caption so the
// template can re-prefix without doubling. Claude generated drafts
// occasionally include "Plate I — …" in heroCaption following the
// system prompt's "Plate I is reserved for the hero" rule, which led to
// "Plate I — Plate I — …" output. Defensive on the render side.
function stripPlatePrefix(txt) {
  return String(txt || '').replace(/^\s*Plate\s+[IVXLCDM0-9]+\s*[—–-]\s*/i, '');
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

// Static chrome strings per language. The article body itself (articleInner)
// is already in the target language (German from generation, English from
// translateDraft); these labels cover the surrounding template furniture.
const POST_LABELS = {
  de: {
    credits: 'Die Credits', couple: 'Paar', location: 'Location', services: 'Services',
    gallery: '→ Zur vollständigen Galerie', signature: 'mit Liebe festgehalten von Walking Weddings',
    ctaEyebrow: 'Eure Geschichte', ctaTitle: 'Eure eigene Liebesgeschichte verdient es, erzählt zu werden.',
    ctaText: 'Wir freuen uns darauf, euch kennenzulernen und euren besonderen Tag festzuhalten.',
    ctaBtn: 'Jetzt anfragen', menuAria: 'Menü öffnen', navAria: 'Hauptnavigation',
    footerTagline: 'Euer Hochzeits-Foto & Video Team aus Wien.', navHeading: 'Navigation', contactHeading: 'Contact',
    rights: 'Alle Rechte vorbehalten.', imprint: 'Impressum', privacy: 'Datenschutz', terms: 'AGB',
  },
  en: {
    credits: 'Credits', couple: 'Couple', location: 'Location', services: 'Services',
    gallery: '→ View the full gallery', signature: 'lovingly captured by Walking Weddings',
    ctaEyebrow: 'Your Story', ctaTitle: 'Your own love story deserves to be told.',
    ctaText: 'We would be delighted to meet you and capture your special day.',
    ctaBtn: 'Get in touch', menuAria: 'Open menu', navAria: 'Main navigation',
    footerTagline: 'Your wedding photo & film team from Vienna.', navHeading: 'Navigation', contactHeading: 'Contact',
    rights: 'All rights reserved.', imprint: 'Legal Notice', privacy: 'Privacy Policy', terms: 'Terms',
  },
};

function buildPostHtml(draft, opts) {
  const lang = (opts && opts.lang === 'en') ? 'en' : 'de';
  const L = POST_LABELS[lang];
  const {
    plainTitle = 'Walking Weddings Journal',
    title = '',
    metaDescription = '',
    eyebrow = '',
    issueNumber = '01',
    coupleNames = '',
    location = '',
    services = 'Foto + Film',
    heroImageUrl = '',
    heroImageAlt = '',
    heroImagePosition = '',
    heroCaption = '',
    marqueeTags = [],
    articleInner = '',
    galleryUrl = '',
    slug = 'untitled',
    datePublished = '',
    dateModified = '',
    _publishedAt = 0,
  } = draft;

  const year = new Date().getFullYear();
  const canonical = lang === 'en'
    ? `https://www.walkingweddings.com/en/blog/${slug}.html`
    : `https://www.walkingweddings.com/blog/${slug}.html`;
  const tags = Array.isArray(marqueeTags) && marqueeTags.length ? marqueeTags : [coupleNames, eyebrow, 'Walking Weddings', 'Journal'];
  const marqueeSpans = [...tags, ...tags]
    .map(t => `      <span>${escapeHtml(t)}</span>`)
    .join('\n');
  const locationCity = (location || '').split(',')[0].trim() || location || '';

  // BlogPosting. Absolute URLs, weil schema.org relative Pfade nicht aufloest —
  // aeltere Beitraege hatten das, die Vorlage hatte es verloren.
  //
  // datePublished/dateModified werden hereingereicht, damit ein Neu-Erzeugen
  // bestehender Beitraege ihr Veroeffentlichungsdatum nicht verschiebt; nur
  // wenn nichts mitkommt, faellt es auf _publishedAt zurueck.
  //
  // contentLocation macht den Ort maschinenlesbar: bisher stand er nur als Text
  // im Beitrag. Traegt das location-Feld die Venue ("Schloss Laxenburg, Wien"),
  // steht sie damit auch im Markup.
  const SITE = 'https://www.walkingweddings.com';
  const abs = u => !u ? '' : /^https?:/.test(u) ? u : SITE + (u.startsWith('/') ? u : '/' + u);
  const isoFrom = ms => ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00') : '';
  const published = datePublished || isoFrom(_publishedAt);
  const pageUrl = lang === 'en'
    ? `${SITE}/en/blog/${slug}.html`
    : `${SITE}/blog/${slug}.html`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: plainTitle,
    image: abs(heroImageUrl),
    author: [
      { '@type': 'Person', name: 'Kiran Kothakuzhakal', url: `${SITE}/about.html` },
      { '@type': 'Person', name: 'Ian Pasahol', url: `${SITE}/about.html` },
    ],
    publisher: {
      '@type': 'Organization',
      name: 'Walking Weddings',
      logo: { '@type': 'ImageObject', url: `${SITE}/assets/images/logo/ww_brandmarkWhite.svg` },
    },
    description: metaDescription,
  };
  if (published) ld.datePublished = published;
  if (dateModified || published) ld.dateModified = dateModified || published;
  ld.mainEntityOfPage = { '@type': 'WebPage', '@id': pageUrl };
  ld.url = pageUrl;
  if (location) ld.contentLocation = { '@type': 'Place', name: location };

  const jsonLd = '  ' + JSON.stringify(ld, null, 2);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(plainTitle)} | Walking Weddings</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <link rel="canonical" href="${canonical}">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(plainTitle)} | Walking Weddings">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:image" content="${escapeHtml(abs(heroImageUrl))}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'de_AT'}">

  <!-- CSS -->
  <link rel="stylesheet" href="../assets/fonts/fonts.css">
  <link rel="stylesheet" href="../assets/css/reset.css">
  <link rel="stylesheet" href="../assets/css/variables.css">
  <link rel="stylesheet" href="../assets/css/base.css">
  <link rel="stylesheet" href="../assets/css/layout.css">
  <link rel="stylesheet" href="../assets/css/components.css">
  <link rel="stylesheet" href="../assets/css/pages/blog.css">
  <link rel="icon" href="../assets/images/logo/favicon.svg" type="image/svg+xml">

  <!-- JSON-LD -->
  <script type="application/ld+json">
${jsonLd}
  </script>
  <meta name="theme-color" content="#131B1B">
  <link rel="apple-touch-icon" href="../assets/images/logo/ww_brandmarkWhite.png">
  <link rel="manifest" href="../manifest.webmanifest">
  <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "7d39d96f9e34499a9c0c836e788a5dc3"}'></script>
</head>
<body class="editorial">

  <!-- Navigation -->
  <nav class="nav" id="nav" aria-label="${L.navAria}" data-i18n-attr="aria-label:shared.nav.label">
    <a href="../index.html" class="nav__logo">
      <img src="../assets/images/logo/ww_logoWhite_wtagline.svg" alt="Walking Weddings">
    </a>
    <div class="nav__links">
      <a href="../about.html" class="nav__link">About</a>
      <a href="../portfolio.html" class="nav__link">Works</a>
      <a href="../filme.html" class="nav__link">Motion</a>
      <a href="../blog.html" class="nav__link nav__link--active">Journal</a>
      <a href="../packages.html" class="nav__link">Investment</a>
      <a href="../contact.html" class="nav__link">Contact</a>
    </div>
    <button class="nav__hamburger" id="navHamburger" aria-label="${L.menuAria}">
      <span></span><span></span><span></span>
    </button>
  </nav>
  <div class="mobile-menu" id="mobileMenu">
    <a href="../about.html" class="mobile-menu__link">About</a>
    <a href="../portfolio.html" class="mobile-menu__link">Works</a>
    <a href="../filme.html" class="mobile-menu__link">Motion</a>
    <a href="../blog.html" class="mobile-menu__link">Journal</a>
    <a href="../packages.html" class="mobile-menu__link">Investment</a>
    <a href="../contact.html" class="mobile-menu__link">Contact</a>
  </div>

  <header class="editorial-hero">
    <div class="editorial-hero__topbar">
      <span>Walking Weddings Journal</span>
      <span>Issue №${escapeHtml(issueNumber)} · ${toRoman(year)}</span>
    </div>
    <p class="editorial-hero__eyebrow">${escapeHtml(eyebrow)}</p>
    <h1 class="editorial-hero__title">${sanitizeTitle(title)}</h1>
    <p class="editorial-hero__meta">
      <span>${escapeHtml(coupleNames)}</span>
      <span>${escapeHtml(location)}</span>
      <span>${escapeHtml(services)}</span>
    </p>
    <figure class="editorial-hero__figure">
      <img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(heroImageAlt || coupleNames)}"${heroImagePosition ? ' style="object-position: ' + escapeHtml(heroImagePosition) + '"' : ''} loading="eager">
      <figcaption>Plate I — ${escapeHtml(stripPlatePrefix(heroCaption))}</figcaption>
    </figure>
  </header>

  <div class="editorial-marquee">
    <div class="editorial-marquee__track">
${marqueeSpans}
    </div>
  </div>

  <article class="editorial-post">
${articleInner}

    <aside class="editorial-ticket">
      <div class="editorial-ticket__stamp">№ ${escapeHtml(issueNumber)} · ${escapeHtml(locationCity)}</div>
      <p class="editorial-ticket__heading">${L.credits}</p>
      <dl class="editorial-ticket__list">
        <div>
          <dt>${L.couple}</dt>
          <dd>${escapeHtml(coupleNames)}</dd>
        </div>
        <div>
          <dt>${L.location}</dt>
          <dd>${escapeHtml(location)}</dd>
        </div>
        <div>
          <dt>${L.services}</dt>
          <dd>${escapeHtml(services)}</dd>
        </div>
      </dl>
${galleryUrl ? `      <a href="${escapeHtml(galleryUrl)}" target="_blank" rel="noopener" class="editorial-ticket__link">${L.gallery}</a>` : ''}
    </aside>

    <div class="editorial-signature">
      <p>${L.signature}</p>
    </div>

  </article>

  <section class="editorial-cta">
    <div class="editorial-cta__inner">
      <p class="editorial-cta__eyebrow">${L.ctaEyebrow}</p>
      <h2 class="editorial-cta__title">${L.ctaTitle}</h2>
      <p class="editorial-cta__text">${L.ctaText}</p>
      <a href="../contact.html" class="btn btn--light">${L.ctaBtn}</a>
    </div>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <div class="footer__inner">
      <div class="footer__top">
        <div class="footer__brand">
          <img src="../assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width: 200px; height: auto;">
          <p>${L.footerTagline}</p>
        </div>
        <div class="footer__nav">
          <p class="footer__heading">${L.navHeading}</p>
          <a href="../about.html" class="footer__link">About</a>
          <a href="../portfolio.html" class="footer__link">Works</a>
          <a href="../filme.html" class="footer__link">Motion</a>
          <a href="../blog.html" class="footer__link">Journal</a>
          <a href="../packages.html" class="footer__link">Investment</a>
          <a href="../contact.html" class="footer__link">Contact</a>
        </div>
        <div class="footer__contact">
          <p class="footer__heading">${L.contactHeading}</p>
          <a href="mailto:contact@walkingweddings.com" class="footer__link">contact@walkingweddings.com</a>
          <a href="tel:+436604822420" class="footer__link">+43 660 4822420</a>
          <div class="footer__social mt-sm">
            <a href="https://www.instagram.com/walkingweddings/" target="_blank" rel="noopener" aria-label="Instagram">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
            </a>
            <a href="https://www.facebook.com/walkingweddings" target="_blank" rel="noopener" aria-label="Facebook">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>
            </a>
            <a href="https://www.pinterest.com/walkingweddings/" target="_blank" rel="noopener" aria-label="Pinterest">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 21l2-7.5M10 13.5c0-3 2.5-5.5 5-4s1 6-2 6c-1.5 0-2.5-1-3-2.5"/></svg>
            </a>
          </div>
        </div>
      </div>
      <div class="footer__bottom">
        <p>&copy; ${year} Walking Weddings. ${L.rights}</p>
        <div class="footer__legal">
          <a href="../impressum.html" class="footer__link">${L.imprint}</a>
          <a href="../privacy.html" class="footer__link">${L.privacy}</a>
          <a href="../agb.html" class="footer__link">${L.terms}</a>
        </div>
      </div>
    </div>
  </footer>
  <script src="../assets/js/main.js"></script>
  <script src="../assets/js/animations.js"></script>

</body>
</html>
`;
}

function buildBlogCard(draft, cardImageUrl) {
  const img = cardImageUrl || draft.cardImageUrl || draft.heroImageUrl || '';
  const cardTitle = draft.cardTitle || draft.plainTitle || '';
  const pos = draft.cardImagePosition || draft.heroImagePosition || '';
  return `
        <article class="blog-card reveal">
          <a href="blog/${escapeHtml(draft.slug)}.html">
            <div class="blog-card__image">
              <img src="${escapeHtml(img)}" alt="${escapeHtml(cardTitle)}"${pos ? ' style="object-position: ' + escapeHtml(pos) + '"' : ''} loading="lazy">
            </div>
            <div class="blog-card__content">
              <p class="blog-card__tag" data-i18n="post.${escapeHtml(draft.slug)}.tag">${escapeHtml(draft.tag || 'Hochzeit')}</p>
              <h2 class="blog-card__title" data-i18n="post.${escapeHtml(draft.slug)}.cardTitle">${escapeHtml(cardTitle)}</h2>
              <p class="blog-card__excerpt" data-i18n="post.${escapeHtml(draft.slug)}.excerpt">${escapeHtml(draft.excerpt || '')}</p>
              <span class="blog-card__readmore" data-i18n="shared.readmore">Weiterlesen</span>
            </div>
          </a>
        </article>
`;
}

module.exports = { buildPostHtml, buildBlogCard, escapeHtml, sanitizeTitle, toRoman };
