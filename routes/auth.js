const express = require('express');
const { loadConfig } = require('../lib/config');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (isAdmin(req)) return res.redirect('/');
  res.render('login', { error: null, redirect: req.query.redirect || '/' });
});

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const config = loadConfig();
  const { username, password } = req.body;
  const redirect = req.body.redirect || '/';

  if (username === config.username && password === config.password) {
    req.session.isAdmin = true;
    return res.redirect(redirect);
  }
  res.render('login', { error: '用户名或密码错误', redirect });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.post('/api/login', express.json(), (req, res) => {
  const config = loadConfig();
  const { username, password } = req.body;
  if (username === config.username && password === config.password) {
    req.session.isAdmin = true;
    return res.json({ success: true, isAdmin: true });
  }
  res.status(401).json({ error: '用户名或密码错误' });
});

router.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, isAdmin: false }));
});

module.exports = router;
