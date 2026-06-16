/** 是否已登录管理员 */
function isAdmin(req) {
  return Boolean(req.session?.user?.role === 'superadmin' || req.session?.user?.role === 'admin' || req.session?.isAdmin);
}

function isSuperAdmin(req) {
  return req.session?.user?.role === 'superadmin' || (req.session?.isAdmin && !req.session?.user);
}

function currentUser(req) {
  if (req.session?.user) return req.session.user;
  if (req.session?.isAdmin) return { id: 'config-admin', username: 'admin', role: 'superadmin' };
  return null;
}

/** 登录校验中间件 */
function requireAuth(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  return res.redirect('/login');
}

function requireLogin(req, res, next) {
  if (currentUser(req)) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  return res.redirect('/login');
}

function requireSuperAdmin(req, res, next) {
  if (isSuperAdmin(req)) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: '需要超管权限' });
  }
  return res.status(403).send('需要超管权限');
}

module.exports = { isAdmin, isSuperAdmin, currentUser, requireLogin, requireAuth, requireSuperAdmin };
