/** 是否已登录管理员 */
function isAdmin(req) {
  return Boolean(req.session?.isAdmin);
}

/** 登录校验中间件 */
function requireAuth(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  return res.redirect('/login');
}

module.exports = { isAdmin, requireAuth };
