// Inquiries / leads CMS API.
//
// Storage: one JSON file per lead at <STORAGE_DIR>/leads/<isoDate>-<id>.json.
// The ISO timestamp prefix means a directory listing already sorts
// chronologically without a database. Status defaults to 'new'; admin can
// move it to 'contacted' or 'archived'. Archived leads are moved to
// /leads/_archive/ rather than deleted, so accidents are recoverable.
//
// Leads are NOT git-synced — they contain personal data and would leak into
// the public repo. They live exclusively on the persistent volume. If the
// volume isn't mounted yet, the persistence step in serve.js logs and moves
// on; the email path remains the source of truth.

'use strict';

const crypto = require('crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync } = require('fs');
const { join } = require('path');
const storage = require('./storage');

const VALID_STATUS = new Set(['new', 'contacted', 'archived']);

function archiveDir() {
  const d = join(storage.leadsDir(), '_archive');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function leadId() {
  return crypto.randomBytes(4).toString('hex');
}

function isoStamp(ms) {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

// Persist a fresh lead. Called from serve.js after the email send. Returns
// the saved record (with id, createdAt, status). Throws if the leads dir
// isn't writable so the caller can decide whether to log + continue or fail.
function persistLead(formPayload, emailResults) {
  const id = leadId();
  const createdAt = Date.now();
  const record = {
    id,
    createdAt,
    status: 'new',
    lastUpdatedAt: createdAt,
    notes: '',
    lead: formPayload || {},
    emailResults: emailResults || {},
  };
  const filename = `${isoStamp(createdAt)}-${id}.json`;
  writeFileSync(join(storage.leadsDir(), filename), JSON.stringify(record, null, 2));
  return record;
}

function listLeads(opts) {
  opts = opts || {};
  const dir = storage.leadsDir();
  let files = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return { items: [], total: 0 }; }
  // Sort newest first (filenames begin with ISO timestamp)
  files.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const out = [];
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (opts.status && rec.status !== opts.status) continue;
    out.push({
      id: rec.id,
      file: f,
      createdAt: rec.createdAt,
      status: rec.status,
      lastUpdatedAt: rec.lastUpdatedAt,
      // Surface only the fields the table needs; full record is at GET :id
      summary: {
        name: rec.lead && rec.lead.name,
        email: rec.lead && rec.lead.email,
        package: rec.lead && rec.lead.package,
        eventType: rec.lead && rec.lead.eventType,
        role: rec.lead && rec.lead.role,
      },
    });
  }
  const total = out.length;
  const limit = parseInt(opts.limit || '0', 10);
  const offset = parseInt(opts.offset || '0', 10) || 0;
  const items = limit ? out.slice(offset, offset + limit) : out.slice(offset);
  return { items, total };
}

function unreadCount() {
  return listLeads({ status: 'new' }).total;
}

function findLeadFile(id) {
  if (!/^[a-f0-9]+$/.test(id)) return null;
  let files = [];
  try { files = readdirSync(storage.leadsDir()).filter(f => f.endsWith('.json')); } catch { return null; }
  return files.find(f => f.endsWith(`-${id}.json`)) || null;
}

function loadLead(id) {
  const f = findLeadFile(id);
  if (!f) return null;
  try { return JSON.parse(readFileSync(join(storage.leadsDir(), f), 'utf8')); } catch { return null; }
}

function patchLead(id, patch) {
  const f = findLeadFile(id);
  if (!f) return null;
  const path = join(storage.leadsDir(), f);
  let rec;
  try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (patch.status) {
    if (!VALID_STATUS.has(patch.status)) throw new Error('Ungültiger Status');
    rec.status = patch.status;
  }
  if (patch.notes != null) {
    rec.notes = String(patch.notes).slice(0, 4000);
  }
  rec.lastUpdatedAt = Date.now();
  writeFileSync(path, JSON.stringify(rec, null, 2));
  return rec;
}

// Soft delete: move to _archive/ rather than unlink. The admin "delete"
// action is more accurately a "trash" operation.
function archiveLead(id) {
  const f = findLeadFile(id);
  if (!f) return false;
  const src = join(storage.leadsDir(), f);
  const dst = join(archiveDir(), f);
  try { renameSync(src, dst); return true; }
  catch {
    // Fallback: unlink if rename fails (cross-device, perms, etc.)
    try { unlinkSync(src); return true; } catch { return false; }
  }
}

function makeHandler(deps) {
  const { json, readJson, requireAuth } = deps;

  return async function handle(req, res, url) {
    // List
    if (req.method === 'GET' && url.startsWith('/api/admin/leads') && !url.match(/\/leads\/[a-f0-9]+/)) {
      if (!requireAuth(req, res)) return true;
      const q = req.url.indexOf('?');
      const params = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1));
      const status = params.get('status') || undefined;
      const limit = params.get('limit') || undefined;
      const offset = params.get('offset') || undefined;
      const result = listLeads({ status: status === 'all' ? undefined : status, limit, offset });
      json(res, 200, { ok: true, ...result, unreadCount: unreadCount() });
      return true;
    }

    const idMatch = url.match(/^\/api\/admin\/leads\/([a-f0-9]+)$/);

    // Get one
    if (req.method === 'GET' && idMatch) {
      if (!requireAuth(req, res)) return true;
      const lead = loadLead(idMatch[1]);
      if (!lead) { json(res, 404, { error: 'Lead nicht gefunden' }); return true; }
      json(res, 200, { ok: true, lead });
      return true;
    }

    // Patch (status / notes)
    if (req.method === 'PATCH' && idMatch) {
      if (!requireAuth(req, res)) return true;
      try {
        const body = await readJson(req);
        const updated = patchLead(idMatch[1], body);
        if (!updated) { json(res, 404, { error: 'Lead nicht gefunden' }); return true; }
        json(res, 200, { ok: true, lead: updated, unreadCount: unreadCount() });
      } catch (e) {
        json(res, 400, { error: e.message });
      }
      return true;
    }

    // Soft-delete
    if (req.method === 'DELETE' && idMatch) {
      if (!requireAuth(req, res)) return true;
      const ok = archiveLead(idMatch[1]);
      if (!ok) { json(res, 404, { error: 'Lead nicht gefunden' }); return true; }
      json(res, 200, { ok: true, unreadCount: unreadCount() });
      return true;
    }

    return false;
  };
}

module.exports = {
  makeHandler,
  persistLead,
  listLeads,
  loadLead,
  patchLead,
  archiveLead,
  unreadCount,
};
