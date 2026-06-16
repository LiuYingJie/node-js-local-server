const express = require('express');
const { loadConfig } = require('../lib/config');

const router = express.Router();

router.get('/', (req, res) => {
  const config = loadConfig();
  res.render('explorer', { maxUploadSizeMB: config.maxUploadSizeMB || 2048 });
});

module.exports = router;
