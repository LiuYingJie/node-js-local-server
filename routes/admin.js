const express = require('express');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  if (isAdmin(req)) return res.redirect('/');
  res.redirect('/login');
});

module.exports = router;
