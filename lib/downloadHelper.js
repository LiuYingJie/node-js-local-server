const fs = require('fs');
const { getContentType } = require('./fileUtils');
const { sanitizeFileName } = require('./paths');

/**
 * 流式发送文件下载响应
 */
function sendFileDownload(res, filePath, fileName, size, next) {
  const safeName = sanitizeFileName(fileName);
  res.setHeader('Content-Type', getContentType(safeName));
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);
  if (size != null) {
    res.setHeader('Content-Length', size);
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', next);
  stream.pipe(res);
}

/** 格式化文件大小显示 */
function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/** 根据扩展名返回简单类型标签 */
function getFileTypeLabel(fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  const map = {
    zip: '压缩包', rar: '压缩包', '7z': '压缩包',
    exe: '程序', dll: '库文件',
    json: '配置', txt: '文本', ini: '配置', yaml: '配置', yml: '配置',
    png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', webp: '图片',
    pdf: '文档', doc: '文档', docx: '文档',
  };
  return map[ext] || ext.toUpperCase() || '文件';
}

module.exports = { sendFileDownload, formatSize, getFileTypeLabel };
