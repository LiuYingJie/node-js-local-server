(function () {
  const data = window.PREVIEW_DATA || {};
  const els = {
    content: document.getElementById('preview-content'),
    error: document.getElementById('preview-error'),
    searchInput: document.getElementById('preview-search-input'),
    searchCount: document.getElementById('preview-search-count'),
    prev: document.getElementById('preview-search-prev'),
    next: document.getElementById('preview-search-next'),
    editor: document.getElementById('preview-editor'),
    jsonEditor: document.getElementById('json-code-editor'),
    btnEdit: document.getElementById('btn-edit'),
    btnSave: document.getElementById('btn-save'),
    btnCancelEdit: document.getElementById('btn-cancel-edit'),
  };

  const state = {
    query: '',
    hits: [],
    activeIndex: -1,
    editing: false,
    savedContent: String(data.content || ''),
    editBaseline: '',
    jsonFoldRanges: new Map(),
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeCodeLine(value) {
    return escapeHtml(value).replace(/ /g, '&nbsp;') || '&nbsp;';
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function countOccurrences(text, query) {
    if (!query) return 0;
    return (String(text).match(new RegExp(escapeRegExp(query), 'gi')) || []).length;
  }

  function highlight(value) {
    const text = escapeHtml(value);
    if (!state.query) return text;
    const re = new RegExp(escapeRegExp(state.query), 'gi');
    return text.replace(re, (match) => `<mark class="search-hit">${match}</mark>`);
  }

  function valueToSearchText(value, key) {
    const prefix = key == null ? '' : String(key) + ' ';
    if (value == null) return prefix + 'null';
    if (typeof value !== 'object') return prefix + String(value);
    if (Array.isArray(value)) return prefix + value.map((item) => valueToSearchText(item)).join(' ');
    return prefix + Object.keys(value).map((k) => valueToSearchText(value[k], k)).join(' ');
  }

  function primitiveClass(value) {
    if (value === null) return 'json-null';
    if (typeof value === 'string') return 'json-string';
    if (typeof value === 'number') return 'json-number';
    if (typeof value === 'boolean') return 'json-boolean';
    return '';
  }

  function formatPrimitive(value) {
    if (typeof value === 'string') return `"${highlight(value)}"`;
    if (value === null) return 'null';
    return highlight(String(value));
  }

  function renderKey(key) {
    if (key == null) return '';
    return `<span class="json-key">"${highlight(key)}"</span><span class="json-muted">: </span>`;
  }

  function hasSearchHit(value, key) {
    if (!state.query) return false;
    return valueToSearchText(value, key).toLowerCase().includes(state.query.toLowerCase());
  }

  function renderJsonNode(value, key, depth) {
    const isRoot = key == null && depth === 0;
    const nodeClass = isRoot ? 'json-node root' : 'json-node';

    if (value === null || typeof value !== 'object') {
      return `<div class="${nodeClass}" data-search-text="${escapeHtml(valueToSearchText(value, key))}">
        ${renderKey(key)}<span class="${primitiveClass(value)}">${formatPrimitive(value)}</span>
      </div>`;
    }

    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    const open = depth < 1 || hasSearchHit(value, key) ? ' open' : '';
    const openMark = isArray ? '[' : '{';
    const closeMark = isArray ? ']' : '}';
    const count = entries.length;
    const label = `${openMark} ${count} ${isArray ? '项' : '键'} ${closeMark}`;

    return `<div class="${nodeClass}" data-search-text="${escapeHtml(valueToSearchText(value, key))}">
      <details${open}>
        <summary>${renderKey(key)}<span class="json-muted">${highlight(label)}</span></summary>
        <div class="json-children">
          ${entries.map(([childKey, childValue]) => renderJsonNode(childValue, childKey, depth + 1)).join('')}
        </div>
      </details>
    </div>`;
  }

  function renderText() {
    const lines = String(data.content || '').split(/\r?\n/);
    els.content.innerHTML = lines.map((line, index) => `
      <div class="text-line" data-search-text="${escapeHtml(line)}">
        <span class="line-no">${index + 1}</span>
        <span class="line-text">${highlight(line) || ' '}</span>
      </div>
    `).join('');
  }

  function renderJson() {
    try {
      const parsed = JSON.parse(data.content || 'null');
      els.error.style.display = 'none';
      els.content.innerHTML = `<div class="json-tree">${renderJsonNode(parsed, null, 0)}</div>`;
    } catch (err) {
      els.error.textContent = 'JSON 解析失败，已按普通文本显示: ' + err.message;
      els.error.style.display = 'block';
      renderText();
    }
  }

  function render() {
    if (data.type === 'json') renderJson();
    else renderText();
    collectHits();
  }

  function getFormattedJsonContent(content) {
    try {
      return JSON.stringify(JSON.parse(content || 'null'), null, 2);
    } catch {
      return String(content || '');
    }
  }

  function getJsonFoldRanges(lines) {
    const stack = [];
    const ranges = new Map();
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/[\{\[][,]?$/.test(trimmed)) {
        stack.push({ line: index, char: trimmed.includes('{') ? '{' : '[' });
      }
      if (/^[\}\]][,]?$/.test(trimmed) && stack.length) {
        const open = stack.pop();
        if (index > open.line + 1) ranges.set(open.line, index);
      }
    });
    return ranges;
  }

  function renderJsonEditor() {
    const text = getFormattedJsonContent(state.savedContent);
    state.editBaseline = text;
    const lines = text.split(/\r?\n/);
    state.jsonFoldRanges = getJsonFoldRanges(lines);
    els.jsonEditor.innerHTML = lines.map((line, index) => {
      const canFold = state.jsonFoldRanges.has(index);
      return `<div class="json-edit-line" data-line="${index}">
        <button type="button" class="json-fold-btn${canFold ? '' : ' empty'}" data-line="${index}" tabindex="-1">${canFold ? '▾' : ''}</button>
        <span class="json-edit-no">${index + 1}</span>
        <span class="json-edit-text" contenteditable="true" spellcheck="false">${escapeCodeLine(line)}</span>
      </div>`;
    }).join('');
  }

  function getJsonEditorContent() {
    return Array.from(els.jsonEditor.querySelectorAll('.json-edit-text'))
      .map((line) => line.textContent.replace(/\u00a0/g, ''))
      .join('\n');
  }

  function toggleJsonFold(lineIndex) {
    const end = state.jsonFoldRanges.get(lineIndex);
    if (end == null) return;
    const btn = els.jsonEditor.querySelector(`.json-fold-btn[data-line="${lineIndex}"]`);
    const collapsed = btn.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▸' : '▾';
    for (let i = lineIndex + 1; i < end; i++) {
      const line = els.jsonEditor.querySelector(`.json-edit-line[data-line="${i}"]`);
      if (line) line.style.display = collapsed ? 'none' : 'grid';
    }
  }

  function setStatus(message, danger) {
    els.error.textContent = message;
    els.error.style.display = message ? 'block' : 'none';
    els.error.classList.toggle('danger', Boolean(danger));
  }

  function setEditing(editing) {
    if (!data.canEdit) return;
    state.editing = editing;
    const jsonEditing = editing && data.type === 'json';
    const textEditing = editing && data.type !== 'json';
    els.editor.style.display = textEditing ? 'block' : 'none';
    els.jsonEditor.style.display = jsonEditing ? 'block' : 'none';
    els.content.style.display = editing ? 'none' : 'block';
    els.btnEdit.style.display = editing ? 'none' : 'inline-flex';
    els.btnSave.style.display = editing ? 'inline-flex' : 'none';
    els.btnCancelEdit.style.display = editing ? 'inline-flex' : 'none';
    document.getElementById('preview-search').style.display = editing ? 'none' : 'flex';
    if (editing) {
      if (jsonEditing) {
        renderJsonEditor();
        els.jsonEditor.querySelector('.json-edit-text')?.focus();
      } else {
        els.editor.value = state.savedContent;
        state.editBaseline = state.savedContent;
        els.editor.focus();
      }
    }
  }

  async function saveContent() {
    if (!state.editing) return;
    const content = data.type === 'json' ? getJsonEditorContent() : els.editor.value;
    try {
      const res = await fetch('/api/files/' + encodeURIComponent(data.fileId) + '/content', {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || '保存失败');
      data.content = result.content;
      state.savedContent = result.content;
      setEditing(false);
      render();
      setStatus('已保存');
      setTimeout(() => setStatus(''), 1600);
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  function collectHits() {
    state.hits = Array.from(els.content.querySelectorAll('mark.search-hit'));
    if (!state.hits.length) {
      state.activeIndex = -1;
      els.searchCount.textContent = state.query ? '0/0' : '0/0';
      return;
    }
    state.activeIndex = Math.min(Math.max(state.activeIndex, 0), state.hits.length - 1);
    updateActiveHit();
  }

  function updateActiveHit() {
    state.hits.forEach((hit, index) => {
      hit.classList.toggle('active', index === state.activeIndex);
    });
    if (state.activeIndex >= 0) {
      const hit = state.hits[state.activeIndex];
      let parent = hit.parentElement;
      while (parent) {
        if (parent.tagName === 'DETAILS') parent.setAttribute('open', '');
        parent = parent.parentElement;
      }
      hit.scrollIntoView({ block: 'center' });
      els.searchCount.textContent = `${state.activeIndex + 1}/${state.hits.length}`;
    } else {
      els.searchCount.textContent = `0/${state.hits.length}`;
    }
  }

  function moveHit(delta) {
    if (!state.hits.length) return;
    state.activeIndex = (state.activeIndex + delta + state.hits.length) % state.hits.length;
    updateActiveHit();
  }

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim();
    state.activeIndex = state.query ? 0 : -1;
    render();
  });

  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      moveHit(e.shiftKey ? -1 : 1);
    }
  });

  els.prev.addEventListener('click', () => moveHit(-1));
  els.next.addEventListener('click', () => moveHit(1));
  els.btnEdit?.addEventListener('click', () => setEditing(true));
  els.btnCancelEdit?.addEventListener('click', () => {
    const currentContent = data.type === 'json' ? getJsonEditorContent() : els.editor.value;
    if (currentContent !== state.editBaseline && !confirm('放弃未保存的修改？')) return;
    setEditing(false);
    setStatus('');
  });
  els.btnSave?.addEventListener('click', () => saveContent());
  els.jsonEditor?.addEventListener('click', (e) => {
    const btn = e.target.closest('.json-fold-btn');
    if (!btn || btn.classList.contains('empty')) return;
    toggleJsonFold(Number(btn.dataset.line));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (state.editing) saveContent();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      if (state.editing) return;
      e.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
    }
  });

  render();
})();
