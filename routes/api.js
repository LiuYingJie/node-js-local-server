const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { getFileById, getFilePath } = require('../lib/fileService');
const { getVersionInfo, getReleaseFile } = require('../lib/releaseService');
const { sendFileDownload } = require('../lib/downloadHelper');

const router = express.Router();
const PREVIEW_MAX_SIZE = 5 * 1024 * 1024;

function getPreviewType(fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  if (ext === 'txt') return 'text';
  if (ext === 'json') return 'json';
  return null;
}

router.get('/version.json', async (req, res, next) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const info = await getVersionInfo(baseUrl);
    if (!info) return res.status(404).json({ error: '暂未设置发布版本' });
    const { fileId, ...publicInfo } = info;
    res.json(publicInfo);
  } catch (err) {
    next(err);
  }
});

router.get('/preview/:id', async (req, res, next) => {
  try {
    const file = await getFileById(req.params.id);
    if (!file) return res.status(404).send('文件不存在');

    const previewType = getPreviewType(file.fileName);
    if (!previewType) return res.status(415).send('此文件类型不支持预览');
    if (file.size > PREVIEW_MAX_SIZE) return res.status(413).send('文件过大，不支持在线预览');

    const filePath = getFilePath(file);
    if (!fs.existsSync(filePath)) return res.status(404).send('文件不存在');

    const content = await fsPromises.readFile(filePath, 'utf-8');
    res.render('preview', {
      file,
      content,
      previewType,
      maxSizeMB: PREVIEW_MAX_SIZE / 1024 / 1024,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/download/:id', async (req, res, next) => {
  try {
    const file = await getFileById(req.params.id);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const filePath = getFilePath(file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    sendFileDownload(res, filePath, file.fileName, file.size, next);
  } catch (err) {
    next(err);
  }
});

router.get('/download/latest', async (req, res, next) => {
  try {
    const file = await getReleaseFile();
    if (!file) return res.status(404).json({ error: '暂未设置发布版本' });
    const filePath = getFilePath(file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    sendFileDownload(res, filePath, file.fileName, file.size, next);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
