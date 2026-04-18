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

function toRoman(num) {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let r = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) { r += syms[i]; num -= vals[i]; }
  }
  return r;
}

function buildPostHtml(draft) {
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
    heroCaption = '',
    marqueeTags = [],
    articleInner = '',
    galleryUrl = '',
    slug = 'untitled',
  } = draft;

  const year = new Date().getFullYear();
  const canonical = `https://walkingweddings.com/blog/${slug}.html`;
  const tags = Array.isArray(marqueeTags) && marqueeTags.length ? marqueeTags : [coupleNames, eyebrow, 'Walking Weddings', 'Journal'];
  const marqueeSpans = [...tags, ...tags]
    .map(t => `      <span>${escapeHtml(t)}</span>`)
    .join('\n');
  const locationCity = (location || '').split(',')[0].trim() || location || '';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(plainTitle)} | Walking Weddings</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <link rel="canonical" href="${canonical}">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(plainTitle)} | Walking Weddings">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:image" content="${escapeHtml(heroImageUrl)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="de_AT">

  <!-- CSS -->
  <link rel="stylesheet" href="../assets/css/reset.css">
  <link rel="stylesheet" href="../assets/css/variables.css">
  <link rel="stylesheet" href="../assets/css/base.css">
  <link rel="stylesheet" href="../assets/css/layout.css">
  <link rel="stylesheet" href="../assets/css/components.css">
  <link rel="stylesheet" href="../assets/css/pages/blog.css">
  <link rel="icon" href="../assets/images/logo/favicon.svg" type="image/svg+xml">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Italiana&family=PT+Sans:wght@400;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&display=swap" rel="stylesheet">

  <!-- JSON-LD -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": ${JSON.stringify(plainTitle)},
    "image": ${JSON.stringify(heroImageUrl)},
    "author": {"@type": "Organization", "name": "Walking Weddings"},
    "publisher": {"@type": "Organization", "name": "Walking Weddings", "logo": {"@type": "ImageObject", "url": "https://walkingweddings.com/assets/images/logo/ww_brandmarkWhite.svg"}},
    "description": ${JSON.stringify(metaDescription)}
  }
  </script>
</head>
<body class="editorial">

  <!-- Navigation -->
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
  <nav class="nav" id="nav">
    <button class="nav__hamburger" id="navHamburger" aria-label="Menü öffnen">
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
      <img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(heroImageAlt || coupleNames)}" loading="eager">
      <figcaption>Plate I — ${escapeHtml(heroCaption)}</figcaption>
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
      <p class="editorial-ticket__heading">Die Credits</p>
      <dl class="editorial-ticket__list">
        <div>
          <dt>Paar</dt>
          <dd>${escapeHtml(coupleNames)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>${escapeHtml(location)}</dd>
        </div>
        <div>
          <dt>Services</dt>
          <dd>${escapeHtml(services)}</dd>
        </div>
      </dl>
${galleryUrl ? `      <a href="${escapeHtml(galleryUrl)}" target="_blank" rel="noopener" class="editorial-ticket__link">→ Zur vollständigen Galerie</a>` : ''}
    </aside>

    <div class="editorial-signature">
      <p>mit Liebe festgehalten von Walking Weddings</p>
    </div>

  </article>

  <section class="editorial-cta">
    <div class="editorial-cta__inner">
      <p class="editorial-cta__eyebrow">Eure Geschichte</p>
      <h2 class="editorial-cta__title">Eure eigene Liebesgeschichte verdient es, erzählt zu werden.</h2>
      <p class="editorial-cta__text">Wir freuen uns darauf, euch kennenzulernen und euren besonderen Tag festzuhalten.</p>
      <a href="../contact.html" class="btn btn--light">Jetzt anfragen</a>
    </div>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <div class="footer__inner">
      <div class="footer__top">
        <div class="footer__brand">
          <img src="../assets/images/logo/ww_logoWhite.svg" alt="Walking Weddings" style="width: 200px; height: auto;">
          <p>Euer Hochzeits-Foto & Video Team aus Wien.</p>
        </div>
        <div class="footer__nav">
          <p class="footer__heading">Navigation</p>
          <a href="../about.html" class="footer__link">About</a>
          <a href="../portfolio.html" class="footer__link">Works</a>
          <a href="../filme.html" class="footer__link">Motion</a>
          <a href="../blog.html" class="footer__link">Journal</a>
          <a href="../packages.html" class="footer__link">Investment</a>
          <a href="../contact.html" class="footer__link">Contact</a>
        </div>
        <div class="footer__contact">
          <p class="footer__heading">Contact</p>
          <a href="mailto:contact@walkingweddings.com" class="footer__link">contact@walkingweddings.com</a>
          <a href="tel:+43660482420" class="footer__link">+43 660 4822420</a>
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
        <p>&copy; ${year} Walking Weddings. Alle Rechte vorbehalten.</p>
        <div class="footer__legal">
          <a href="../impressum.html" class="footer__link">Impressum</a>
          <a href="../privacy.html" class="footer__link">Datenschutz</a>
          <a href="../agb.html" class="footer__link">AGB</a>
        </div>
      </div>
    </div>
  </footer>
  <script src="../assets/js/main.js?v=2"></script>
  <script src="../assets/js/animations.js?v=2"></script>

</body>
</html>
`;
}

function buildBlogCard(draft, cardImageUrl) {
  const img = cardImageUrl || draft.cardImageUrl || draft.heroImageUrl || '';
  const cardTitle = draft.cardTitle || draft.plainTitle || '';
  return `
        <article class="blog-card reveal">
          <a href="blog/${escapeHtml(draft.slug)}.html">
            <div class="blog-card__image">
              <img src="${escapeHtml(img)}" alt="${escapeHtml(cardTitle)}" loading="lazy">
            </div>
            <div class="blog-card__content">
              <p class="blog-card__tag">${escapeHtml(draft.tag || 'Hochzeit')}</p>
              <h2 class="blog-card__title">${escapeHtml(cardTitle)}</h2>
              <p class="blog-card__excerpt">${escapeHtml(draft.excerpt || '')}</p>
              <span class="blog-card__readmore">Weiterlesen</span>
            </div>
          </a>
        </article>
`;
}

module.exports = { buildPostHtml, buildBlogCard, escapeHtml, sanitizeTitle, toRoman };
