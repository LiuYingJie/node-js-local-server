const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const path = require('path');

/**
 * 确保目录存在
 */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * 流式计算文件 MD5
 */
function computeMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 获取文件大小
 */
async function getFileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

/**
 * 复制文件
 */
async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

/**
 * 格式化本地时间为 YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * 根据扩展名返回 Content-Type（未知类型用 application/octet-stream）
 */
function getContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.exe': 'application/vnd.microsoft.portable-executable',
    '.dll': 'application/octet-stream',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  ensureDir,
  computeMd5,
  getFileSize,
  copyFile,
  formatDateTime,
  getContentType,
};
