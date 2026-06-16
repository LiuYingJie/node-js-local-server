const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { FOLDERS_JSON } = require('./paths');
const { ensureDir, formatDateTime } = require('./fileUtils');

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
  return folder;
}

async function renameFolder(id, name) {
  const folder = await getFolderById(id);
  if (!folder) throw new Error('文件夹不存在');
  const safeName = sanitizeFolderName(name);
  const list = await readFoldersJson();
  if (list.some((f) => f.id !== id && f.name === safeName && (f.parentId ?? null) === (folder.parentId ?? null))) {
    throw new Error('同名文件夹已存在');
  }
  folder.name = safeName;
  await saveFoldersJson(list);
  return folder;
}

async function moveFolder(id, newParentId) {
  const folder = await getFolderById(id);
  if (!folder) throw new Error('文件夹不存在');
  const pid = normalizeFolderId(newParentId);
  if (pid === id) throw new Error('不能移动到自身');
  if (pid) {
    const parent = await getFolderById(pid);
    if (!parent) throw new Error('目标文件夹不存在');
    if (await isDescendant(pid, id)) throw new Error('不能移动到子文件夹');
  }
  const list = await readFoldersJson();
  if (list.some((f) => f.id !== id && f.name === folder.name && (f.parentId ?? null) === pid)) {
    throw new Error('目标位置已有同名文件夹');
  }
  folder.parentId = pid;
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
  const list = await readFoldersJson();
  const index = list.findIndex((f) => f.id === id);
  if (index === -1) throw new Error('文件夹不存在');
  list.splice(index, 1);
  await saveFoldersJson(list);
}

/** 构建面包屑路径 */
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

module.exports = {
  normalizeFolderId,
  getFolderById,
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  getBreadcrumb,
};
