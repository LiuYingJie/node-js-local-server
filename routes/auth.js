const express = require('express');
const { loadConfig } = require('../lib/config');
const { currentUser, isAdmin } = require('../middleware/auth');
const { authenticateUser } = require('../lib/userService');
const { writeAudit } = require('../lib/auditService');

const router = express.Router();

router.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.render('login', { error: null, redirect: req.query.redirect || '/' });
});

router.post('/login', express.urlencoded({ extended: false }), async (req, res, next) => {
  const config = loadConfig();
  const { username, password } = req.body;
  const redirect = req.body.redirect || '/';

  try {
    const user = await authenticateUser(username, password, config);
    if (user) {
      req.session.user = user;
      req.session.isAdmin = user.role === 'superadmin' || user.role === 'admin';
      await writeAudit(req, 'login.success', { targetType: 'user', targetId: user.id, targetName: user.username });
      return res.redirect(redirect);
    }
    await writeAudit(req, 'login.failed', { targetType: 'user', targetName: username });
    res.render('login', { error: '用户名或密码错误', redirect });
  } catch (err) {
    next(err);
  }
});

router.post('/api/login', express.json(), async (req, res, next) => {
  const config = loadConfig();
  const { username, password } = req.body;
  try {
    const user = await authenticateUser(username, password, config);
    if (user) {
      req.session.user = user;
      req.session.isAdmin = user.role === 'superadmin' || user.role === 'admin';
      await writeAudit(req, 'login.success', { targetType: 'user', targetId: user.id, targetName: user.username });
      return res.json({ success: true, isAdmin: req.session.isAdmin, user });
    }
    await writeAudit(req, 'login.failed', { targetType: 'user', targetName: username });
    res.status(401).json({ error: '用户名或密码错误' });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res) => {
  await writeAudit(req, 'logout', { targetType: 'user', targetId: req.session?.user?.id, targetName: req.session?.user?.username }).catch(() => {});
  req.session.destroy(() => res.redirect('/'));
});

router.post('/api/logout', async (req, res) => {
  await writeAudit(req, 'logout', { targetType: 'user', targetId: req.session?.user?.id, targetName: req.session?.user?.username }).catch(() => {});
  req.session.destroy(() => res.json({ success: true, isAdmin: false }));
});

module.exports = router;
