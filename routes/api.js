const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { getFileById, getFileByRelativePath, getFilePath } = require('../lib/fileService');
const { sendFileDownload } = require('../lib/downloadHelper');
const { requireLogin } = require('../middleware/auth');
const { canAccessFolder } = require('../lib/permissionService');
const { writeAudit } = require('../lib/auditService');
const { computeMd5, getFileSize, formatDateTime } = require('../lib/fileUtils');
const { FILES_JSON } = require('../lib/paths');

const router = express.Router();
const PREVIEW_MAX_SIZE = 5 * 1024 * 1024;

function getPreviewType(fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  if (ext === 'txt') return 'text';
  if (ext === 'json') return 'json';
  return null;
}

router.get('/preview/:id', async (req, res, next) => {
  try {
    const file = await getFileById(req.params.id);
    if (!file) return res.status(404).send('文件不存在');

    const previewType = getPreviewType(file.fileName);
    if (!previewType) return res.status(415).send('此文件类型不支持预览');
    if (file.size > PREVIEW_MAX_SIZE) return res.status(413).send('文件过大，不支持在线预览');

    const filePath = getFilePath(file);
    if (!fs.existsSync(filePath)) return res.status(404).send('文件不存在');
    if (!(await canAccessFolder(req, file.folderId ?? null, 'read'))) {
      return res.status(403).send('没有访问权限');
    }

    const content = await fsPromises.readFile(filePath, 'utf-8');
    const canEdit = await canAccessFolder(req, file.folderId ?? null, 'update');
    res.render('preview', {
      file,
      content,
      previewType,
      canEdit,
      maxSizeMB: PREVIEW_MAX_SIZE / 1024 / 1024,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/api/files/:id/content', requireLogin, express.json({ limit: '6mb' }), async (req, res) => {
  try {
    const file = await getFileById(req.params.id);
    if (!file) return res.status(404).json({ error: '文件不存在' });

    const previewType = getPreviewType(file.fileName);
    if (!previewType) return res.status(415).json({ error: '此文件类型不支持编辑' });
    if (!(await canAccessFolder(req, file.folderId ?? null, 'update'))) {
      return res.status(403).json({ error: '没有修改权限' });
    }

    let content = String(req.body?.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > PREVIEW_MAX_SIZE) {
      return res.status(413).json({ error: '内容过大，不能保存' });
    }
    if (previewType === 'json') {
      try {
        content = JSON.stringify(JSON.parse(content), null, 2) + '\n';
      } catch (err) {
        return res.status(400).json({ error: 'JSON 格式错误: ' + err.message });
      }
    }

    const filePath = getFilePath(file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    await fsPromises.writeFile(filePath, content, 'utf-8');

    const raw = await fsPromises.readFile(FILES_JSON, 'utf-8');
    const list = JSON.parse(raw);
    const record = Array.isArray(list) ? list.find((item) => item.id === file.id) : null;
    if (record) {
      record.size = await getFileSize(filePath);
      record.md5 = await computeMd5(filePath);
      record.updateTime = formatDateTime();
      await fsPromises.writeFile(FILES_JSON, JSON.stringify(list, null, 2), 'utf-8');
    }

    await writeAudit(req, 'file.content.update', {
      folderId: file.folderId,
      targetType: 'file',
      targetId: file.id,
      targetName: file.fileName,
    });

    res.json({ success: true, content, file: record || file });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function sendFileRecord(file, req, res, next) {
  if (!file) return res.status(404).json({ error: '文件不存在' });
  if (!(await canAccessFolder(req, file.folderId ?? null, 'read'))) {
    return res.status(403).json({ error: '没有访问权限' });
  }
  const filePath = getFilePath(file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  return sendFileDownload(res, filePath, file.fileName, file.size, next);
}

router.get(/^\/download\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, async (req, res, next) => {
  try {
    await sendFileRecord(await getFileById(req.params[0]), req, res, next);
  } catch (err) {
    next(err);
  }
});

router.get(/^\/download\/(.+)$/, async (req, res, next) => {
  try {
    const relPath = decodeURIComponent(req.params[0] || '');
    await sendFileRecord(await getFileByRelativePath(relPath), req, res, next);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
