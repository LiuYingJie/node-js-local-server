(function () {
  const currentUser = window.ADMIN_CONFIG?.currentUser || {};
  const els = {
    usersBody: document.getElementById('users-body'),
    btnNewUser: document.getElementById('btn-new-user'),
    btnGenerateUser: document.getElementById('btn-generate-user'),
    userModal: document.getElementById('user-modal'),
    userForm: document.getElementById('user-form'),
    userId: document.getElementById('user-id'),
    username: document.getElementById('user-username'),
    password: document.getElementById('user-password'),
    passwordHint: document.getElementById('password-hint'),
    remark: document.getElementById('user-remark'),
    role: document.getElementById('user-role'),
    enabled: document.getElementById('user-enabled'),
    title: document.getElementById('user-modal-title'),
    permissionList: document.getElementById('permission-list'),
    btnAddPermission: document.getElementById('btn-add-permission'),
    auditFilters: document.getElementById('audit-filters'),
    auditList: document.getElementById('audit-list'),
    filterUsername: document.getElementById('filter-username'),
    filterFolder: document.getElementById('filter-folder'),
    filterFrom: document.getElementById('filter-from'),
    filterTo: document.getElementById('filter-to'),
    btnRefreshLogs: document.getElementById('btn-refresh-logs'),
  };

  const ACTION_LABELS = { create: '增', delete: '删', update: '改', read: '查' };
  const ACTION_OPTIONS = [
    ['read'],
    ['create'],
    ['delete'],
    ['update'],
    ['create', 'read'],
    ['delete', 'read'],
    ['update', 'read'],
    ['create', 'delete'],
    ['create', 'update'],
    ['delete', 'update'],
    ['create', 'delete', 'read'],
    ['create', 'update', 'read'],
    ['delete', 'update', 'read'],
    ['create', 'delete', 'update'],
    ['create', 'delete', 'update', 'read'],
  ];

  let users = [];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  function roleText(role) {
    if (role === 'superadmin') return '超管';
    if (role === 'admin') return '管理员';
    return '普通用户';
  }

  function actionText(actions) {
    return (actions || []).map((action) => ACTION_LABELS[action]).filter(Boolean).join('');
  }

  function actionValue(actions) {
    return (actions || []).join(',');
  }

  function canEdit(user) {
    if (user.role === 'superadmin') return false;
    if (currentUser.role === 'superadmin') return true;
    return user.role !== 'admin';
  }

  function renderPermissionSummary(user) {
    if (user.role === 'superadmin') return '<span class="permission-pill">全部</span>';
    if (user.role === 'admin') return '<span class="permission-pill">管理员默认</span>';
    const permissions = user.permissions || [];
    if (!permissions.length) return '<span class="text-muted">未配置</span>';
    return `<div class="permission-summary">${permissions.slice(0, 3).map((perm) => (
      `<span class="permission-pill">${escapeHtml(perm.path)} · ${escapeHtml(actionText(perm.actions))}</span>`
    )).join('')}${permissions.length > 3 ? `<span class="permission-pill">+${permissions.length - 3}</span>` : ''}</div>`;
  }

  function renderUsers() {
    els.usersBody.innerHTML = users.map((user) => `
      <tr>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.remark || '')}</td>
        <td><span class="role-badge ${escapeHtml(user.role)}">${roleText(user.role)}</span></td>
        <td><span class="state-badge ${user.enabled === false ? 'disabled' : 'enabled'}">${user.enabled === false ? '停用' : '启用'}</span></td>
        <td>${renderPermissionSummary(user)}</td>
        <td>${escapeHtml(user.updateTime || user.createTime || '')}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${user.id}" ${canEdit(user) ? '' : 'disabled'}>编辑</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="${user.id}" ${canEdit(user) ? '' : 'disabled'}>删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function loadUsers() {
    const data = await api('/admin/api/users');
    users = data.users;
    renderUsers();
  }

  function randomSecret(len = 24) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => chars[b % chars.length]).join('');
  }

  function randomAccessKey() {
    return 'ak_' + randomSecret(16);
  }

  function openUserModal(user = null, generated = false) {
    els.userId.value = user?.id || '';
    els.username.value = user?.username || '';
    els.password.value = '';
    els.remark.value = user?.remark || '';
    els.role.value = user?.role === 'admin' ? 'admin' : 'user';
    els.enabled.checked = user?.enabled !== false;
    els.title.textContent = user ? '编辑用户' : '新建用户';
    els.password.required = !user;
    els.passwordHint.textContent = user ? '留空则不修改' : '至少 6 位';
    els.role.disabled = currentUser.role !== 'superadmin';
    renderPermissionRows(user?.permissions || []);

    if (generated) {
      els.username.value = randomAccessKey();
      els.password.value = randomSecret(32);
      els.remark.value = '快速生成用户';
      renderPermissionRows([{ path: '/', actions: ['read'], recursive: true }]);
      els.passwordHint.textContent = '已生成，请保存后交给使用者';
    }

    els.userModal.style.display = 'flex';
    els.username.focus();
    els.username.select();
  }

  function permissionOptionsHtml(selectedActions) {
    const selected = actionValue(selectedActions);
    return ACTION_OPTIONS.map((actions) => {
      const value = actionValue(actions);
      return `<option value="${value}" ${value === selected ? 'selected' : ''}>${actionText(actions)}</option>`;
    }).join('');
  }

  function renderPermissionRows(permissions) {
    const rows = permissions.length ? permissions : [];
    els.permissionList.innerHTML = rows.map((perm) => permissionRowHtml(perm)).join('');
  }

  function permissionRowHtml(perm = { path: '/', actions: ['read'] }) {
    return `<div class="permission-row">
      <input type="text" class="permission-path" value="${escapeHtml(perm.path || '/')}" placeholder="/111/2222">
      <select class="permission-actions">${permissionOptionsHtml(perm.actions || ['read'])}</select>
      <button type="button" class="btn btn-danger btn-sm" data-action="remove-permission">删除</button>
    </div>`;
  }

  function collectPermissions() {
    return Array.from(els.permissionList.querySelectorAll('.permission-row')).map((row) => {
      const path = row.querySelector('.permission-path').value.trim();
      const actions = row.querySelector('.permission-actions').value.split(',').filter(Boolean);
      return { path, actions, recursive: true };
    }).filter((item) => item.path && item.actions.length);
  }

  async function saveUser(e) {
    e.preventDefault();
    const id = els.userId.value;
    const payload = {
      username: els.username.value.trim(),
      role: els.role.value,
      enabled: els.enabled.checked,
      remark: els.remark.value.trim(),
      permissions: collectPermissions(),
    };
    if (els.password.value) payload.password = els.password.value;

    try {
      if (id) {
        await api('/admin/api/users/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        payload.password = els.password.value;
        await api('/admin/api/users', { method: 'POST', body: JSON.stringify(payload) });
      }
      els.userModal.style.display = 'none';
      await loadUsers();
      await loadLogs();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteUser(id) {
    const user = users.find((u) => u.id === id);
    if (!user || !confirm(`确定删除用户 ${user.username}？`)) return;
    try {
      await api('/admin/api/users/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadUsers();
      await loadLogs();
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadFolders() {
    const data = await api('/admin/api/folders');
    els.filterFolder.innerHTML = '<option value="">全部文件夹</option>' + data.folders.map((folder) => (
      `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.path)}</option>`
    )).join('');
  }

  async function loadLogs() {
    const params = new URLSearchParams();
    if (els.filterUsername.value.trim()) params.set('username', els.filterUsername.value.trim());
    if (els.filterFolder.value) params.set('folderId', els.filterFolder.value);
    if (els.filterFrom.value) params.set('from', els.filterFrom.value);
    if (els.filterTo.value) params.set('to', els.filterTo.value);
    const data = await api('/admin/api/audit?' + params.toString());
    els.auditList.innerHTML = data.logs.length ? data.logs.map(renderLog).join('') : '<div class="text-muted">暂无日志</div>';
  }

  function renderLog(log) {
    const actor = log.actor?.username || 'unknown';
    const target = log.targetName || log.targetId || '';
    const folder = log.folderId ? ` · 文件夹 ${log.folderId}` : '';
    return `<div class="audit-item">
      <div class="audit-line">
        <span class="audit-action">${escapeHtml(log.action)}</span>
        <span class="audit-time">${escapeHtml(log.time)}</span>
      </div>
      <div class="audit-detail">
        账号: ${escapeHtml(actor)} · 目标: ${escapeHtml(target || '-')} ${escapeHtml(folder)}
      </div>
    </div>`;
  }

  document.querySelectorAll('.admin-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-item').forEach((item) => item.classList.toggle('active', item === btn));
      document.querySelectorAll('.admin-tab').forEach((tab) => tab.classList.toggle('active', tab.id === 'tab-' + btn.dataset.tab));
    });
  });

  els.btnNewUser.addEventListener('click', () => openUserModal());
  els.btnGenerateUser.addEventListener('click', () => openUserModal(null, true));
  els.btnAddPermission.addEventListener('click', () => {
    els.permissionList.insertAdjacentHTML('beforeend', permissionRowHtml());
  });
  els.permissionList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-permission"]');
    if (btn) btn.closest('.permission-row').remove();
  });
  els.userForm.addEventListener('submit', saveUser);
  els.usersBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const user = users.find((item) => item.id === btn.dataset.id);
    if (btn.dataset.action === 'edit') openUserModal(user);
    if (btn.dataset.action === 'delete') deleteUser(btn.dataset.id);
  });
  els.auditFilters.addEventListener('submit', (e) => {
    e.preventDefault();
    loadLogs().catch((err) => alert(err.message));
  });
  els.btnRefreshLogs.addEventListener('click', () => loadLogs().catch((err) => alert(err.message)));
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none');
  });

  Promise.all([loadUsers(), loadFolders(), loadLogs()]).catch((err) => alert(err.message));
})();
