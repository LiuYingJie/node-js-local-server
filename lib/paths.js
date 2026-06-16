const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORAGE_DIR = path.join(ROOT, 'storage');
const FILES_DIR = path.join(STORAGE_DIR, 'files');
const TEMP_DIR = path.join(STORAGE_DIR, 'temp');
const FILES_JSON = path.join(ROOT, 'data', 'files.json');
const FOLDERS_JSON = path.join(ROOT, 'data', 'folders.json');
const USERS_JSON = path.join(ROOT, 'data', 'users.json');
const AUDIT_LOG = path.join(ROOT, 'data', 'audit.log');

// 旧版目录，仅用于数据迁移
const LEGACY_UPLOADS_DIR = path.join(ROOT, 'uploads');
const LEGACY_HISTORY_DIR = path.join(LEGACY_UPLOADS_DIR, 'history');
const LEGACY_HISTORY_JSON = path.join(ROOT, 'data', 'history.json');

/** 清理文件名，防止路径穿越 */
function sanitizeFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    throw new Error('无效的文件名');
  }
  let safe = path.basename(fileName);
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('无效的文件名');
  }
  if (/[\\/]/.test(safe)) {
    throw new Error('文件名不能包含路径分隔符');
  }
  return safe;
}

/** 清理版本号 */
function sanitizeVersion(version) {
  if (!version || typeof version !== 'string') {
    throw new Error('无效的版本号');
  }
  const safe = version.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!safe) {
    throw new Error('无效的版本号');
  }
  return safe;
}

/** 确保路径在指定根目录内 */
function ensureInsideDir(rootDir, targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(rootDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('非法路径访问');
  }
  return resolved;
}

module.exports = {
  ROOT,
  STORAGE_DIR,
  FILES_DIR,
  TEMP_DIR,
  FILES_JSON,
  FOLDERS_JSON,
  USERS_JSON,
  AUDIT_LOG,
  LEGACY_HISTORY_DIR,
  LEGACY_HISTORY_JSON,
  sanitizeFileName,
  sanitizeVersion,
  ensureInsideDir,
};
