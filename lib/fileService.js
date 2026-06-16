const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  FILES_DIR,
  FILES_JSON,
  LEGACY_HISTORY_DIR,
  LEGACY_HISTORY_JSON,
  sanitizeFileName,
} = require('./paths');
const { normalizeFolderId, getFolderById, ensureAllFoldersOnDisk } = require('./folderService');
const {
  resolveFileAbsolutePath,
  getAbsolutePathFromRecord,
  ensureFolderOnDisk,
  buildFileRelativePath,
} = require('./storagePath');
const { ensureDir, computeMd5, getFileSize, copyFile, formatDateTime } = require('./fileUtils');

async function readFilesJson() {
  try {
    const raw = await fs.readFile(FILES_JSON, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveFilesJson(list) {
  await ensureDir(path.dirname(FILES_JSON));
  await fs.writeFile(FILES_JSON, JSON.stringify(list, null, 2), 'utf-8');
}

async function listFiles(folderId = undefined) {
  const list = await readFilesJson();
  const sorted = list.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'));
  if (folderId === undefined) return sorted;
  const fid = normalizeFolderId(folderId);
  return sorted.filter((f) => (f.folderId ?? null) === fid);
}

async function listFilesInFolder(folderId = null) {
  return listFiles(folderId);
}

async function getFileById(id) {
  const list = await readFilesJson();
  return list.find((item) => item.id === id) || null;
}

function getFilePath(record) {
  return getAbsolutePathFromRecord(record);
}

async function assertFolderExists(folderId) {
  const fid = normalizeFolderId(folderId);
  if (fid) {
    const folder = await getFolderById(fid);
    if (!folder) throw new Error('文件夹不存在');
    await ensureFolderOnDisk(fid);
  }
}

async function uploadFile({ tempFilePath, originalName, desc, folderId = null }) {
  await assertFolderExists(folderId);
  const fileName = sanitizeFileName(originalName);
  const fid = normalizeFolderId(folderId);
  const list = await readFilesJson();
  if (list.some((f) => f.fileName === fileName && (f.folderId ?? null) === fid)) {
    throw new Error('同名文件已存在');
  }

  const { relativePath, absolutePath } = await resolveFileAbsolutePath(fid, fileName);
  await ensureDir(path.dirname(absolutePath));
  await copyFile(tempFilePath, absolutePath);

  const md5 = await computeMd5(absolutePath);
  const size = await getFileSize(absolutePath);
  const id = crypto.randomUUID();

  const record = {
    id,
    fileName,
    relativePath,
    folderId: fid,
    md5,
    size,
    desc: (desc || '').trim(),
    uploadTime: formatDateTime(),
  };

  list.push(record);
  await saveFilesJson(list);
  return record;
}

async function renameFile(id, fileName, desc) {
  const list = await readFilesJson();
  const record = list.find((f) => f.id === id);
  if (!record) throw new Error('文件不存在');

  if (fileName != null) {
    const safeName = sanitizeFileName(fileName);
    if (list.some((f) => f.id !== id && f.fileName === safeName && (f.folderId ?? null) === (record.folderId ?? null))) {
      throw new Error('同名文件已存在');
    }
    const oldAbs = getAbsolutePathFromRecord(record);
    const { absolutePath: newAbs, relativePath: newRel } = await resolveFileAbsolutePath(record.folderId, safeName);
    if (fsSync.existsSync(oldAbs)) {
      await ensureDir(path.dirname(newAbs));
      await fs.rename(oldAbs, newAbs);
    }
    record.fileName = safeName;
    record.relativePath = newRel;
  }
  if (desc != null) record.desc = String(desc).trim();
  record.updateTime = formatDateTime();
  await saveFilesJson(list);
  return record;
}

async function moveFile(id, folderId) {
  await assertFolderExists(folderId);
  const fid = normalizeFolderId(folderId);
  const list = await readFilesJson();
  const record = list.find((f) => f.id === id);
  if (!record) throw new Error('文件不存在');
  if (list.some((f) => f.id !== id && f.fileName === record.fileName && (f.folderId ?? null) === fid)) {
    throw new Error('目标位置已有同名文件');
  }

  const oldAbs = getAbsolutePathFromRecord(record);
  const { absolutePath: newAbs, relativePath: newRel } = await resolveFileAbsolutePath(fid, record.fileName);
  if (fsSync.existsSync(oldAbs)) {
    await ensureDir(path.dirname(newAbs));
    await fs.rename(oldAbs, newAbs);
  }

  record.folderId = fid;
  record.relativePath = newRel;
  record.updateTime = formatDateTime();
  await saveFilesJson(list);
  return record;
}

async function deleteFile(id) {
  const list = await readFilesJson();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('文件不存在');

  const record = list[index];
  const filePath = getAbsolutePathFromRecord(record);
  await fs.unlink(filePath).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });

  list.splice(index, 1);
  await saveFilesJson(list);
  return record;
}

/** 将旧版 uuid_文件名 迁移到按目录存放 */
async function migrateStorageLayout() {
  const list = await readFilesJson();
  let changed = false;

  for (const record of list) {
    if (record.relativePath && !record.storageName) continue;

    const fileName = record.fileName || sanitizeFileName(record.storageName?.replace(/^[^_]+_/, '') || '');
    const fid = record.folderId ?? null;

    let oldAbs;
    if (record.storageName) {
      oldAbs = path.join(FILES_DIR, record.storageName);
    } else if (record.relativePath) {
      oldAbs = path.join(FILES_DIR, ...record.relativePath.split('/'));
    } else {
      continue;
    }

    const { relativePath, absolutePath } = await resolveFileAbsolutePath(fid, fileName);
    if (fsSync.existsSync(oldAbs)) {
      if (path.resolve(oldAbs) !== path.resolve(absolutePath)) {
        await ensureDir(path.dirname(absolutePath));
        if (fsSync.existsSync(absolutePath)) {
          await fs.unlink(absolutePath);
        }
        await fs.rename(oldAbs, absolutePath);
      }
    } else if (!fsSync.existsSync(absolutePath)) {
      continue;
    }

    record.fileName = fileName;
    record.relativePath = relativePath;
    record.folderId = fid;
    delete record.storageName;
    changed = true;
  }

  if (changed) await saveFilesJson(list);
  await ensureAllFoldersOnDisk();
}

async function migrateLegacyData() {
  const existing = await readFilesJson();
  if (existing.length > 0) {
    await migrateStorageLayout();
    return;
  }

  let legacyList = [];
  try {
    const raw = await fs.readFile(LEGACY_HISTORY_JSON, 'utf-8');
    legacyList = JSON.parse(raw);
    if (!Array.isArray(legacyList)) legacyList = [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return;
  }

  if (legacyList.length === 0) return;

  await ensureDir(FILES_DIR);
  const migrated = [];

  for (const item of legacyList) {
    const legacyPath = path.join(LEGACY_HISTORY_DIR, item.historyFileName);
    if (!fsSync.existsSync(legacyPath)) continue;

    const id = item.id || crypto.randomUUID();
    const fileName = sanitizeFileName(item.fileName);
    const { relativePath, absolutePath } = await resolveFileAbsolutePath(null, fileName);
    await ensureDir(path.dirname(absolutePath));
    await copyFile(legacyPath, absolutePath);

    migrated.push({
      id,
      fileName,
      relativePath,
      folderId: null,
      md5: item.md5,
      size: item.size,
      desc: item.desc || '',
      uploadTime: item.updateTime || formatDateTime(),
    });
  }

  if (migrated.length > 0) {
    await saveFilesJson(migrated);
    console.log(`[迁移] 已从旧版数据导入 ${migrated.length} 个文件`);
  }
}

module.exports = {
  listFiles,
  listFilesInFolder,
  getFileById,
  getFilePath,
  uploadFile,
  renameFile,
  moveFile,
  deleteFile,
  migrateLegacyData,
  migrateStorageLayout,
};
