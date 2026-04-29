// Whitelist of pages that can be edited via the CMS. Listing is used for
// the admin UI's "Seiten" view AND as a security guard in the page-preview
// endpoint — we never read an arbitrary HTML file from the repo, only those
// declared here. Phase 2 ships about; subsequent phases add the rest.
//
// `slug` is both the URL filename (without .html) and the JSON storage key.

'use strict';

const PAGES = [
  {
    slug: 'about',
    file: 'about.html',
    title: 'About',
    eyebrow: 'N° 01 — Portrait',
    description: 'Founders, Philosophie, Stats',
    sections: ['Hero', 'Editorial Spread', 'Kiran', 'Ian', 'Stats', 'Closing'],
  },
];

function findBySlug(slug) {
  return PAGES.find(p => p.slug === slug) || null;
}

module.exports = { PAGES, findBySlug };
