const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const { loadConfig } = require('../lib/config');
const { TEMP_DIR } = require('../lib/paths');
const { ensureDir } = require('../lib/fileUtils');
const { isAdmin, currentUser, requireAuth, requireLogin } = require('../middleware/auth');
const { writeAudit } = require('../lib/auditService');
const { listEntries } = require('../lib/entryService');
const { uploadFile, renameFile, moveFile, deleteFile, getFileById } = require('../lib/fileService');
const { createFolder, renameFolder, moveFolder, deleteFolder, normalizeFolderId, findFolderByPath, getFolderById } = require('../lib/folderService');
const { listAllFoldersFlat } = require('../lib/storagePath');
const { canAccessFolder, canViewFolder } = require('../lib/permissionService');

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
    if (!(await canAccessFolder(req, folderId, 'read'))) {
      return res.status(403).json({ error: '没有访问权限' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const data = await listEntries(folderId, baseUrl, { canViewFolder: (id) => canViewFolder(req, id) });
    const canWrite = await canAccessFolder(req, folderId, 'update');
    res.json({
      ...data,
      isAdmin: isAdmin(req),
      user: currentUser(req),
      canWrite,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/upload - 上传（需登录且有写入权限） */
router.post('/api/upload', requireLogin, (req, res, next) => {
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
    if (!(await canAccessFolder(req, folderId, 'create'))) {
      return res.status(403).json({ error: '没有上传权限' });
    }

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
router.get('/api/folders/all', requireLogin, async (req, res, next) => {
  try {
    const folders = await listAllFoldersFlat();
    const visible = [];
    for (const folder of folders) {
      if (await canAccessFolder(req, folder.id, 'update')) visible.push(folder);
    }
    res.json(visible);
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
    if (folder && !(await canAccessFolder(req, folder.id, 'read'))) {
      return res.status(404).json({ error: '目录不存在' });
    }
    res.json({ folderId: folder ? folder.id : null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/move - 批量移动 */
router.post('/api/move', requireLogin, express.json(), async (req, res, next) => {
  try {
    const { targetFolderId, items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: '请选择要移动的项目' });
    }
    const targetId = normalizeFolderId(targetFolderId);
    if (!(await canAccessFolder(req, targetId, 'create'))) {
      return res.status(403).json({ error: '没有目标目录写入权限' });
    }
    const moved = [];
    for (const item of items) {
      if (item.type === 'file') {
        const sourceFile = await getFileById(item.id);
        if (!sourceFile) throw new Error('文件不存在');
        if (!(await canAccessFolder(req, sourceFile.folderId ?? null, 'update'))) {
          throw new Error('没有移动权限');
        }
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
        if (!(await canAccessFolder(req, item.id, 'update'))) {
          throw new Error('没有移动权限');
        }
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
router.post('/api/folders', requireLogin, express.json(), async (req, res, next) => {
  try {
    const isPrivate = Boolean(req.body.private);
    const parentId = normalizeFolderId(req.body.parentId);
    if (!isPrivate && !isAdmin(req)) {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    if (isPrivate) {
      if (!(await canAccessFolder(req, parentId, 'read'))) {
        return res.status(403).json({ error: '没有权限在此位置创建私人文件夹' });
      }
    } else if (!(await canAccessFolder(req, parentId, 'create'))) {
      return res.status(403).json({ error: '没有权限在此位置创建文件夹' });
    }
    const options = {};
    if (isPrivate) {
      const user = currentUser(req);
      if (!user?.id) return res.status(401).json({ error: '请先登录' });
      options.private = true;
      options.ownerId = user.id;
    }
    const folder = await createFolder(req.body.name, parentId, options);
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
router.patch('/api/folders/:id', requireLogin, express.json(), async (req, res, next) => {
  try {
    if (!(await canAccessFolder(req, req.params.id, 'update'))) {
      return res.status(403).json({ error: '没有权限' });
    }
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
      const targetId = normalizeFolderId(req.body.parentId);
      if (!(await canAccessFolder(req, targetId, 'create'))) {
        return res.status(403).json({ error: '没有目标目录写入权限' });
      }
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
router.delete('/api/folders/:id', requireLogin, async (req, res, next) => {
  try {
    const folder = await getFolderById(req.params.id);
    if (!folder) return res.status(404).json({ error: '文件夹不存在' });
    if (!(await canAccessFolder(req, req.params.id, 'delete'))) {
      return res.status(403).json({ error: '没有权限' });
    }
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
router.patch('/api/files/:id', requireLogin, express.json(), async (req, res, next) => {
  try {
    const existing = await getFileById(req.params.id);
    if (!existing) return res.status(404).json({ error: '文件不存在' });
    if (!(await canAccessFolder(req, existing.folderId ?? null, 'update'))) {
      return res.status(403).json({ error: '没有权限' });
    }
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
      const targetId = normalizeFolderId(req.body.folderId);
      if (!(await canAccessFolder(req, targetId, 'create'))) {
        return res.status(403).json({ error: '没有目标目录写入权限' });
      }
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
router.delete('/api/files/:id', requireLogin, async (req, res, next) => {
  try {
    const existing = await getFileById(req.params.id);
    if (!existing) return res.status(404).json({ error: '文件不存在' });
    if (!(await canAccessFolder(req, existing.folderId ?? null, 'delete'))) {
      return res.status(403).json({ error: '没有权限' });
    }
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

module.exports = router;
