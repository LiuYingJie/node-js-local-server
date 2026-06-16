const path = require('path');
const { isAdmin, currentUser } = require('../middleware/auth');
const { getFolderRelativePath } = require('./storagePath');

function normalizePermissionPath(value) {
  const text = String(value || '/').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!text || text === '/') return '/';
  return '/' + text.replace(/^\/+|\/+$/g, '');
}

async function getFolderPermissionPath(folderId) {
  const rel = await getFolderRelativePath(folderId);
  const normalized = rel.split(path.sep).join('/');
  return normalized ? '/' + normalized : '/';
}

function pathMatches(rulePath, targetPath) {
  const rule = normalizePermissionPath(rulePath);
  const target = normalizePermissionPath(targetPath);
  return target === rule || target.startsWith(rule === '/' ? '/' : rule + '/');
}

async function canAccessFolder(req, folderId, action) {
  if (isAdmin(req)) return true;
  const user = currentUser(req);
  if (!user?.permissions?.length) return false;
  const folderPath = await getFolderPermissionPath(folderId);
  return user.permissions.some((rule) => {
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    return actions.includes(action) && pathMatches(rule.path, folderPath);
  });
}

module.exports = {
  canAccessFolder,
  getFolderPermissionPath,
};
