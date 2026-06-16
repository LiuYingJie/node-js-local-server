const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { ensureDir } = require('./lib/fileUtils');
const { STORAGE_DIR, FILES_DIR, TEMP_DIR } = require('./lib/paths');
const { migrateLegacyData } = require('./lib/fileService');
const { ensureDefaultSuperAdmin } = require('./lib/userService');

const indexRouter = require('./routes/index');
const apiRouter = require('./routes/api');
const filesRouter = require('./routes/files');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');

async function bootstrap() {
  const config = loadConfig();

  await ensureDir(STORAGE_DIR);
  await ensureDir(FILES_DIR);
  await ensureDir(TEMP_DIR);
  await ensureDir(path.join(__dirname, 'data'));
  await ensureDefaultSuperAdmin(config);

  // 迁移旧版数据
  await migrateLegacyData();

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: config.sessionSecret || 'local-file-server-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
    })
  );

  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/', indexRouter);
  app.use('/', authRouter);
  app.use('/', filesRouter);
  app.use('/', apiRouter);
  app.use('/admin', adminRouter);

  // 404：页面请求返回 HTML，API 返回 JSON
  app.use((req, res) => {
    if (req.headers.accept?.includes('text/html')) {
      return res.status(404).send('页面不存在');
    }
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err, req, res, next) => {
    console.error('[Error]', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message || '服务器内部错误' });
    }
    res.status(500).send(`服务器错误: ${err.message}`);
  });

  const host = '0.0.0.0';
  const port = config.port || 3000;

  app.listen(port, host, () => {
    console.log('========================================');
    console.log('  局域网文件管理服务器已启动');
    console.log(`  本机访问:   http://127.0.0.1:${port}`);
    console.log(`  局域网访问: http://<本机IP>:${port}`);
    console.log(`  文件管理:   http://127.0.0.1:${port}`);
    console.log(`  登录入口:   http://127.0.0.1:${port}/login`);
    console.log('========================================');
  });
}

bootstrap().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
