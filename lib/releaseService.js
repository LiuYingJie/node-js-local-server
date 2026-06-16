const fs = require('fs/promises');
const path = require('path');
const { RELEASE_JSON, LEGACY_VERSION_FILE, sanitizeVersion } = require('./paths');
const { ensureDir, formatDateTime } = require('./fileUtils');
const { getFileById } = require('./fileService');

async function getReleaseConfig() {
  try {
    const raw = await fs.readFile(RELEASE_JSON, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function saveReleaseConfig(config) {
  await ensureDir(path.dirname(RELEASE_JSON));
  await fs.writeFile(RELEASE_JSON, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 设置软件发布版本（可选功能，供客户端 /version.json 使用）
 */
async function setRelease({ fileId, version, desc, force }) {
  const file = await getFileById(fileId);
  if (!file) {
    throw new Error('文件不存在');
  }

  const config = {
    fileId,
    version: sanitizeVersion(version),
    force: Boolean(force),
    desc: (desc || '').trim(),
    updateTime: formatDateTime(),
  };

  await saveReleaseConfig(config);
  return config;
}

/** 清除发布版本 */
async function clearRelease() {
  try {
    await fs.unlink(RELEASE_JSON);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * 获取 version.json 格式的发布信息
 */
async function getVersionInfo(baseUrl) {
  let config = await getReleaseConfig();

  // 旧版 version.json 迁移
  if (!config) {
    config = await migrateLegacyRelease();
  }
  if (!config || !config.fileId) return null;

  const file = await getFileById(config.fileId);
  if (!file) return null;

  return {
    version: config.version,
    fileName: file.fileName,
    url: `${baseUrl}/download/latest`,
    md5: file.md5,
    size: file.size,
    force: Boolean(config.force),
    desc: config.desc || file.desc || '',
    updateTime: config.updateTime,
    fileId: file.id,
  };
}

/** 从旧版 uploads/version.json 迁移发布配置 */
async function migrateLegacyRelease() {
  try {
    const raw = await fs.readFile(LEGACY_VERSION_FILE, 'utf-8');
    const legacy = JSON.parse(raw);
    const { listFiles } = require('./fileService');
    const files = await listFiles();
    const file = files.find((f) => f.fileName === legacy.fileName);
    if (!file) return null;

    const config = {
      fileId: file.id,
      version: legacy.version,
      force: Boolean(legacy.force),
      desc: legacy.desc || '',
      updateTime: legacy.updateTime || formatDateTime(),
    };
    await saveReleaseConfig(config);
    return config;
  } catch {
    return null;
  }
}

/** 获取当前发布版本对应的文件记录 */
async function getReleaseFile() {
  const config = await getReleaseConfig();
  if (!config?.fileId) return null;
  return getFileById(config.fileId);
}

module.exports = {
  getReleaseConfig,
  setRelease,
  clearRelease,
  getVersionInfo,
  getReleaseFile,
};
