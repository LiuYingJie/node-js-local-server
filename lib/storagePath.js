const fs = require('fs/promises');
const path = require('path');
const { FILES_DIR, FOLDERS_JSON, sanitizeFileName, ensureInsideDir } = require('./paths');
const { ensureDir } = require('./fileUtils');

async function readFoldersList() {
  try {
    const raw = await fs.readFile(FOLDERS_JSON, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function getFolderRecord(id) {
  if (!id) return null;
  const list = await readFoldersList();
  return list.find((f) => f.id === id) || null;
}

/** 根据 folderId 得到磁盘相对路径，支持中文文件夹名 */
async function getFolderRelativePath(folderId) {
  if (!folderId) return '';
  const parts = [];
  let current = await getFolderRecord(folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? await getFolderRecord(current.parentId) : null;
  }
  return parts.join(path.sep);
}

async function buildFileRelativePath(folderId, fileName) {
  const safeName = sanitizeFileName(fileName);
  const folderRel = await getFolderRelativePath(folderId);
  const rel = folderRel ? path.join(folderRel, safeName) : safeName;
  return rel.split(path.sep).join('/');
}

async function resolveFileAbsolutePath(folderId, fileName) {
  const relativePath = await buildFileRelativePath(folderId, fileName);
  const absolutePath = path.join(FILES_DIR, ...relativePath.split('/'));
  ensureInsideDir(FILES_DIR, absolutePath);
  return { relativePath, absolutePath };
}

function getAbsolutePathFromRecord(record) {
  let rel;
  if (record.relativePath) {
    rel = record.relativePath;
  } else if (record.storageName) {
    rel = record.storageName;
  } else {
    throw new Error('无效的文件路径');
  }
  const absolutePath = path.join(FILES_DIR, ...rel.split('/'));
  ensureInsideDir(FILES_DIR, absolutePath);
  return absolutePath;
}

async function getFolderAbsolutePath(folderId) {
  const rel = await getFolderRelativePath(folderId);
  const abs = rel ? path.join(FILES_DIR, ...rel.split(path.sep)) : FILES_DIR;
  ensureInsideDir(FILES_DIR, abs);
  return abs;
}

async function ensureFolderOnDisk(folderId) {
  const abs = await getFolderAbsolutePath(folderId);
  await ensureDir(abs);
  return abs;
}

async function remapFileRelativePaths(oldPrefix, newPrefix) {
  const { FILES_JSON } = require('./paths');
  const oldNorm = oldPrefix.replace(/\\/g, '/');
  const newNorm = newPrefix.replace(/\\/g, '/');

  let list;
  try {
    const raw = await fs.readFile(FILES_JSON, 'utf-8');
    list = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;

  let changed = false;
  for (const f of list) {
    const rel = (f.relativePath || '').replace(/\\/g, '/');
    if (!rel) continue;
    if (rel === oldNorm || rel.startsWith(oldNorm + '/')) {
      f.relativePath = newNorm + rel.slice(oldNorm.length);
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(FILES_JSON, JSON.stringify(list, null, 2), 'utf-8');
  }
}

async function listAllFoldersFlat() {
  const list = await readFoldersList();
  const result = [];
  for (const f of list) {
    const rel = await getFolderRelativePath(f.id);
    result.push({
      id: f.id,
      name: f.name,
      path: rel.split(path.sep).join('/'),
      parentId: f.parentId ?? null,
    });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

module.exports = {
  getFolderRelativePath,
  buildFileRelativePath,
  resolveFileAbsolutePath,
  getAbsolutePathFromRecord,
  getFolderAbsolutePath,
  ensureFolderOnDisk,
  remapFileRelativePaths,
  listAllFoldersFlat,
};
