const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const { loadConfig } = require('../lib/config');
const { TEMP_DIR } = require('../lib/paths');
const { ensureDir } = require('../lib/fileUtils');
const { isAdmin, currentUser, requireAuth } = require('../middleware/auth');
const { writeAudit } = require('../lib/auditService');
const { listEntries } = require('../lib/entryService');
const { uploadFile, renameFile, moveFile, deleteFile } = require('../lib/fileService');
const { createFolder, renameFolder, moveFolder, deleteFolder, normalizeFolderId, findFolderByPath } = require('../lib/folderService');
const { listAllFoldersFlat } = require('../lib/storagePath');
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
    user: currentUser(req),
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
        await writeAudit(req, 'file.upload', {
          folderId,
          targetType: 'file',
          targetId: record.id,
          targetName: record.fileName,
        });
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

/** GET /api/folders/all - 全部文件夹（移动用） */
router.get('/api/folders/all', requireAuth, async (req, res, next) => {
  try {
    const folders = await listAllFoldersFlat();
    res.json(folders);
  } catch (err) {
    next(err);
  }
});

/** GET /api/folders/resolve?path=父/子 - 根据路径定位文件夹 */
router.get('/api/folders/resolve', async (req, res) => {
  try {
    const folder = await findFolderByPath(req.query.path || '');
    if (folder === undefined) {
      return res.status(404).json({ error: '目录不存在' });
    }
    res.json({ folderId: folder ? folder.id : null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/move - 批量移动 */
router.post('/api/move', requireAuth, express.json(), async (req, res, next) => {
  try {
    const { targetFolderId, items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: '请选择要移动的项目' });
    }
    const targetId = normalizeFolderId(targetFolderId);
    const moved = [];
    for (const item of items) {
      if (item.type === 'file') {
        const file = await moveFile(item.id, targetId);
        moved.push(file);
        await writeAudit(req, 'file.move', {
          folderId: file.folderId,
          targetFolderId: targetId,
          targetType: 'file',
          targetId: file.id,
          targetName: file.fileName,
        });
      } else if (item.type === 'folder') {
        if (item.id === targetId) throw new Error('不能移动到自身');
        const folder = await moveFolder(item.id, targetId);
        moved.push(folder);
        await writeAudit(req, 'folder.move', {
          folderId: folder.parentId,
          targetFolderId: targetId,
          targetType: 'folder',
          targetId: folder.id,
          targetName: folder.name,
        });
      }
    }
    res.json({ success: true, moved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/folders - 新建文件夹 */
router.post('/api/folders', requireAuth, express.json(), async (req, res, next) => {
  try {
    const folder = await createFolder(req.body.name, req.body.parentId);
    await writeAudit(req, 'folder.create', {
      folderId: folder.parentId,
      targetType: 'folder',
      targetId: folder.id,
      targetName: folder.name,
    });
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
      await writeAudit(req, 'folder.rename', {
        folderId: folder.parentId,
        targetType: 'folder',
        targetId: folder.id,
        targetName: folder.name,
      });
    }
    if (req.body.parentId !== undefined) {
      folder = await moveFolder(req.params.id, req.body.parentId);
      await writeAudit(req, 'folder.move', {
        folderId: folder.parentId,
        targetFolderId: folder.parentId,
        targetType: 'folder',
        targetId: folder.id,
        targetName: folder.name,
      });
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
    await writeAudit(req, 'folder.delete', {
      targetType: 'folder',
      targetId: req.params.id,
    });
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
      await writeAudit(req, 'file.update', {
        folderId: file.folderId,
        targetType: 'file',
        targetId: file.id,
        targetName: file.fileName,
      });
    }
    if (req.body.folderId !== undefined) {
      file = await moveFile(req.params.id, req.body.folderId);
      await writeAudit(req, 'file.move', {
        folderId: file.folderId,
        targetFolderId: file.folderId,
        targetType: 'file',
        targetId: file.id,
        targetName: file.fileName,
      });
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
    const file = await deleteFile(req.params.id);
    await writeAudit(req, 'file.delete', {
      folderId: file.folderId,
      targetType: 'file',
      targetId: file.id,
      targetName: file.fileName,
    });
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
    await writeAudit(req, 'release.set', {
      targetType: 'file',
      targetId: fileId,
      targetName: version,
    });
    res.json({ success: true, versionInfo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/release */
router.delete('/api/release', requireAuth, async (req, res, next) => {
  try {
    await clearRelease();
    await writeAudit(req, 'release.clear', { targetType: 'release' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
