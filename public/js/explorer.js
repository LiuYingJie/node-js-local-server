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
  };

  const els = {
    container: document.getElementById('entry-container'),
    breadcrumb: document.getElementById('breadcrumb'),
    emptyHint: document.getElementById('empty-hint'),
    statusText: document.getElementById('status-text'),
    selectionInfo: document.getElementById('selection-info'),
    contextMenu: document.getElementById('context-menu'),
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

  function applyAdminUI() {
    document.body.classList.toggle('is-admin', state.isAdmin);
    els.userBadge.textContent = state.isAdmin ? '管理员' : '访客';
    els.userBadge.classList.toggle('admin', state.isAdmin);
    els.btnLogin.style.display = state.isAdmin ? 'none' : 'inline-block';
    els.btnLogout.style.display = state.isAdmin ? 'inline-block' : 'none';
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

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    renderBreadcrumb();
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
      downloadFile(el.dataset.id);
    }
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
      items.push({ label: '删除', action: () => deleteSelected(), danger: true });
    }

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

    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 36);
    els.contextMenu.style.left = x + 'px';
    els.contextMenu.style.top = y + 'px';
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
  document.addEventListener('click', (e) => {
    if (!els.contextMenu.contains(e.target)) hideContextMenu();
  });

  document.getElementById('explorer-main').addEventListener('click', (e) => {
    if (e.target.closest('.entry-item')) return;
    if (!e.ctrlKey && !e.metaKey) {
      state.selected.clear();
      render();
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
      await api('/api/login', { method: 'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) });
      els.loginModal.style.display = 'none';
      state.isAdmin = true;
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
      else downloadFile(entry.id);
    }
  });

  // 初始化
  loadSession().then(() => loadEntries(null)).catch((err) => setStatus('加载失败: ' + err.message));
})();
