const fs = require('fs/promises');
const path = require('path');
const { AUDIT_LOG } = require('./paths');
const { ensureDir, formatDateTime } = require('./fileUtils');

function getActor(req) {
  return {
    userId: req.session?.user?.id || null,
    username: req.session?.user?.username || (req.session?.isAdmin ? 'admin' : 'guest'),
    role: req.session?.user?.role || (req.session?.isAdmin ? 'superadmin' : 'guest'),
    ip: req.ip,
  };
}

async function writeAudit(req, action, detail = {}) {
  const record = {
    time: formatDateTime(),
    action,
    actor: getActor(req),
    folderId: detail.folderId ?? null,
    targetType: detail.targetType || null,
    targetId: detail.targetId || null,
    targetName: detail.targetName || null,
    detail,
  };
  await ensureDir(path.dirname(AUDIT_LOG));
  await fs.appendFile(AUDIT_LOG, JSON.stringify(record) + '\n', 'utf-8');
  return record;
}

async function readAuditLog(filters = {}) {
  let raw = '';
  try {
    raw = await fs.readFile(AUDIT_LOG, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const from = filters.from ? `${filters.from} 00:00:00` : null;
  const to = filters.to ? `${filters.to} 23:59:59` : null;
  const username = String(filters.username || '').trim().toLowerCase();
  const folderId = filters.folderId || '';
  const action = String(filters.action || '').trim();
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);

  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .filter((item) => !from || item.time >= from)
    .filter((item) => !to || item.time <= to)
    .filter((item) => !username || String(item.actor?.username || '').toLowerCase().includes(username))
    .filter((item) => !folderId || item.folderId === folderId || item.detail?.targetFolderId === folderId)
    .filter((item) => !action || item.action === action)
    .slice(-limit)
    .reverse();
}

module.exports = { writeAudit, readAuditLog, getActor };
