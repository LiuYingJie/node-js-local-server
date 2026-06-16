const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const path = require('path');
const { FOLDERS_JSON, FILES_DIR } = require('./paths');
const { ensureDir, formatDateTime } = require('./fileUtils');
const {
  getFolderRelativePath,
  getFolderAbsolutePath,
  ensureFolderOnDisk,
  remapFileRelativePaths,
} = require('./storagePath');

async function readFoldersJson() {
  try {
    const raw = await fs.readFile(FOLDERS_JSON, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveFoldersJson(list) {
  await ensureDir(path.dirname(FOLDERS_JSON));
  await fs.writeFile(FOLDERS_JSON, JSON.stringify(list, null, 2), 'utf-8');
}

function normalizeFolderId(folderId) {
  if (folderId == null || folderId === '' || folderId === 'root') return null;
  return folderId;
}

function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') throw new Error('无效的文件夹名');
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new Error('无效的文件夹名');
  return safe;
}

async function getFolderById(id) {
  if (!id) return null;
  const list = await readFoldersJson();
  return list.find((f) => f.id === id) || null;
}

async function listFolders(parentId = null) {
  const pid = normalizeFolderId(parentId);
  const list = await readFoldersJson();
  return list
    .filter((f) => (f.parentId ?? null) === pid)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

async function createFolder(name, parentId = null) {
  const safeName = sanitizeFolderName(name);
  const pid = normalizeFolderId(parentId);
  if (pid) {
    const parent = await getFolderById(pid);
    if (!parent) throw new Error('父文件夹不存在');
    await ensureFolderOnDisk(pid);
  }

  const list = await readFoldersJson();
  if (list.some((f) => f.name === safeName && (f.parentId ?? null) === pid)) {
    throw new Error('同名文件夹已存在');
  }

  const folder = {
    id: crypto.randomUUID(),
    name: safeName,
    parentId: pid,
    createTime: formatDateTime(),
  };
  list.push(folder);
  await saveFoldersJson(list);
  await ensureFolderOnDisk(folder.id);
  return folder;
}

async function renameFolder(id, name) {
  const list = await readFoldersJson();
  const folder = list.find((f) => f.id === id);
  if (!folder) throw new Error('文件夹不存在');
  const safeName = sanitizeFolderName(name);
  if (list.some((f) => f.id !== id && f.name === safeName && (f.parentId ?? null) === (folder.parentId ?? null))) {
    throw new Error('同名文件夹已存在');
  }

  const oldRel = await getFolderRelativePath(id);
  const parentRel = folder.parentId ? await getFolderRelativePath(folder.parentId) : '';
  const newRel = parentRel ? path.join(parentRel, safeName) : safeName;
  const oldAbs = path.join(FILES_DIR, ...oldRel.split(path.sep));
  const newAbs = path.join(FILES_DIR, ...newRel.split(path.sep));

  if (fsSync.existsSync(oldAbs)) {
    await ensureDir(path.dirname(newAbs));
    await fs.rename(oldAbs, newAbs);
    await remapFileRelativePaths(oldRel.split(path.sep).join('/'), newRel.split(path.sep).join('/'));
  }

  folder.name = safeName;
  await saveFoldersJson(list);
  return folder;
}

async function moveFolder(id, newParentId) {
  const list = await readFoldersJson();
  const folder = list.find((f) => f.id === id);
  if (!folder) throw new Error('文件夹不存在');
  const pid = normalizeFolderId(newParentId);
  if (pid === id) throw new Error('不能移动到自身');
  if (pid) {
    const parent = await getFolderById(pid);
    if (!parent) throw new Error('目标文件夹不存在');
    if (await isDescendant(pid, id)) throw new Error('不能移动到子文件夹');
    await ensureFolderOnDisk(pid);
  }

  if (list.some((f) => f.id !== id && f.name === folder.name && (f.parentId ?? null) === pid)) {
    throw new Error('目标位置已有同名文件夹');
  }

  const oldRel = await getFolderRelativePath(id);
  folder.parentId = pid;

  const parts = [folder.name];
  let p = pid;
  while (p) {
    const parent = list.find((f) => f.id === p);
    if (!parent) break;
    parts.unshift(parent.name);
    p = parent.parentId ?? null;
  }
  const newRel = parts.join(path.sep);
  const oldAbs = path.join(FILES_DIR, ...oldRel.split(path.sep));
  const newAbs = path.join(FILES_DIR, ...newRel.split(path.sep));

  if (fsSync.existsSync(oldAbs)) {
    await ensureDir(path.dirname(newAbs));
    await fs.rename(oldAbs, newAbs);
    await remapFileRelativePaths(oldRel.split(path.sep).join('/'), newRel.split(path.sep).join('/'));
  }

  await saveFoldersJson(list);
  return folder;
}

async function isDescendant(folderId, ancestorId) {
  let current = await getFolderById(folderId);
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? await getFolderById(current.parentId) : null;
  }
  return false;
}

async function deleteFolder(id) {
  const { listFilesInFolder } = require('./fileService');
  const subFolders = await listFolders(id);
  const files = await listFilesInFolder(id);
  if (subFolders.length || files.length) {
    throw new Error('文件夹非空，请先清空');
  }

  const folder = await getFolderById(id);
  const abs = await getFolderAbsolutePath(id);
  if (fsSync.existsSync(abs)) {
    await fs.rmdir(abs).catch(() => {});
  }

  const list = await readFoldersJson();
  const index = list.findIndex((f) => f.id === id);
  if (index === -1) throw new Error('文件夹不存在');
  list.splice(index, 1);
  await saveFoldersJson(list);
}

async function getBreadcrumb(folderId) {
  const crumbs = [{ id: null, name: '根目录' }];
  let current = folderId ? await getFolderById(folderId) : null;
  const chain = [];
  while (current) {
    chain.unshift({ id: current.id, name: current.name });
    current = current.parentId ? await getFolderById(current.parentId) : null;
  }
  return crumbs.concat(chain);
}

function normalizeFolderPathText(input) {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^根目录\/?/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
}

async function findFolderByPath(inputPath) {
  const normalized = normalizeFolderPathText(inputPath);
  if (!normalized || normalized === '.') return null;

  const parts = normalized.split('/').filter(Boolean);
  const list = await readFoldersJson();
  let parentId = null;
  let current = null;

  for (const part of parts) {
    current = list.find((f) => f.name === part && (f.parentId ?? null) === parentId) || null;
    if (!current) return undefined;
    parentId = current.id;
  }

  return current;
}

/** 启动时确保所有文件夹在磁盘存在 */
async function ensureAllFoldersOnDisk() {
  const list = await readFoldersJson();
  for (const f of list) {
    await ensureFolderOnDisk(f.id);
  }
}

module.exports = {
  normalizeFolderId,
  getFolderById,
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  getBreadcrumb,
  findFolderByPath,
  ensureAllFoldersOnDisk,
  readFoldersJson,
};
