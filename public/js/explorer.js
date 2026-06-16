/**
 * 文件夹式文件管理器
 */
(function () {
  const state = {
    folderId: null,
    folders: [],
    files: [],
    breadcrumb: [],
    selected: new Set(), // "folder:id" | "file:id"
    viewMode: localStorage.getItem('viewMode') || 'grid',
    isAdmin: false,
    navHistory: [null],
    navIndex: 0,
    lastClickedIndex: -1,
    filtered: null,
    user: null,
  };

  const els = {
    container: document.getElementById('entry-container'),
    breadcrumb: document.getElementById('breadcrumb'),
    pathForm: document.getElementById('path-form'),
    pathInput: document.getElementById('path-input'),
    emptyHint: document.getElementById('empty-hint'),
    statusText: document.getElementById('status-text'),
    selectionInfo: document.getElementById('selection-info'),
    contextMenu: document.getElementById('context-menu'),
    selectionBox: document.getElementById('selection-box'),
    dropOverlay: document.getElementById('drop-overlay'),
    userBadge: document.getElementById('user-badge'),
    btnLogin: document.getElementById('btn-login'),
    btnLogout: document.getElementById('btn-logout'),
    btnBack: document.getElementById('btn-back'),
    btnUp: document.getElementById('btn-up'),
    btnNewFolder: document.getElementById('btn-new-folder'),
    searchInput: document.getElementById('search-input'),
    loginModal: document.getElementById('login-modal'),
    renameModal: document.getElementById('rename-modal'),
    releaseModal: document.getElementById('release-modal'),
    moveModal: document.getElementById('move-modal'),
    folderPicker: document.getElementById('folder-picker'),
  };

  const FILE_ICONS = {
    zip: '📦', rar: '📦', '7z': '📦',
    exe: '⚙️', dll: '🔧', msi: '⚙️',
    json: '📋', txt: '📄', ini: '📋', yaml: '📋', yml: '📋', xml: '📋',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    mp4: '🎬', mp3: '🎵', wav: '🎵',
    js: '📜', ts: '📜', html: '🌐', css: '🎨',
  };

  function formatSize(bytes) {
    if (bytes == null) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function getExt(name) {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function getIcon(entry) {
    if (entry.type === 'folder') return '📁';
    return FILE_ICONS[getExt(entry.name)] || '📄';
  }

  function isPreviewable(entry) {
    return entry?.type === 'file' && ['txt', 'json'].includes(getExt(entry.name));
  }

  function keyOf(entry) {
    return entry.type + ':' + entry.id;
  }

  function parseKey(key) {
    const [type, id] = key.split(':');
    return { type, id };
  }

  function getAllEntries() {
    const folders = (state.filtered?.folders ?? state.folders).map((f) => ({ ...f, type: 'folder' }));
    const files = (state.filtered?.files ?? state.files).map((f) => ({ ...f, type: 'file' }));
    return [...folders, ...files];
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function updateSelectionInfo() {
    const n = state.selected.size;
    els.selectionInfo.textContent = n ? `已选 ${n} 项` : '';
  }

  function updateEntrySelectionClasses() {
    els.container.querySelectorAll('.entry-item').forEach((item) => {
      item.classList.toggle('selected', state.selected.has(item.dataset.key));
    });
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function applyAdminUI() {
    const loggedIn = Boolean(state.user);
    document.body.classList.toggle('is-admin', state.isAdmin);
    els.userBadge.textContent = state.isAdmin ? '管理员' : '访客';
    if (state.user) {
      const roleText = state.user.role === 'superadmin' ? '超管' : (state.user.role === 'admin' ? '管理员' : '用户');
      els.userBadge.textContent = `${state.user.username} · ${roleText}`;
    }
    els.userBadge.classList.toggle('admin', state.isAdmin);
    els.btnLogin.style.display = loggedIn ? 'none' : 'inline-block';
    els.btnLogout.style.display = loggedIn ? 'inline-block' : 'none';
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  async function loadSession() {
    const data = await api('/api/session');
    state.isAdmin = data.isAdmin;
    state.user = data.user || null;
    applyAdminUI();
  }

  async function loadEntries(folderId) {
    const q = folderId ? '?folderId=' + encodeURIComponent(folderId) : '';
    const data = await api('/api/entries' + q);
    state.folderId = data.folderId;
    state.folders = data.folders;
    state.files = data.files;
    state.breadcrumb = data.breadcrumb;
    state.isAdmin = data.isAdmin;
    state.user = data.user || state.user;
    state.filtered = null;
    state.selected.clear();
    state.lastClickedIndex = -1;
    els.searchInput.value = '';
    applyAdminUI();
    render();
    setStatus(`${state.folders.length + state.files.length} 项`);
    els.btnUp.disabled = !state.folderId;
  }

  function navigate(folderId, pushHistory = true) {
    if (pushHistory) {
      state.navHistory = state.navHistory.slice(0, state.navIndex + 1);
      state.navHistory.push(folderId);
      state.navIndex = state.navHistory.length - 1;
    }
    els.btnBack.disabled = state.navIndex <= 0;
    loadEntries(folderId);
  }

  function renderBreadcrumb() {
    els.breadcrumb.innerHTML = state.breadcrumb.map((crumb, i) => {
      const sep = i > 0 ? '<span class="breadcrumb-sep">/</span>' : '';
      return sep + `<span class="breadcrumb-item" data-folder-id="${crumb.id ?? ''}">${escapeHtml(crumb.name)}</span>`;
    }).join('');

    els.breadcrumb.querySelectorAll('.breadcrumb-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.folderId || null;
        navigate(id);
      });
    });
  }

  function getCurrentPathText() {
    const parts = state.breadcrumb.slice(1).map((crumb) => crumb.name);
    return parts.length ? parts.join('/') : '/';
  }

  function showPathInput() {
    els.pathInput.value = getCurrentPathText();
    els.breadcrumb.style.display = 'none';
    els.pathForm.style.display = 'block';
    els.pathInput.focus();
    els.pathInput.select();
  }

  function hidePathInput() {
    els.pathForm.style.display = 'none';
    els.breadcrumb.style.display = 'flex';
  }

  async function navigateByPath(pathText) {
    try {
      const data = await api('/api/folders/resolve?path=' + encodeURIComponent(pathText));
      hidePathInput();
      navigate(data.folderId);
    } catch (err) {
      setStatus(err.message);
      els.pathInput.focus();
      els.pathInput.select();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    renderBreadcrumb();
    hidePathInput();
    els.container.className = 'entry-grid' + (state.viewMode === 'list' ? ' view-list' : '');
    document.querySelectorAll('.view-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === state.viewMode);
    });

    const entries = getAllEntries();
    els.emptyHint.style.display = entries.length ? 'none' : 'block';

    els.container.innerHTML = entries.map((entry, index) => {
      const k = keyOf(entry);
      const selected = state.selected.has(k) ? ' selected' : '';
      const meta = entry.type === 'file'
        ? `<div class="entry-meta"><span>${formatSize(entry.size)}</span><span>${entry.uploadTime || ''}</span></div>`
        : `<div class="entry-meta"><span>文件夹</span><span>${entry.createTime || ''}</span></div>`;

      return `<div class="entry-item${selected}" data-key="${k}" data-index="${index}" data-type="${entry.type}" data-id="${entry.id}">
        <div class="entry-icon">${getIcon(entry)}</div>
        <div class="entry-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</div>
        ${meta}
      </div>`;
    }).join('');

    bindEntryEvents();
    updateSelectionInfo();
  }

  function bindEntryEvents() {
    els.container.querySelectorAll('.entry-item').forEach((el) => {
      el.addEventListener('click', (e) => onEntryClick(e, el));
      el.addEventListener('dblclick', () => onEntryDblClick(el));
      el.addEventListener('contextmenu', (e) => onContextMenu(e, el));
    });
  }

  function onEntryClick(e, el) {
    const key = el.dataset.key;
    const index = parseInt(el.dataset.index, 10);
    const entries = getAllEntries();

    if (e.ctrlKey || e.metaKey) {
      if (state.selected.has(key)) state.selected.delete(key);
      else state.selected.add(key);
    } else if (e.shiftKey && state.lastClickedIndex >= 0) {
      const from = Math.min(state.lastClickedIndex, index);
      const to = Math.max(state.lastClickedIndex, index);
      if (!e.ctrlKey) state.selected.clear();
      for (let i = from; i <= to; i++) {
        state.selected.add(keyOf(entries[i]));
      }
    } else {
      state.selected.clear();
      state.selected.add(key);
    }

    state.lastClickedIndex = index;
    render();
  }

  function onEntryDblClick(el) {
    if (el.dataset.type === 'folder') {
      navigate(el.dataset.id);
    } else {
      const entry = getSelectedEntries()[0] || getAllEntries().find((item) => item.type === 'file' && item.id === el.dataset.id);
      if (isPreviewable(entry)) openPreview(el.dataset.id);
      else downloadFile(el.dataset.id);
    }
  }

  function openPreview(id) {
    window.open('/preview/' + id, '_blank');
  }

  function downloadFile(id) {
    window.open('/download/' + id, '_blank');
  }

  function downloadSelected() {
    state.selected.forEach((key) => {
      const { type, id } = parseKey(key);
      if (type === 'file') downloadFile(id);
    });
  }

  function getSelectedEntries() {
    const entries = getAllEntries();
    return [...state.selected].map((key) => {
      const { type, id } = parseKey(key);
      return entries.find((e) => e.type === type && e.id === id);
    }).filter(Boolean);
  }

  function hideContextMenu() {
    els.contextMenu.style.display = 'none';
  }

  function onContextMenu(e, el) {
    e.preventDefault();
    const key = el.dataset.key;
    if (!state.selected.has(key)) {
      state.selected.clear();
      state.selected.add(key);
      render();
    }

    const selected = getSelectedEntries();
    const single = selected.length === 1 ? selected[0] : null;
    const hasFiles = selected.some((s) => s.type === 'file');
    const items = [];

    if (hasFiles) {
      items.push({ label: '下载', action: () => downloadSelected() });
    }
    if (single?.type === 'folder') {
      items.push({ label: '打开', action: () => navigate(single.id) });
    }
    if (isPreviewable(single)) {
      items.push({ label: '打开', action: () => openPreview(single.id) });
    }
    if (single?.type === 'file') {
      items.push({ label: '复制下载链接', action: () => {
        navigator.clipboard.writeText(location.origin + '/download/' + single.id);
        setStatus('链接已复制');
      }});
    }

    if (state.isAdmin) {
      if (items.length) items.push({ sep: true });
      if (selected.length === 1) {
        items.push({ label: '重命名', action: () => openRename(single) });
      }
      if (single?.type === 'file') {
        items.push({ label: '设为发布版本', action: () => openRelease(single) });
      }
      items.push({ label: '移动到...', action: () => openMoveModal(selected) });
      items.push({ label: '删除', action: () => deleteSelected(), danger: true });
    }

    showContextMenu(items, e.clientX, e.clientY);
  }

  function showContextMenu(items, clientX, clientY) {
    if (!items.length) return;

    els.contextMenu.innerHTML = items.map((item) => {
      if (item.sep) return '<div class="context-menu-sep"></div>';
      return `<div class="context-menu-item${item.danger ? ' danger' : ''}">${item.label}</div>`;
    }).join('');

    els.contextMenu.style.display = 'block';
    const menuItems = els.contextMenu.querySelectorAll('.context-menu-item');
    let idx = 0;
    items.forEach((item) => {
      if (item.sep) return;
      menuItems[idx++].addEventListener('click', () => { hideContextMenu(); item.action(); });
    });

    const x = Math.min(clientX, window.innerWidth - 180);
    const y = Math.min(clientY, window.innerHeight - items.length * 36);
    els.contextMenu.style.left = x + 'px';
    els.contextMenu.style.top = y + 'px';
  }

  function onBlankContextMenu(e) {
    if (e.target.closest('.entry-item')) return;
    e.preventDefault();
    state.selected.clear();
    render();
    if (!state.isAdmin) return;
    showContextMenu([
      { label: '创建文件夹', action: () => els.btnNewFolder.click() },
    ], e.clientX, e.clientY);
  }

  async function deleteSelected() {
    const selected = getSelectedEntries();
    if (!selected.length) return;
    if (!confirm(`确定删除 ${selected.length} 项？`)) return;

    for (const entry of selected) {
      try {
        if (entry.type === 'folder') await api('/api/folders/' + entry.id, { method: 'DELETE' });
        else await api('/api/files/' + entry.id, { method: 'DELETE' });
      } catch (err) {
        alert(entry.name + ': ' + err.message);
      }
    }
    state.selected.clear();
    loadEntries(state.folderId);
  }

  function openRename(entry) {
    document.getElementById('rename-id').value = entry.id;
    document.getElementById('rename-type').value = entry.type;
    document.getElementById('rename-value').value = entry.name;
    document.getElementById('rename-title').textContent = entry.type === 'folder' ? '重命名文件夹' : '重命名文件';
    els.renameModal.style.display = 'flex';
    document.getElementById('rename-value').focus();
    document.getElementById('rename-value').select();
  }

  function openRelease(entry) {
    document.getElementById('release-file-id').value = entry.id;
    document.getElementById('release-file-name').textContent = entry.name;
    document.getElementById('release-version').value = '';
    document.getElementById('release-desc').value = '';
    document.getElementById('release-force').checked = false;
    els.releaseModal.style.display = 'flex';
  }

  async function openMoveModal(entries) {
    if (!state.isAdmin || !entries.length) return;
    document.getElementById('move-hint').textContent = `移动 ${entries.length} 项`;
    els.folderPicker.innerHTML = '<div class="folder-picker-item disabled">加载中...</div>';
    els.moveModal.style.display = 'flex';

    try {
      const folders = await api('/api/folders/all');
      const selectedFolderIds = new Set(entries.filter((e) => e.type === 'folder').map((e) => e.id));
      const selectedFolderPaths = new Set(
        folders.filter((f) => selectedFolderIds.has(f.id)).map((f) => f.path)
      );

      const allTargets = [{ id: null, path: '根目录', name: '根目录' }, ...folders];
      els.folderPicker.innerHTML = allTargets.map((folder) => {
        const disabled = folder.id === state.folderId || isInvalidMoveTarget(folder, selectedFolderIds, selectedFolderPaths);
        return `<div class="folder-picker-item${disabled ? ' disabled' : ''}" data-folder-id="${folder.id ?? ''}">
          ${escapeHtml(folder.path || folder.name)}
        </div>`;
      }).join('');

      els.folderPicker.querySelectorAll('.folder-picker-item:not(.disabled)').forEach((item) => {
        item.addEventListener('click', async () => {
          const targetFolderId = item.dataset.folderId || null;
          await moveSelectedTo(targetFolderId);
        });
      });
    } catch (err) {
      els.folderPicker.innerHTML = `<div class="folder-picker-item disabled">${escapeHtml(err.message)}</div>`;
    }
  }

  function isInvalidMoveTarget(folder, selectedFolderIds, selectedFolderPaths) {
    if (!folder.id) return false;
    if (selectedFolderIds.has(folder.id)) return true;
    for (const selectedPath of selectedFolderPaths) {
      if (folder.path && selectedPath && folder.path.startsWith(selectedPath + '/')) return true;
    }
    return false;
  }

  async function moveSelectedTo(targetFolderId) {
    const selected = getSelectedEntries();
    if (!selected.length) return;
    try {
      await api('/api/move', {
        method: 'POST',
        body: JSON.stringify({
          targetFolderId,
          items: selected.map((entry) => ({ type: entry.type, id: entry.id })),
        }),
      });
      els.moveModal.style.display = 'none';
      state.selected.clear();
      loadEntries(state.folderId);
      setStatus(`已移动 ${selected.length} 项`);
    } catch (err) {
      alert(err.message);
    }
  }

  async function uploadFiles(fileList) {
    if (!state.isAdmin || !fileList.length) return;

    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    if (state.folderId) formData.append('folderId', state.folderId);

    const progressEl = document.createElement('div');
    progressEl.className = 'upload-progress';
    progressEl.innerHTML = `上传 0/${fileList.length}<div class="upload-progress-bar"><div class="upload-progress-bar-inner"></div></div>`;
    document.body.appendChild(progressEl);
    const bar = progressEl.querySelector('.upload-progress-bar-inner');

    let done = 0;
    for (const file of fileList) {
      const fd = new FormData();
      fd.append('files', file);
      if (state.folderId) fd.append('folderId', state.folderId);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.onload = () => {
          done++;
          progressEl.firstChild.textContent = `上传 ${done}/${fileList.length}`;
          bar.style.width = (done / fileList.length * 100) + '%';
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(JSON.parse(xhr.responseText).error || '上传失败'));
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(fd);
      }).catch((err) => alert(file.name + ': ' + err.message));
    }

    setTimeout(() => progressEl.remove(), 800);
    loadEntries(state.folderId);
    setStatus(`已上传 ${done} 个文件`);
  }

  // ---- 事件绑定 ----
  let dragSelect = null;

  document.addEventListener('click', (e) => {
    if (!els.contextMenu.contains(e.target)) hideContextMenu();
  });

  els.breadcrumb.addEventListener('click', (e) => {
    if (e.target.closest('.breadcrumb-item')) return;
    showPathInput();
  });

  els.breadcrumb.addEventListener('dblclick', showPathInput);

  els.pathForm.addEventListener('submit', (e) => {
    e.preventDefault();
    navigateByPath(els.pathInput.value);
  });

  els.pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hidePathInput();
    }
  });

  els.pathInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== els.pathInput) hidePathInput();
    }, 120);
  });

  document.getElementById('explorer-main').addEventListener('contextmenu', onBlankContextMenu);

  document.getElementById('explorer-main').addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.entry-item')) return;
    const main = e.currentTarget;
    const rect = main.getBoundingClientRect();
    dragSelect = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: e.clientX - rect.left + main.scrollLeft,
      startY: e.clientY - rect.top + main.scrollTop,
      active: false,
      additive: e.ctrlKey || e.metaKey,
      baseSelection: new Set(state.selected),
    };
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragSelect) return;
    const main = document.getElementById('explorer-main');
    const rect = main.getBoundingClientRect();
    const dx = Math.abs(e.clientX - dragSelect.startClientX);
    const dy = Math.abs(e.clientY - dragSelect.startClientY);
    if (!dragSelect.active && dx < 4 && dy < 4) return;

    dragSelect.active = true;
    const currentX = e.clientX - rect.left + main.scrollLeft;
    const currentY = e.clientY - rect.top + main.scrollTop;
    const left = Math.min(dragSelect.startX, currentX);
    const top = Math.min(dragSelect.startY, currentY);
    const width = Math.abs(currentX - dragSelect.startX);
    const height = Math.abs(currentY - dragSelect.startY);

    els.selectionBox.style.display = 'block';
    els.selectionBox.style.left = left + 'px';
    els.selectionBox.style.top = top + 'px';
    els.selectionBox.style.width = width + 'px';
    els.selectionBox.style.height = height + 'px';

    const selectRect = {
      left: Math.min(dragSelect.startClientX, e.clientX),
      right: Math.max(dragSelect.startClientX, e.clientX),
      top: Math.min(dragSelect.startClientY, e.clientY),
      bottom: Math.max(dragSelect.startClientY, e.clientY),
    };

    const next = dragSelect.additive ? new Set(dragSelect.baseSelection) : new Set();
    els.container.querySelectorAll('.entry-item').forEach((item) => {
      const itemRect = item.getBoundingClientRect();
      if (rectsOverlap(selectRect, itemRect)) next.add(item.dataset.key);
    });
    state.selected = next;
    updateEntrySelectionClasses();
    updateSelectionInfo();
  });

  document.addEventListener('mouseup', () => {
    if (!dragSelect) return;
    const wasActive = dragSelect.active;
    dragSelect = null;
    els.selectionBox.style.display = 'none';
    if (wasActive) {
      state.lastClickedIndex = -1;
      setTimeout(() => { state.suppressNextMainClick = false; }, 0);
      state.suppressNextMainClick = true;
    }
  });

  document.getElementById('explorer-main').addEventListener('click', (e) => {
    if (state.suppressNextMainClick) {
      state.suppressNextMainClick = false;
      return;
    }
    if (e.target.closest('.entry-item')) return;
    if (!e.ctrlKey && !e.metaKey) {
      state.selected.clear();
      updateEntrySelectionClasses();
      updateSelectionInfo();
    }
  });

  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      localStorage.setItem('viewMode', state.viewMode);
      render();
    });
  });

  els.btnBack.addEventListener('click', () => {
    if (state.navIndex > 0) {
      state.navIndex--;
      els.btnBack.disabled = state.navIndex <= 0;
      loadEntries(state.navHistory[state.navIndex]);
    }
  });

  els.btnUp.addEventListener('click', () => {
    const crumbs = state.breadcrumb;
    if (crumbs.length > 1) {
      navigate(crumbs[crumbs.length - 2].id ?? null);
    }
  });

  els.btnNewFolder.addEventListener('click', async () => {
    const name = prompt('文件夹名称');
    if (!name?.trim()) return;
    try {
      await api('/api/folders', { method: 'POST', body: JSON.stringify({ name: name.trim(), parentId: state.folderId }) });
      loadEntries(state.folderId);
    } catch (err) {
      alert(err.message);
    }
  });

  els.btnLogin.addEventListener('click', () => {
    els.loginModal.style.display = 'flex';
    document.getElementById('login-error').style.display = 'none';
  });

  document.getElementById('login-cancel').addEventListener('click', () => {
    els.loginModal.style.display = 'none';
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) });
      els.loginModal.style.display = 'none';
      state.isAdmin = data.isAdmin;
      state.user = data.user || null;
      applyAdminUI();
      loadEntries(state.folderId);
      setStatus('已登录');
    } catch (err) {
      const errEl = document.getElementById('login-error');
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  els.btnLogout.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.isAdmin = false;
    state.user = null;
    applyAdminUI();
    setStatus('已退出');
  });

  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none');
  });

  document.getElementById('rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('rename-id').value;
    const type = document.getElementById('rename-type').value;
    const name = document.getElementById('rename-value').value.trim();
    try {
      if (type === 'folder') {
        await api('/api/folders/' + id, { method: 'PATCH', body: JSON.stringify({ name }) });
      } else {
        await api('/api/files/' + id, { method: 'PATCH', body: JSON.stringify({ fileName: name }) });
      }
      els.renameModal.style.display = 'none';
      loadEntries(state.folderId);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('release-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/release', {
        method: 'POST',
        body: JSON.stringify({
          fileId: document.getElementById('release-file-id').value,
          version: document.getElementById('release-version').value.trim(),
          desc: document.getElementById('release-desc').value.trim(),
          force: document.getElementById('release-force').checked,
        }),
      });
      els.releaseModal.style.display = 'none';
      setStatus('发布版本已设置');
    } catch (err) {
      alert(err.message);
    }
  });

  els.searchInput.addEventListener('input', () => {
    const q = els.searchInput.value.trim().toLowerCase();
    if (!q) {
      state.filtered = null;
    } else {
      state.filtered = {
        folders: state.folders.filter((f) => f.name.toLowerCase().includes(q)),
        files: state.files.filter((f) => f.name.toLowerCase().includes(q)),
      };
    }
    state.selected.clear();
    render();
  });

  // 拖拽上传
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    if (!state.isAdmin) return;
    e.preventDefault();
    dragCounter++;
    els.dropOverlay.style.display = 'flex';
  });
  document.addEventListener('dragleave', (e) => {
    if (!state.isAdmin) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      els.dropOverlay.style.display = 'none';
    }
  });
  document.addEventListener('dragover', (e) => { if (state.isAdmin) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!state.isAdmin) return;
    e.preventDefault();
    dragCounter = 0;
    els.dropOverlay.style.display = 'none';
    if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && state.isAdmin && state.selected.size) {
      deleteSelected();
    }
    if (e.key === 'F2' && state.isAdmin && state.selected.size === 1) {
      openRename(getSelectedEntries()[0]);
    }
    if (e.key === 'Enter' && state.selected.size === 1) {
      const entry = getSelectedEntries()[0];
      if (entry.type === 'folder') navigate(entry.id);
      else if (isPreviewable(entry)) openPreview(entry.id);
      else downloadFile(entry.id);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      showPathInput();
    }
  });

  // 初始化
  loadSession().then(() => loadEntries(null)).catch((err) => setStatus('加载失败: ' + err.message));
})();
