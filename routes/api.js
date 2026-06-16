const express = require('express');
const fs = require('fs');
const { getFileById, getFilePath } = require('../lib/fileService');
const { getVersionInfo, getReleaseFile } = require('../lib/releaseService');
const { sendFileDownload } = require('../lib/downloadHelper');

const router = express.Router();

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
