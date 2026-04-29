// Whitelist of pages that can be edited via the CMS. Listing is used for
// the admin UI's "Seiten" view AND as a security guard in the page-preview
// endpoint — we never read an arbitrary HTML file from the repo, only those
// declared here. Phase 2 ships about; subsequent phases add the rest.
//
// `slug` is both the URL filename (without .html) and the JSON storage key.

'use strict';

const PAGES = [
  {
    slug: 'index',
    file: 'index.html',
    title: 'Startseite',
    eyebrow: 'N° 00 — Home',
    description: 'Hero-Video, USP, Founders, Galerie, Testimonials, CTA',
    sections: ['Hero', 'USP', 'Founders', 'Galerie', 'Testimonials', 'Instagram', 'CTA'],
  },
  {
    slug: 'about',
    file: 'about.html',
    title: 'About',
    eyebrow: 'N° 01 — Portrait',
    description: 'Founders, Philosophie, Stats',
    sections: ['Hero', 'Editorial Spread', 'Kiran', 'Ian', 'Stats', 'Closing'],
  },
  {
    slug: 'portfolio',
    file: 'portfolio.html',
    title: 'Works',
    eyebrow: 'N° 02 — Portfolio',
    description: '13 Hochzeitsbilder im Masonry-Grid',
    sections: ['Hero', 'Grid', 'CTA'],
  },
  {
    slug: 'packages',
    file: 'packages.html',
    title: 'Investment',
    eyebrow: 'N° 03 — Pakete',
    description: 'Plus / Premium / Luxury + Extras',
    sections: ['Hero', 'Plus', 'Premium', 'Luxury', 'Extras', 'CTA'],
  },
  {
    slug: 'filme',
    file: 'filme.html',
    title: 'Motion',
    eyebrow: 'N° 04 — Filme',
    description: '4 Film-Showcases mit Embed',
    sections: ['Hero', 'Film 1', 'Film 2', 'Film 3', 'Film 4', 'CTA'],
  },
  {
    slug: 'hochzeitsguide',
    file: 'hochzeitsguide.html',
    title: 'Hochzeitsguide',
    eyebrow: 'N° 05 — Lead Magnet',
    description: '5 Profi-Tipps + Karussell',
    sections: ['Hero', 'Intro', '5 Tipps', 'Karussell', 'CTA'],
  },
  {
    slug: 'contact',
    file: 'contact.html',
    title: 'Contact',
    eyebrow: 'N° 06 — Anfrage',
    description: 'Hero + Sidebar (Form bleibt fix)',
    sections: ['Hero', 'Thank You', 'Sidebar'],
  },
  {
    slug: 'blog',
    file: 'blog.html',
    title: 'Journal Landing',
    eyebrow: 'N° 07 — Journal',
    description: 'Nur Hero und CTA. Karten via Journal-Editor.',
    sections: ['Hero', 'CTA'],
  },
];

function findBySlug(slug) {
  return PAGES.find(p => p.slug === slug) || null;
}

module.exports = { PAGES, findBySlug };
