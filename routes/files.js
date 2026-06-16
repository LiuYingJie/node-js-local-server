const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const { loadConfig } = require('../lib/config');
const { TEMP_DIR } = require('../lib/paths');
const { ensureDir } = require('../lib/fileUtils');
const { isAdmin, requireAuth } = require('../middleware/auth');
const { listEntries } = require('../lib/entryService');
const { uploadFile, renameFile, moveFile, deleteFile } = require('../lib/fileService');
const { createFolder, renameFolder, moveFolder, deleteFolder, normalizeFolderId } = require('../lib/folderService');
const { getVersionInfo, getReleaseConfig, setRelease, clearRelease } = require('../lib/releaseService');

const router = express.Router();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await ensureDir(TEMP_DIR);
      cb(null, TEMP_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  },
});

function createUpload() {
  const config = loadConfig();
  const maxSize = (config.maxUploadSizeMB || 2048) * 1024 * 1024;
  return multer({ storage, limits: { fileSize: maxSize } });
}

/** GET /api/session */
router.get('/api/session', (req, res) => {
  const config = loadConfig();
  res.json({
    isAdmin: isAdmin(req),
    maxUploadSizeMB: config.maxUploadSizeMB || 2048,
  });
});

/** GET /api/entries?folderId= - 浏览目录 */
router.get('/api/entries', async (req, res, next) => {
  try {
    const folderId = normalizeFolderId(req.query.folderId);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const data = await listEntries(folderId, baseUrl);
    res.json({ ...data, isAdmin: isAdmin(req) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/upload - 上传（需登录） */
router.post('/api/upload', requireAuth, (req, res, next) => {
  const upload = createUpload().array('files', 50);

  upload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const config = loadConfig();
        return res.status(400).json({ error: `文件过大，最大 ${config.maxUploadSizeMB || 2048} MB` });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }

    if (!req.files?.length) {
      return res.status(400).json({ error: '没有收到文件' });
    }

    const folderId = normalizeFolderId(req.body.folderId);
    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const record = await uploadFile({
          tempFilePath: file.path,
          originalName: file.originalname,
          desc: (req.body.desc || '').trim(),
          folderId,
        });
        results.push(record);
      } catch (e) {
        errors.push({ name: file.originalname, error: e.message });
      } finally {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    res.json({
      success: errors.length === 0,
      uploaded: results,
      errors,
    });
  });
});

/** POST /api/folders - 新建文件夹 */
router.post('/api/folders', requireAuth, express.json(), async (req, res, next) => {
  try {
    const folder = await createFolder(req.body.name, req.body.parentId);
    res.json({ success: true, folder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PATCH /api/folders/:id */
router.patch('/api/folders/:id', requireAuth, express.json(), async (req, res, next) => {
  try {
    let folder;
    if (req.body.name != null) {
      folder = await renameFolder(req.params.id, req.body.name);
    }
    if (req.body.parentId !== undefined) {
      folder = await moveFolder(req.params.id, req.body.parentId);
    }
    res.json({ success: true, folder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/folders/:id */
router.delete('/api/folders/:id', requireAuth, async (req, res, next) => {
  try {
    await deleteFolder(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PATCH /api/files/:id - 重命名/移动/修改说明 */
router.patch('/api/files/:id', requireAuth, express.json(), async (req, res, next) => {
  try {
    let file;
    if (req.body.fileName != null || req.body.desc != null) {
      file = await renameFile(req.params.id, req.body.fileName, req.body.desc);
    }
    if (req.body.folderId !== undefined) {
      file = await moveFile(req.params.id, req.body.folderId);
    }
    res.json({ success: true, file });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/files/:id */
router.delete('/api/files/:id', requireAuth, async (req, res, next) => {
  try {
    const release = await getReleaseConfig();
    if (release?.fileId === req.params.id) await clearRelease();
    await deleteFile(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/release - 设为发布版本 */
router.post('/api/release', requireAuth, express.json(), async (req, res, next) => {
  try {
    const { fileId, version, desc, force } = req.body;
    if (!fileId || !version?.trim()) {
      return res.status(400).json({ error: '请选择文件并填写版本号' });
    }
    await setRelease({
      fileId,
      version: String(version).trim(),
      desc: (desc || '').trim(),
      force: Boolean(force),
    });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const versionInfo = await getVersionInfo(baseUrl);
    res.json({ success: true, versionInfo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/release */
router.delete('/api/release', requireAuth, async (req, res, next) => {
  try {
    await clearRelease();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
