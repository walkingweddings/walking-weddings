#!/usr/bin/env node
// One-shot migration: copy drafts/published from the repo's admin/ directory
// to the persistent volume on first run. Idempotent — only copies files that
// don't already exist at the target.
//
// Usage on Railway after mounting a volume at /data and setting STORAGE_DIR:
//   node admin/migrate-storage.js
//
// Locally this is a no-op because source and target resolve to the same path.

const { existsSync, readdirSync, copyFileSync, statSync } = require('fs');
const { join } = require('path');
const storage = require('./storage');

const SOURCES = {
  drafts: join(__dirname, 'drafts'),
  published: join(__dirname, 'published'),
};

const TARGETS = {
  drafts: storage.draftsDir(),
  published: storage.publishedDir(),
};

function copyDir(src, dst, label) {
  if (src === dst) {
    console.log(`[migrate] ${label}: source and target are the same (${src}) — skip`);
    return { copied: 0, skipped: 0 };
  }
  if (!existsSync(src)) {
    console.log(`[migrate] ${label}: no source directory at ${src} — skip`);
    return { copied: 0, skipped: 0 };
  }
  const files = readdirSync(src).filter(f => f.endsWith('.json'));
  let copied = 0, skipped = 0;
  for (const f of files) {
    const s = join(src, f);
    const d = join(dst, f);
    if (existsSync(d)) {
      skipped++;
      continue;
    }
    if (!statSync(s).isFile()) continue;
    copyFileSync(s, d);
    copied++;
  }
  console.log(`[migrate] ${label}: copied=${copied}, skipped=${skipped} (target had them already)`);
  return { copied, skipped };
}

console.log('[migrate] STORAGE_DIR =', storage.STORAGE_DIR);
console.log('[migrate] persistent  =', storage.isPersistent());
copyDir(SOURCES.drafts, TARGETS.drafts, 'drafts');
copyDir(SOURCES.published, TARGETS.published, 'published');
console.log('[migrate] done.');
