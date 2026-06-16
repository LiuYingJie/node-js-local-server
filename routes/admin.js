const express = require('express');
const { isAdmin, currentUser, requireAuth } = require('../middleware/auth');
const { listUsers, createUser, updateUser, deleteUser } = require('../lib/userService');
const { readAuditLog, writeAudit } = require('../lib/auditService');
const { listAllFoldersFlat } = require('../lib/storagePath');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.render('admin', { user: currentUser(req) });
});

router.get('/api/users', requireAuth, async (req, res, next) => {
  try {
    res.json({ users: await listUsers(), currentUser: currentUser(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/api/users', requireAuth, express.json(), async (req, res) => {
  try {
    const user = await createUser(currentUser(req), req.body);
    await writeAudit(req, 'user.create', {
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      role: user.role,
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/users/:id', requireAuth, express.json(), async (req, res) => {
  try {
    const user = await updateUser(currentUser(req), req.params.id, req.body);
    await writeAudit(req, 'user.update', {
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      role: user.role,
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const user = await deleteUser(currentUser(req), req.params.id);
    await writeAudit(req, 'user.delete', {
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      role: user.role,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/audit', requireAuth, async (req, res, next) => {
  try {
    const logs = await readAuditLog(req.query);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

router.get('/api/folders', requireAuth, async (req, res, next) => {
  try {
    res.json({ folders: await listAllFoldersFlat() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
