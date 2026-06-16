const path = require('path');
const { isAdmin, isSuperAdmin, currentUser } = require('../middleware/auth');
const { getFolderById } = require('./folderService');
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

async function getPrivateRoot(folderId) {
  let current = folderId ? await getFolderById(folderId) : null;
  let root = null;
  while (current) {
    if (current.private) root = current;
    current = current.parentId ? await getFolderById(current.parentId) : null;
  }
  return root;
}

async function canAccessPrivateFolder(req, folderId) {
  const privateRoot = await getPrivateRoot(folderId);
  if (!privateRoot) return null;
  if (isSuperAdmin(req)) return true;
  const user = currentUser(req);
  if (user && privateRoot.ownerId === user.id) return true;
  return false;
}

async function canAccessFolder(req, folderId, action) {
  const privateAccess = await canAccessPrivateFolder(req, folderId);
  if (privateAccess === false) return false;
  if (privateAccess === true) return true;

  if (action === 'read') return true;

  if (isAdmin(req)) return true;
  const user = currentUser(req);
  if (!user?.permissions?.length) return false;
  const folderPath = await getFolderPermissionPath(folderId);
  return user.permissions.some((rule) => {
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    return actions.includes(action) && pathMatches(rule.path, folderPath);
  });
}

async function canViewFolder(req, folderId) {
  return canAccessFolder(req, folderId, 'read');
}

module.exports = {
  canAccessFolder,
  canViewFolder,
  getFolderPermissionPath,
  getPrivateRoot,
};
