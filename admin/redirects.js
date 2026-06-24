// 301-Redirects für die Migration von der alten WordPress-Seite (WPML) auf das
// neue statische Setup. Die alte Seite nutzte Sprachpräfixe /en/<slug>/ und
// /de/<slug>/ (mit Trailing-Slash, ohne .html). Das neue Setup nutzt /en/…html
// für Englisch und / (Root) für Deutsch.
//
// Strategie:
//   1. Exakte Mappings für bekannte alte URLs (aus Google-Index + Repo-Slugs).
//   2. Catch-all: unbekannte /en/<x>/  → /en/  (englische Startseite)
//                 unbekannte /de/<x>/  → /     (deutsche Startseite)
// So entsteht nie ein 404 für eine alte, indexierte URL.
//
// WICHTIG: Die NEUEN englischen URLs enden auf `.html` (z.B. /en/about.html)
// oder sind exakt `/en/` — die werden hier NICHT abgefangen.

'use strict';

// Exakte alte → neue URL. Trailing-Slash-Varianten werden im Resolver toleriert.
const MAP = {
  // --- Englisch (alt /en/) → neu /en/…html ---
  '/en/home/': '/en/',
  '/en/about/': '/en/about.html',
  '/en/packages/': '/en/packages.html',
  '/en/contact/': '/en/contact.html',
  '/en/impressum/': '/en/impressum.html',
  '/en/turkish-weddings/': '/en/blog/tuerkische-hochzeiten.html',
  '/en/destination-coupleshoot/': '/en/blog/destination-paarshoot.html',
  '/en/micro-wedding-2/': '/en/blog/micro-wedding-zuerich.html',
  // Galerie/Service-Seiten, die es nicht mehr gibt → nächstliegende Seite
  '/en/elif-haktan-gallery/': '/en/blog.html',
  '/en/portrait-station-2/': '/en/packages.html',

  // --- Deutsch (alt /de/) → neu Root ---
  '/de/home/': '/',
  '/de/about/': '/about.html',
  '/de/packages/': '/packages.html',
  '/de/contact/': '/contact.html',
  '/de/impressum/': '/impressum.html',
  '/de/turkish-weddings/': '/blog/tuerkische-hochzeiten.html',
  '/de/destination-coupleshoot/': '/blog/destination-paarshoot.html',
  '/de/micro-wedding-2/': '/blog/micro-wedding-zuerich.html',
  '/de/elif-haktan-gallery/': '/blog.html',
  '/de/portrait-station-2/': '/packages.html',
};

// Liefert das Redirect-Ziel für eine alte URL, oder null wenn kein Redirect
// nötig ist (z.B. eine neue, gültige URL).
function resolveRedirect(pathname) {
  if (!pathname) return null;

  // 1. Exakter Treffer (mit und ohne Trailing-Slash).
  if (MAP[pathname]) return MAP[pathname];
  const alt = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname + '/';
  if (MAP[alt]) return MAP[alt];

  // 2. Catch-all für alte WPML-Pfade. Nur Trailing-Slash- bzw. Nicht-.html-
  //    Pfade unter /en/ oder /de/ gelten als „alt". Neue EN-URLs (.html) und
  //    die EN-Startseite (/en/, /en) bleiben unberührt.
  if (pathname.endsWith('.html')) return null;
  if (pathname === '/en' || pathname === '/en/') return null;

  if (/^\/en\/.+/.test(pathname)) return '/en/';
  if (/^\/de(\/.*)?$/.test(pathname)) return '/'; // /de, /de/, /de/<x>/ → DE-Home

  return null;
}

module.exports = { resolveRedirect, _MAP: MAP };
