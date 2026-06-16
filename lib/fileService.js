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
  ensureInsideDir,
} = require('./paths');
const { normalizeFolderId, getFolderById } = require('./folderService');
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
  const sorted = list.sort((a, b) => (b.uploadTime || '').localeCompare(a.uploadTime || ''));
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
  const storageName = sanitizeFileName(record.storageName);
  const filePath = path.join(FILES_DIR, storageName);
  ensureInsideDir(FILES_DIR, filePath);
  return filePath;
}

async function assertFolderExists(folderId) {
  const fid = normalizeFolderId(folderId);
  if (fid) {
    const folder = await getFolderById(fid);
    if (!folder) throw new Error('文件夹不存在');
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

  const id = crypto.randomUUID();
  const storageName = `${id}_${fileName}`;
  const destPath = path.join(FILES_DIR, storageName);
  ensureInsideDir(FILES_DIR, destPath);

  await ensureDir(FILES_DIR);
  await copyFile(tempFilePath, destPath);

  const md5 = await computeMd5(destPath);
  const size = await getFileSize(destPath);

  const record = {
    id,
    fileName,
    storageName,
    folderId: fid,
    md5,
    size,
    desc: (desc || '').trim(),
    uploadTime: formatDateTime(),
  };

  list.unshift(record);
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
    record.fileName = safeName;
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
  record.folderId = fid;
  record.updateTime = formatDateTime();
  await saveFilesJson(list);
  return record;
}

async function deleteFile(id) {
  const list = await readFilesJson();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('文件不存在');

  const record = list[index];
  const filePath = getFilePath(record);
  await fs.unlink(filePath).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });

  list.splice(index, 1);
  await saveFilesJson(list);
  return record;
}

async function migrateLegacyData() {
  const existing = await readFilesJson();
  if (existing.length > 0) {
    let changed = false;
    for (const item of existing) {
      if (item.folderId === undefined) {
        item.folderId = null;
        changed = true;
      }
    }
    if (changed) await saveFilesJson(existing);
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
    const storageName = `${id}_${fileName}`;
    const destPath = path.join(FILES_DIR, storageName);
    ensureInsideDir(FILES_DIR, destPath);
    await copyFile(legacyPath, destPath);

    migrated.push({
      id,
      fileName,
      storageName,
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
};
