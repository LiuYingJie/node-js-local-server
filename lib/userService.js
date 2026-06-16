const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { USERS_JSON } = require('./paths');
const { ensureDir, formatDateTime } = require('./fileUtils');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith('pbkdf2$')) return false;
  const [, iterText, salt, hash] = storedHash.split('$');
  const iter = Number(iterText);
  const test = crypto.pbkdf2Sync(String(password), salt, iter, 32, 'sha256');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
}

async function readUsersJson() {
  try {
    const raw = await fs.readFile(USERS_JSON, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveUsersJson(list) {
  await ensureDir(path.dirname(USERS_JSON));
  await fs.writeFile(USERS_JSON, JSON.stringify(list, null, 2), 'utf-8');
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

function normalizeRemark(remark) {
  return String(remark || '').trim().slice(0, 200);
}

function normalizePermissionPath(inputPath) {
  const value = String(inputPath || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!value || value === '/') return '/';
  return '/' + value.replace(/^\/+|\/+$/g, '');
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  const allowed = new Set(['create', 'delete', 'update', 'read']);
  return permissions.map((item) => {
    const actions = Array.isArray(item.actions) ? item.actions.filter((action) => allowed.has(action)) : [];
    return {
      path: normalizePermissionPath(item.path),
      actions: [...new Set(actions)],
      recursive: true,
    };
  }).filter((item) => item.actions.length > 0);
}

async function ensureDefaultSuperAdmin(config) {
  const list = await readUsersJson();
  const username = config.username || 'admin';
  let admin = list.find((u) => u.username === username);
  if (!admin) {
    admin = {
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(config.password || '123456'),
      role: 'superadmin',
      enabled: true,
      remark: '系统超管',
      permissions: [],
      createTime: formatDateTime(),
      updateTime: formatDateTime(),
    };
    list.push(admin);
  } else {
    admin.role = 'superadmin';
    admin.enabled = true;
    if (admin.remark == null) admin.remark = '系统超管';
    if (!admin.passwordHash) admin.passwordHash = hashPassword(config.password || '123456');
    admin.updateTime = formatDateTime();
  }
  await saveUsersJson(list);
  return admin;
}

async function authenticateUser(username, password, config) {
  await ensureDefaultSuperAdmin(config);
  const list = await readUsersJson();
  const user = list.find((u) => u.username === username && u.enabled !== false);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return publicUser(user);
}

async function getUserById(id) {
  const list = await readUsersJson();
  return publicUser(list.find((u) => u.id === id));
}

async function listUsers() {
  const list = await readUsersJson();
  return list.map(publicUser).sort((a, b) => a.username.localeCompare(b.username, 'zh-CN'));
}

function assertCanManage(actor, targetRole) {
  if (actor?.role === 'superadmin') return;
  if (targetRole === 'admin' || targetRole === 'superadmin') {
    throw new Error('只有超管可以管理管理员账号');
  }
  if (actor?.role !== 'admin') throw new Error('没有权限');
}

async function createUser(actor, input) {
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  const role = normalizeRole(input.role);
  assertCanManage(actor, role);
  if (!/^[\w.@\-\u4e00-\u9fa5]{2,40}$/.test(username)) throw new Error('用户名格式无效');
  if (password.length < 6) throw new Error('密码至少 6 位');

  const list = await readUsersJson();
  if (list.some((u) => u.username === username)) throw new Error('用户名已存在');
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    role,
    enabled: input.enabled !== false,
    remark: normalizeRemark(input.remark),
    permissions: normalizePermissions(input.permissions),
    createTime: formatDateTime(),
    updateTime: formatDateTime(),
  };
  list.push(user);
  await saveUsersJson(list);
  return publicUser(user);
}

async function updateUser(actor, id, input) {
  const list = await readUsersJson();
  const user = list.find((u) => u.id === id);
  if (!user) throw new Error('用户不存在');
  if (user.role === 'superadmin') throw new Error('不能修改超管账号');

  const nextRole = input.role != null ? normalizeRole(input.role) : user.role;
  assertCanManage(actor, nextRole);

  if (input.username != null) {
    const username = String(input.username).trim();
    if (!/^[\w.@\-\u4e00-\u9fa5]{2,40}$/.test(username)) throw new Error('用户名格式无效');
    if (list.some((u) => u.id !== id && u.username === username)) throw new Error('用户名已存在');
    user.username = username;
  }
  if (input.password) {
    if (String(input.password).length < 6) throw new Error('密码至少 6 位');
    user.passwordHash = hashPassword(input.password);
  }
  if (input.role != null) user.role = nextRole;
  if (input.enabled != null) user.enabled = Boolean(input.enabled);
  if (input.remark != null) user.remark = normalizeRemark(input.remark);
  if (Array.isArray(input.permissions)) user.permissions = normalizePermissions(input.permissions);
  user.updateTime = formatDateTime();
  await saveUsersJson(list);
  return publicUser(user);
}

async function deleteUser(actor, id) {
  const list = await readUsersJson();
  const index = list.findIndex((u) => u.id === id);
  if (index === -1) throw new Error('用户不存在');
  const user = list[index];
  if (user.role === 'superadmin') throw new Error('不能删除超管账号');
  assertCanManage(actor, user.role);
  list.splice(index, 1);
  await saveUsersJson(list);
  return publicUser(user);
}

module.exports = {
  ensureDefaultSuperAdmin,
  authenticateUser,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};
