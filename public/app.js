/**
 * Antigravity Web UI Frontend Controller
 */

// --- Authentication State & Fetch Interceptor ---
let currentAccessToken = localStorage.getItem('agy_access_token') || '';

// If URL has ?token=xxx or ?key=xxx, auto-extract and store
(function handleUrlToken() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenInUrl = urlParams.get('token') || urlParams.get('key');
    if (tokenInUrl) {
      currentAccessToken = tokenInUrl.trim();
      localStorage.setItem('agy_access_token', currentAccessToken);
      urlParams.delete('token');
      urlParams.delete('key');
      const cleanSearch = urlParams.toString();
      const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '') + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  } catch (e) {}
})();

// Global fetch interceptor to attach bearer token & handle 401
const originalFetch = window.fetch;
window.fetch = async function(input, init = {}) {
  init = init || {};
  init.headers = init.headers || {};
  
  if (currentAccessToken) {
    if (init.headers instanceof Headers) {
      init.headers.set('Authorization', `Bearer ${currentAccessToken}`);
      init.headers.set('x-agy-token', currentAccessToken);
    } else if (Array.isArray(init.headers)) {
      init.headers.push(['Authorization', `Bearer ${currentAccessToken}`]);
      init.headers.push(['x-agy-token', currentAccessToken]);
    } else {
      init.headers['Authorization'] = `Bearer ${currentAccessToken}`;
      init.headers['x-agy-token'] = currentAccessToken;
    }
  }

  const res = await originalFetch(input, init);

  if (res.status === 401) {
    const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (urlStr.includes('/api/') && !urlStr.includes('/api/auth/')) {
      updateAuthBadge(false);
      showAuthModal(true);
    }
  }

  return res;
};

// Application State
const state = {
  systemInfo: null,
  workspaces: [],
  currentWorkspace: null,
  conversations: [],
  currentConversationId: null,
  runningSessionIds: new Set(), // 正在运行任务的会话 ID 集合
  sessionContainers: new Map(), // convId -> 独立 DOM 容器元素
  activeSessions: new Map(),    // convId -> 活跃的 session 状态上下文
  isGenerating: false,          // 当前视图会话是否处于生成中
  activeModel: 'gemini-3.8-flash-high',
  activeMode: 'accept-edits',
  activeEffort: 'high',
  theme: 'dark',
  attachedImages: []            // { tempId, filename, url, server_path }
};

// DOM Elements
const el = {
  sidebar: document.getElementById('sidebar'),
  sidebarCollapseBtn: document.getElementById('sidebarCollapseBtn'),
  sidebarExpandBtn: document.getElementById('sidebarExpandBtn'),
  currentWsName: document.getElementById('currentWsName'),
  currentWsPath: document.getElementById('currentWsPath'),
  workspaceCard: document.getElementById('workspaceCard'),
  workspaceDropdown: document.getElementById('workspaceDropdown'),
  workspaceList: document.getElementById('workspaceList'),
  toggleWsListBtn: document.getElementById('toggleWsListBtn'),
  openAddWorkspaceBtn: document.getElementById('openAddWorkspaceBtn'),
  manageWsBtn: document.getElementById('manageWsBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  historyList: document.getElementById('historyList'),
  refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
  modelSelect: document.getElementById('modelSelect'),
  modeSelect: document.getElementById('modeSelect'),
  effortSelect: document.getElementById('effortSelect'),
  lanBadge: document.getElementById('lanBadge'),
  lanText: document.getElementById('lanText'),
  navLanUrl: document.getElementById('navLanUrl'),
  copyUrlBtn: document.getElementById('copyUrlBtn'),
  authBtn: document.getElementById('authBtn'),
  authIcon: document.getElementById('authIcon'),
  authStatusText: document.getElementById('authStatusText'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIconSun: document.getElementById('themeIconSun'),
  themeIconMoon: document.getElementById('themeIconMoon'),
  themeNameText: document.getElementById('themeNameText'),
  navWsPath: document.getElementById('navWsPath'),
  sessionTitle: document.getElementById('sessionTitle'),
  chatContainer: document.getElementById('chatContainer'),
  welcomeView: document.getElementById('welcomeView'),
  welcomeWsPath: document.getElementById('welcomeWsPath'),
  messagesList: document.getElementById('messagesList'),
  scrollBottomBtn: document.getElementById('scrollBottomBtn'),
  agentStatusBar: document.getElementById('agentStatusBar'),
  statusMessage: document.getElementById('statusMessage'),
  stopAgentBtn: document.getElementById('stopAgentBtn'),
  inputCard: document.querySelector('.input-card'),
  imagePreviewBar: document.getElementById('imagePreviewBar'),
  uploadImageBtn: document.getElementById('uploadImageBtn'),
  fileImageInput: document.getElementById('fileImageInput'),
  promptInput: document.getElementById('promptInput'),
  sendBtn: document.getElementById('sendBtn'),
  tokenCounter: document.getElementById('tokenCounter'),
  dropOverlay: document.getElementById('dropOverlay'),
  // Modal: Add Workspace
  addWorkspaceModal: document.getElementById('addWorkspaceModal'),
  closeAddWsModal: document.getElementById('closeAddWsModal'),
  cancelAddWsModal: document.getElementById('cancelAddWsModal'),
  wsInputName: document.getElementById('wsInputName'),
  wsInputPath: document.getElementById('wsInputPath'),
  validatePathBtn: document.getElementById('validatePathBtn'),
  wsValidationFeedback: document.getElementById('wsValidationFeedback'),
  saveWorkspaceBtn: document.getElementById('saveWorkspaceBtn'),
  // Modal: Auth
  authModal: document.getElementById('authModal'),
  accessKeyInput: document.getElementById('accessKeyInput'),
  toggleKeyVisibilityBtn: document.getElementById('toggleKeyVisibilityBtn'),
  submitAuthKeyBtn: document.getElementById('submitAuthKeyBtn'),
  authFeedback: document.getElementById('authFeedback')
};

// --- Authentication Helper Functions ---
function updateAuthBadge(isAuthenticated) {
  if (!el.authBtn) return;
  if (isAuthenticated) {
    el.authBtn.classList.remove('unauthenticated');
    if (el.authIcon) el.authIcon.textContent = '🔒';
    if (el.authStatusText) el.authStatusText.textContent = '已授权';
    el.authBtn.title = '访问密钥已验证 · 点击可锁定控制台';
  } else {
    el.authBtn.classList.add('unauthenticated');
    if (el.authIcon) el.authIcon.textContent = '🔓';
    if (el.authStatusText) el.authStatusText.textContent = '未授权';
    el.authBtn.title = '未授权 · 点击输入访问密钥';
  }
}

function showAuthModal(show) {
  if (!el.authModal) return;
  if (show) {
    el.authModal.classList.remove('hidden');
    if (el.authFeedback) el.authFeedback.classList.add('hidden');
    if (el.accessKeyInput) {
      el.accessKeyInput.value = currentAccessToken || '';
      setTimeout(() => el.accessKeyInput.focus(), 100);
    }
  } else {
    el.authModal.classList.add('hidden');
  }
}

function showAuthError(msg) {
  if (!el.authFeedback) return;
  el.authFeedback.textContent = msg;
  el.authFeedback.classList.remove('hidden');
}

async function checkAuthStatus() {
  try {
    const res = await originalFetch('/api/auth/status', {
      headers: currentAccessToken ? {
        'Authorization': `Bearer ${currentAccessToken}`,
        'x-agy-token': currentAccessToken
      } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (!data.requires_auth || data.authenticated) {
        updateAuthBadge(true);
        return true;
      }
    }
  } catch (e) {
    console.error('Auth check error:', e);
  }
  updateAuthBadge(false);
  return false;
}

async function verifyAndSaveToken(token) {
  token = (token || '').trim();
  if (!token) {
    showAuthError('请输入访问密钥');
    return false;
  }
  try {
    if (el.submitAuthKeyBtn) el.submitAuthKeyBtn.disabled = true;
    const res = await originalFetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      currentAccessToken = token;
      localStorage.setItem('agy_access_token', token);
      showAuthModal(false);
      updateAuthBadge(true);
      // Reload initial dashboard data
      await loadSystemInfo();
      await loadWorkspaces();
      await loadConversations();
      return true;
    } else {
      showAuthError(data.error || '访问密钥错误，请重新输入');
      return false;
    }
  } catch (err) {
    showAuthError('网络或验证失败：' + err.message);
    return false;
  } finally {
    if (el.submitAuthKeyBtn) el.submitAuthKeyBtn.disabled = false;
  }
}

function setupAuthHandlers() {
  if (el.authBtn) {
    el.authBtn.addEventListener('click', async () => {
      if (currentAccessToken) {
        if (confirm('是否退出登录并锁定当前 Antigravity 控制台？')) {
          currentAccessToken = '';
          localStorage.removeItem('agy_access_token');
          await originalFetch('/api/auth/logout', { method: 'POST' });
          updateAuthBadge(false);
          showAuthModal(true);
        }
      } else {
        showAuthModal(true);
      }
    });
  }

  if (el.submitAuthKeyBtn) {
    el.submitAuthKeyBtn.addEventListener('click', () => {
      verifyAndSaveToken(el.accessKeyInput.value);
    });
  }

  if (el.accessKeyInput) {
    el.accessKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        verifyAndSaveToken(el.accessKeyInput.value);
      }
    });
  }

  if (el.toggleKeyVisibilityBtn && el.accessKeyInput) {
    el.toggleKeyVisibilityBtn.addEventListener('click', () => {
      if (el.accessKeyInput.type === 'password') {
        el.accessKeyInput.type = 'text';
        el.toggleKeyVisibilityBtn.textContent = '🔒';
      } else {
        el.accessKeyInput.type = 'password';
        el.toggleKeyVisibilityBtn.textContent = '👁️';
      }
    });
  }
}

// --- Initialization ---
async function init() {
  // Initialize Theme
  const savedTheme = localStorage.getItem('agy_theme') || 'dark';
  setTheme(savedTheme);

  setupEventListeners();
  setupAuthHandlers();

  // Check Auth Status First
  const authOk = await checkAuthStatus();
  if (!authOk) {
    showAuthModal(true);
    return;
  }

  await loadSystemInfo();
  await loadWorkspaces();
  await loadConversations();
  
  // Auto select default workspace
  const savedWsPath = localStorage.getItem('agy_last_ws');
  let selected = state.workspaces.find(w => w.path === savedWsPath);
  if (!selected && state.workspaces.length > 0) {
    selected = state.workspaces[0];
  }
  if (selected) {
    setWorkspace(selected);
  }

  // 定时每 4 秒静默同步会话运行状态
  setInterval(() => {
    loadConversations(true);
  }, 4000);
}

// --- Event Listeners ---
function setupEventListeners() {
  // Sidebar Toggle
  el.sidebarCollapseBtn.addEventListener('click', () => el.sidebar.classList.add('collapsed'));
  el.sidebarExpandBtn.addEventListener('click', () => el.sidebar.classList.toggle('collapsed'));

  // Workspace dropdown toggle
  el.workspaceCard.addEventListener('click', (e) => {
    if (e.target.closest('#openAddWorkspaceBtn')) return;
    el.workspaceDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!el.workspaceCard.contains(e.target) && !el.workspaceDropdown.contains(e.target)) {
      el.workspaceDropdown.classList.add('hidden');
    }
  });

  // Open Add Workspace Modal
  el.openAddWorkspaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openWorkspaceModal();
  });
  el.manageWsBtn.addEventListener('click', openWorkspaceModal);
  el.closeAddWsModal.addEventListener('click', closeWorkspaceModal);
  el.cancelAddWsModal.addEventListener('click', closeWorkspaceModal);

  // Validate path button
  el.validatePathBtn.addEventListener('click', validateWorkspacePathInput);
  el.wsInputPath.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') validateWorkspacePathInput();
  });

  // Quick tag buttons
  document.querySelectorAll('.quick-paths-list .btn-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      el.wsInputPath.value = btn.dataset.path;
      validateWorkspacePathInput();
    });
  });

  // Save workspace
  el.saveWorkspaceBtn.addEventListener('click', saveNewWorkspace);

  // New Chat
  el.newChatBtn.addEventListener('click', startNewChat);

  // Refresh History
  el.refreshHistoryBtn.addEventListener('click', loadConversations);

  // Quick prompt cards
  document.querySelectorAll('.quick-prompt-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (prompt) {
        el.promptInput.value = prompt;
        sendMessage();
      }
    });
  });

  // Send message
  el.sendBtn.addEventListener('click', sendMessage);
  el.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto resize textarea
  el.promptInput.addEventListener('input', () => {
    el.promptInput.style.height = 'auto';
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 180) + 'px';
  });

  // Stop Agent
  el.stopAgentBtn.addEventListener('click', stopAgentExecution);

  // Scroll to bottom
  el.chatContainer.addEventListener('scroll', () => {
    const isNearBottom = el.chatContainer.scrollHeight - el.chatContainer.scrollTop - el.chatContainer.clientHeight < 120;
    if (isNearBottom) {
      el.scrollBottomBtn.classList.add('hidden');
    } else {
      el.scrollBottomBtn.classList.remove('hidden');
    }
  });
  el.scrollBottomBtn.addEventListener('click', scrollToBottom);

  // Model & Mode selections
  el.modelSelect.addEventListener('change', () => {
    state.activeModel = el.modelSelect.value;
    localStorage.setItem('agy_model', state.activeModel);
  });
  el.modeSelect.addEventListener('change', () => {
    state.activeMode = el.modeSelect.value;
    localStorage.setItem('agy_mode', state.activeMode);
  });
  el.effortSelect.addEventListener('change', () => {
    state.activeEffort = el.effortSelect.value;
    localStorage.setItem('agy_effort', state.activeEffort);
  });

  // Copy IP
  el.copyUrlBtn.addEventListener('click', copyLanUrl);
  el.lanBadge.addEventListener('click', copyLanUrl);

  // Theme Toggle
  if (el.themeToggleBtn) {
    el.themeToggleBtn.addEventListener('click', () => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme);
    });
  }

  // Image Paste handler (Ctrl+V in input or on document)
  el.promptInput.addEventListener('paste', handlePaste);
  document.addEventListener('paste', (e) => {
    if (document.activeElement !== el.promptInput && !document.activeElement.matches('input, textarea')) {
      handlePaste(e);
    }
  });

  // Global Drag & Drop for all files (Images, PDFs, Documents, etc.)
  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (el.dropOverlay) el.dropOverlay.classList.remove('hidden');
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (el.dropOverlay) el.dropOverlay.classList.add('hidden');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (el.dropOverlay) el.dropOverlay.classList.add('hidden');
    if (el.inputCard) el.inputCard.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        uploadAndAttachFile(e.dataTransfer.files[i]);
      }
    }
  });

  if (el.inputCard) {
    el.inputCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.inputCard.classList.add('drag-over');
    });
    el.inputCard.addEventListener('dragleave', () => {
      el.inputCard.classList.remove('drag-over');
    });
  }

  // Attachment upload button & file input
  if (el.uploadImageBtn && el.fileImageInput) {
    el.uploadImageBtn.addEventListener('click', () => el.fileImageInput.click());
    el.fileImageInput.addEventListener('change', () => {
      if (el.fileImageInput.files && el.fileImageInput.files.length > 0) {
        for (let i = 0; i < el.fileImageInput.files.length; i++) {
          uploadAndAttachFile(el.fileImageInput.files[i]);
        }
        el.fileImageInput.value = '';
      }
    });
  }
}

// Set Theme
function setTheme(themeName) {
  state.theme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('agy_theme', themeName);

  if (el.themeIconSun && el.themeIconMoon && el.themeNameText) {
    if (themeName === 'dark') {
      el.themeIconMoon.classList.remove('hidden');
      el.themeIconSun.classList.add('hidden');
      el.themeNameText.textContent = '深色';
    } else {
      el.themeIconMoon.classList.add('hidden');
      el.themeIconSun.classList.remove('hidden');
      el.themeNameText.textContent = '浅色';
    }
  }
}

// --- Insert Uploaded Server Path to Input ---
function insertPathToInput(serverPath) {
  if (!serverPath || !el.promptInput) return;
  const input = el.promptInput;
  const current = input.value;
  if (!current.trim()) {
    input.value = serverPath + ' ';
  } else {
    const sep = (current.endsWith('\n') || current.endsWith(' ')) ? '' : ' ';
    input.value = current + sep + serverPath + ' ';
  }
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  adjustTextareaHeight();
}

function adjustTextareaHeight() {
  if (!el.promptInput) return;
  el.promptInput.style.height = 'auto';
  el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 180) + 'px';
}

// --- Paste Handler for Images and Files ---
function handlePaste(e) {
  const clipboardData = e.clipboardData || window.clipboardData;
  if (!clipboardData || !clipboardData.items) return;

  const items = clipboardData.items;
  let hasFile = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        hasFile = true;
        uploadAndAttachFile(file);
      }
    }
  }

  // If a file/image was pasted and no plain text, prevent default
  if (hasFile && !clipboardData.getData('text/plain')) {
    e.preventDefault();
  }
}

// --- Upload Any File (Images, PDFs, Documents, etc.) to agyweb-uploads ---
async function uploadAndAttachFile(file) {
  if (!file) return;
  const tempId = 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const isImg = file.type && file.type.startsWith('image/');
  const isPdf = (file.name || '').toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

  // Create preview chip
  const chip = document.createElement('div');
  chip.className = 'attachment-chip loading';
  chip.id = tempId;
  const defaultIcon = isImg ? '🖼️' : (isPdf ? '📕' : '📄');
  chip.innerHTML = `
    <span class="chip-icon">${defaultIcon}</span>
    <span class="chip-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
    <span class="chip-spinner"></span>
    <button class="chip-remove" title="移除">✕</button>
  `;

  el.imagePreviewBar.appendChild(chip);
  el.imagePreviewBar.classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = async (event) => {
    const base64Data = event.target.result;
    if (isImg) {
      const iconEl = chip.querySelector('.chip-icon');
      if (iconEl) iconEl.innerHTML = `<img src="${base64Data}" alt="thumb">`;
    }

    try {
      const currentWs = state.currentWorkspace?.path || state.systemInfo?.default_workspace || '.';
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: base64Data,
          name: file.name || (isImg ? 'pasted_image.png' : 'file.bin'),
          workspace: currentWs
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');

      chip.classList.remove('loading');
      const spinner = chip.querySelector('.chip-spinner');
      if (spinner) spinner.remove();

      state.attachedImages.push({
        tempId,
        filename: data.filename,
        original_name: data.original_name || file.name,
        url: data.url,
        server_path: data.server_path,
        is_image: data.is_image
      });

      // 关键：对话窗口自动输入上传文件的完整绝对路径，光标自动停在后面，方便客户直接输入提示词
      insertPathToInput(data.server_path);

      chip.querySelector('.chip-remove').addEventListener('click', () => {
        chip.remove();
        state.attachedImages = state.attachedImages.filter(img => img.tempId !== tempId);
        if (state.attachedImages.length === 0) {
          el.imagePreviewBar.classList.add('hidden');
        }
      });
    } catch (err) {
      alert('文件上传失败: ' + err.message);
      chip.remove();
      if (state.attachedImages.length === 0) {
        el.imagePreviewBar.classList.add('hidden');
      }
    }
  };
  reader.readAsDataURL(file);
}

// --- API Calls & Data Loaders ---
async function loadSystemInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    state.systemInfo = data;

    // Update LAN badge
    const lanUrl = data.primary_url || `http://${data.primary_lan_ip}:${data.port}`;
    el.lanText.textContent = `${data.primary_lan_ip}:${data.port}`;
    el.navLanUrl.textContent = `${data.primary_lan_ip}:${data.port}`;
    el.copyUrlBtn.dataset.url = lanUrl;
    el.lanBadge.dataset.url = lanUrl;

    // Populate Models
    el.modelSelect.innerHTML = '';
    const savedModel = localStorage.getItem('agy_model');
    data.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (savedModel ? m.id === savedModel : m.default) {
        opt.selected = true;
        state.activeModel = m.id;
      }
      el.modelSelect.appendChild(opt);
    });

    // Restore mode & effort
    const savedMode = localStorage.getItem('agy_mode');
    if (savedMode) {
      el.modeSelect.value = savedMode;
      state.activeMode = savedMode;
    }
    const savedEffort = localStorage.getItem('agy_effort');
    if (savedEffort) {
      el.effortSelect.value = savedEffort;
      state.activeEffort = savedEffort;
    }

  } catch (err) {
    console.error('Failed to load system info:', err);
  }
}

async function loadWorkspaces() {
  try {
    const res = await fetch('/api/workspaces');
    state.workspaces = await res.json();
    renderWorkspacesList();
  } catch (err) {
    console.error('Failed to load workspaces:', err);
  }
}

function renderWorkspacesList() {
  el.workspaceList.innerHTML = '';
  state.workspaces.forEach(ws => {
    const item = document.createElement('div');
    item.className = 'ws-item' + (state.currentWorkspace?.path === ws.path ? ' active' : '');
    item.innerHTML = `
      <div class="ws-item-info">
        <div class="ws-item-title">${escapeHtml(ws.name)}</div>
        <div class="ws-item-path" title="${escapeHtml(ws.path)}">${escapeHtml(ws.path)}</div>
      </div>
      <button class="btn-icon-sm delete-ws-btn" title="从列表移除">✕</button>
    `;

    item.querySelector('.ws-item-info').addEventListener('click', () => {
      setWorkspace(ws);
      el.workspaceDropdown.classList.add('hidden');
    });

    item.querySelector('.delete-ws-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确认从工作区列表移除 "${ws.name}"？(不会删除服务器文件)`)) {
        await deleteWorkspace(ws);
      }
    });

    el.workspaceList.appendChild(item);
  });
}

function setWorkspace(ws) {
  state.currentWorkspace = ws;
  localStorage.setItem('agy_last_ws', ws.path);
  el.currentWsName.textContent = ws.name;
  el.currentWsPath.textContent = ws.path;
  el.currentWsPath.title = ws.path;
  el.navWsPath.textContent = ws.name;
  el.navbarWsPill.title = `工作区路径: ${ws.path}`;
  if (el.welcomeWsPath) el.welcomeWsPath.textContent = ws.path;
  renderWorkspacesList();
}

async function loadConversations(silent = false) {
  try {
    if (!silent && state.conversations.length === 0) {
      el.historyList.innerHTML = '<div class="loading-state">加载中...</div>';
    }
    const res = await fetch('/api/conversations?limit=30');
    if (!res.ok) throw new Error('Failed to load conversations');
    const list = await res.json();
    state.conversations = list;

    // 同步后端返回的运行中会话状态
    list.forEach(c => {
      if (c.is_running) {
        state.runningSessionIds.add(c.id);
      } else {
        // 仅当前端本标签页没有活跃的 stream 时才移除
        if (!state.activeSessions.has(c.id)) {
          state.runningSessionIds.delete(c.id);
        }
      }
    });

    renderConversationsList();
    updateGeneratingUI();
  } catch (err) {
    if (!silent && state.conversations.length === 0) {
      el.historyList.innerHTML = '<div class="loading-state">暂无历史或加载失败</div>';
    }
  }
}

function renderConversationsList() {
  el.historyList.innerHTML = '';
  if (state.conversations.length === 0) {
    el.historyList.innerHTML = '<div class="loading-state">暂无历史会话</div>';
    return;
  }

  state.conversations.forEach(c => {
    const isRunning = c.is_running || state.runningSessionIds.has(c.id);
    const isActive = state.currentConversationId === c.id;
    const item = document.createElement('div');
    item.className = 'history-item' + (isActive ? ' active' : '') + (isRunning ? ' is-running' : '');
    
    const timeStr = formatRelativeTime(c.updated_at || c.created_at);
    item.innerHTML = `
      <span class="history-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
      <div class="history-meta-row">
        ${isRunning ? `
          <span class="history-status-badge status-running">
            <span class="status-pulse-dot"></span> 运行中
          </span>
        ` : `
          <span class="history-status-badge status-completed">
            <span class="status-check-icon">✓</span> 已完成
          </span>
        `}
        <span class="history-time">${timeStr}</span>
      </div>
    `;

    item.addEventListener('click', () => switchConversation(c.id, c.title));
    el.historyList.appendChild(item);
  });
}

// 获取或创建某会话的独立 DOM 容器
function getOrCreateSessionContainer(convId) {
  if (!convId) return el.messagesList;
  let container = state.sessionContainers.get(convId);
  if (!container) {
    container = document.createElement('div');
    container.className = 'session-messages-container hidden';
    container.dataset.convId = convId;
    el.messagesList.appendChild(container);
    state.sessionContainers.set(convId, container);
  }
  return container;
}

// 切换显示指定会话的 DOM 容器
function showSessionContainer(convId) {
  if (!convId) {
    state.sessionContainers.forEach(c => c.classList.add('hidden'));
    el.messagesList.classList.add('hidden');
    el.welcomeView.classList.remove('hidden');
    return;
  }

  el.welcomeView.classList.add('hidden');
  el.messagesList.classList.remove('hidden');

  state.sessionContainers.forEach((c, id) => {
    if (id === convId) {
      c.classList.remove('hidden');
    } else {
      c.classList.add('hidden');
    }
  });
}

// Switch Conversation (随时进入之前或正在运行的会话)
async function switchConversation(convId, title) {
  state.currentConversationId = convId;
  el.sessionTitle.textContent = title || '历史会话';
  
  const container = getOrCreateSessionContainer(convId);
  showSessionContainer(convId);
  renderConversationsList();
  updateGeneratingUI();

  // 若容器内已有内容（无论是正在实时流式输出，还是已加载历史），直接恢复展示即可
  if (container.children.length > 0) {
    scrollToBottom();
    return;
  }

  // 否则从后端拉取历史记录
  try {
    container.innerHTML = '<div class="loading-state" style="padding: 24px; text-align: center; color: var(--text-dim);">加载记录中...</div>';
    const res = await fetch(`/api/conversations/${convId}`);
    if (!res.ok) throw new Error('Failed to load conversation');
    const data = await res.json();

    container.innerHTML = '';
    if (Array.isArray(data.messages)) {
      data.messages.forEach(msg => {
        appendMessage(msg.role, msg.content, {
          thinking: msg.thinking,
          tool_calls: msg.tool_calls,
          timestamp: msg.timestamp
        }, container);
      });
    }

    scrollToBottom();
  } catch (err) {
    container.innerHTML = `<div class="tool-badge error" style="margin: 16px;">加载会话失败: ${escapeHtml(err.message)}</div>`;
  }
}

// Start New Chat (随时新建会话，不影响后台正在运行的其他会话)
function startNewChat() {
  state.currentConversationId = null;
  el.sessionTitle.textContent = '新会话';
  showSessionContainer(null);
  el.promptInput.value = '';
  el.promptInput.focus();
  renderConversationsList();
  updateGeneratingUI();
}

// --- Send Message & Concurrent Multi-Session Stream ---
async function sendMessage() {
  const prompt = el.promptInput.value.trim();
  const images = [...state.attachedImages];
  
  // 当前会话正在生成时，禁止重复提交；空输入也不提交
  if ((!prompt && images.length === 0) || (state.currentConversationId && state.runningSessionIds.has(state.currentConversationId))) {
    return;
  }

  const currentWs = state.currentWorkspace?.path || state.systemInfo?.default_workspace || '.';
  const isNewSession = !state.currentConversationId;
  const tempId = isNewSession ? `sess_${Date.now()}` : state.currentConversationId;
  const convIdToSend = isNewSession ? null : state.currentConversationId;

  if (isNewSession) {
    state.currentConversationId = tempId;
    el.sessionTitle.textContent = prompt.slice(0, 24) || '新任务';

    // 乐观插入侧边栏并标记为「运行中」
    state.conversations.unshift({
      id: tempId,
      title: prompt.slice(0, 30) || '新任务',
      created_at: new Date().toISOString(),
      is_running: true,
      status: 'running'
    });
  }

  // 获取并展示该会话的独立容器
  const container = getOrCreateSessionContainer(state.currentConversationId);
  showSessionContainer(state.currentConversationId);

  // 添加用户输入消息气泡
  const displayContent = prompt || (images.length > 0 ? images.map(img => img.server_path).join('\n') : '');
  appendMessage('user', displayContent, { images }, container);

  // 清空输入框和上传附件
  el.promptInput.value = '';
  el.promptInput.style.height = 'auto';
  state.attachedImages = [];
  el.imagePreviewBar.innerHTML = '';
  el.imagePreviewBar.classList.add('hidden');

  // 在该会话容器中创建 Agent 回复容器与打字光标
  const assistantMsgObj = createAssistantMessageContainer(container);

  // 初始化该会话独立的上下文状态
  const abortController = new AbortController();
  const sessionContext = {
    sessionId: state.currentConversationId,
    tempId: isNewSession ? tempId : null,
    container: container,
    currentStreamMessage: assistantMsgObj,
    currentToolsMap: new Map(),
    abortController: abortController,
    statusText: '正在连接智能体...'
  };

  state.activeSessions.set(state.currentConversationId, sessionContext);
  state.runningSessionIds.add(state.currentConversationId);

  updateGeneratingUI();
  renderConversationsList();
  scrollToBottom();

  // 非阻塞发起后台流式请求（允许用户此时立即新建其他会话或切换至其他会话）
  runSessionStream(sessionContext, prompt, currentWs, convIdToSend, images);
}

// 独立的流式处理循环（各会话并行互不干扰）
async function runSessionStream(session, prompt, workspace, convIdToSend, images) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: session.abortController.signal,
      body: JSON.stringify({
        prompt: prompt,
        workspace: workspace,
        conversation_id: convIdToSend,
        model: state.activeModel,
        mode: state.activeMode,
        effort: state.activeEffort,
        images: images
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // 保留最后一个未完整切分的 chunk

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        let event = 'message';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            event = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            dataStr = line.substring(5).trim();
          }
        }

        if (dataStr) {
          try {
            const data = JSON.parse(dataStr);
            handleStreamEventForSession(session, event, data);
          } catch (err) {
            console.warn('Failed to parse SSE data:', dataStr, err);
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Session stream error:', err);
      if (session.currentStreamMessage) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'tool-badge error';
        errorDiv.style.marginTop = '8px';
        errorDiv.textContent = `执行异常: ${err.message}`;
        session.currentStreamMessage.bodyEl.appendChild(errorDiv);
      }
    }
  } finally {
    state.runningSessionIds.delete(session.sessionId);
    if (session.tempId) {
      state.runningSessionIds.delete(session.tempId);
    }
    state.activeSessions.delete(session.sessionId);
    removeTypingCursor(session.container);
    updateGeneratingUI();
    loadConversations(true);
  }
}

// 绑定到会话实例的 SSE 事件处理
function handleStreamEventForSession(session, event, data) {
  if (event === 'init') {
    const realConvId = data.conversation_id;
    if (realConvId && realConvId !== session.sessionId) {
      const oldId = session.sessionId;
      session.sessionId = realConvId;
      session.container.dataset.convId = realConvId;
      state.sessionContainers.delete(oldId);
      state.sessionContainers.set(realConvId, session.container);

      state.runningSessionIds.delete(oldId);
      state.runningSessionIds.add(realConvId);

      state.activeSessions.delete(oldId);
      state.activeSessions.set(realConvId, session);

      if (state.currentConversationId === oldId) {
        state.currentConversationId = realConvId;
      }

      const tempItem = state.conversations.find(c => c.id === oldId);
      if (tempItem) {
        tempItem.id = realConvId;
      }

      loadConversations(true);
    }
    session.statusText = `智能体已就绪 (工作区: ${data.cwd || '当前目录'})`;
    if (state.currentConversationId === session.sessionId) {
      updateStatus(session.statusText);
    }
  } else if (event === 'status') {
    session.statusText = `正在启动模型 ${data.model}...`;
    if (state.currentConversationId === session.sessionId) {
      updateStatus(session.statusText);
    }
  } else if (event === 'step') {
    handleStepEventForSession(session, data);
  } else if (event === 'result') {
    session.statusText = '执行完成';
    if (state.currentConversationId === session.sessionId) {
      if (data.usage && el.tokenCounter) {
        const tok = data.usage.total_tokens || (data.usage.input_tokens + data.usage.output_tokens);
        el.tokenCounter.textContent = `消耗: ~${tok} tokens · 耗时: ${data.duration_seconds?.toFixed(1) || '?'}s`;
      }
      updateStatus('执行完成');
    }
  } else if (event === 'done') {
    if (data.conversation_id && session.sessionId !== data.conversation_id) {
      session.sessionId = data.conversation_id;
      state.sessionContainers.set(data.conversation_id, session.container);
    }
    state.runningSessionIds.delete(session.sessionId);
    removeTypingCursor(session.container);
    if (state.currentConversationId === session.sessionId) {
      updateGeneratingUI();
    }
    loadConversations(true);
  } else if (event === 'error') {
    session.statusText = `错误: ${data.error}`;
    if (state.currentConversationId === session.sessionId) {
      updateStatus(session.statusText);
    }
  }
}

// 绑定到会话实例的 Step 事件处理（思考过程、工具调用卡片、Markdown 流式文本）
function handleStepEventForSession(session, step) {
  const msgObj = session.currentStreamMessage;
  if (!msgObj) return;

  const isCurrentView = state.currentConversationId === session.sessionId;

  // 1. Tool execution: 实时在底部状态栏反馈工具执行进度，不向对话区域插入冗余卡片
  if (step.step_type === 'tool') {
    const toolName = step.tool_name || step.tool_info?.name || '执行操作';
    session.statusText = `正在执行工具: ${toolName}...`;
    if (isCurrentView) {
      updateStatus(session.statusText);
    }
    return;
  }

  // 2. Thinking / Reasoning text
  if (step.thinking_delta || step.step_type === 'thinking') {
    let thinkingBox = msgObj.thinkingEl;
    if (!thinkingBox) {
      thinkingBox = createThinkingBox();
      msgObj.bodyEl.insertBefore(thinkingBox.el, msgObj.bodyEl.firstChild);
      msgObj.thinkingEl = thinkingBox;
    }
    thinkingBox.append(step.thinking_delta || step.text_delta || '');
    if (isCurrentView) scrollToBottom();
    return;
  }

  // 3. Agent Response Text Delta
  if (step.step_type === 'agent_response' && step.text_delta) {
    msgObj.rawText += step.text_delta;
    msgObj.textEl.innerHTML = renderMarkdown(msgObj.rawText);
    ensureTypingCursor(msgObj.textEl);
    if (isCurrentView) scrollToBottom();
  }
}

// Stop Agent Execution (中断当前正在查看的会话)
async function stopAgentExecution() {
  const currentId = state.currentConversationId;
  if (!currentId || !state.runningSessionIds.has(currentId)) return;

  try {
    updateStatus('正在中断智能体执行...');
    
    const active = state.activeSessions.get(currentId);
    if (active && active.abortController) {
      active.abortController.abort();
    }

    await fetch('/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: currentId })
    });
  } catch (err) {
    console.error('Stop error:', err);
  } finally {
    state.runningSessionIds.delete(currentId);
    state.activeSessions.delete(currentId);
    updateGeneratingUI();
    loadConversations(true);
  }
}

// --- UI Construction Helpers ---
function createAssistantMessageContainer(targetContainer = null) {
  const container = targetContainer || (state.currentConversationId ? getOrCreateSessionContainer(state.currentConversationId) : el.messagesList);
  const row = document.createElement('div');
  row.className = 'message-row assistant';

  row.innerHTML = `
    <div class="message-avatar">AI</div>
    <div class="message-content">
      <div class="message-author">Antigravity Agent</div>
      <div class="message-body markdown-body">
        <div class="response-text"></div>
      </div>
    </div>
  `;

  container.appendChild(row);
  const textEl = row.querySelector('.response-text');
  const bodyEl = row.querySelector('.message-body');

  return {
    rowEl: row,
    bodyEl: bodyEl,
    textEl: textEl,
    rawText: '',
    thinkingEl: null
  };
}

function createThinkingBox() {
  const wrap = document.createElement('div');
  wrap.className = 'thinking-block';
  wrap.innerHTML = `
    <div class="thinking-header">
      <span class="thinking-title">💭 思考过程 (Thinking Process)</span>
      <span class="btn-icon-sm">▼</span>
    </div>
    <div class="thinking-content"></div>
  `;

  const header = wrap.querySelector('.thinking-header');
  const content = wrap.querySelector('.thinking-content');

  header.addEventListener('click', () => {
    content.classList.toggle('hidden');
    header.querySelector('.btn-icon-sm').textContent = content.classList.contains('hidden') ? '▶' : '▼';
  });

  return {
    el: wrap,
    contentEl: content,
    append: (text) => {
      content.textContent += text;
    }
  };
}

function createToolCard(step) {
  const card = document.createElement('div');
  card.className = 'tool-call-card';

  const toolName = step.tool_name || step.tool_info?.name || '执行工具';
  const paramSnippet = formatToolParams(step.tool_info?.parameters);

  card.innerHTML = `
    <div class="tool-header">
      <div class="tool-badge-wrap">
        <span class="tool-badge running">
          <span class="spinner-inline"></span> 执行中
        </span>
        <span class="tool-name-text">🛠️ ${escapeHtml(toolName)}</span>
        <span class="tool-params-preview">${escapeHtml(paramSnippet)}</span>
      </div>
      <span class="btn-icon-sm toggle-output-btn">▼</span>
    </div>
    <div class="tool-output-box hidden"></div>
  `;

  const header = card.querySelector('.tool-header');
  const outputBox = card.querySelector('.tool-output-box');
  const toggleBtn = card.querySelector('.toggle-output-btn');

  header.addEventListener('click', () => {
    outputBox.classList.toggle('hidden');
    toggleBtn.textContent = outputBox.classList.contains('hidden') ? '▶' : '▼';
  });

  return { el: card, outputBox, badge: card.querySelector('.tool-badge'), header };
}

function updateToolCard(toolObj, step) {
  const isDone = step.state === 'DONE';
  const isError = step.state === 'ERROR';

  if (isDone) {
    toolObj.badge.className = 'tool-badge done';
    toolObj.badge.innerHTML = '✓ 完成';
  } else if (isError) {
    toolObj.badge.className = 'tool-badge error';
    toolObj.badge.innerHTML = '✕ 失败';
  }

  const output = step.tool_info?.output || step.tool_info?.error?.message;
  if (output) {
    toolObj.outputBox.textContent = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    // Auto show output if error
    if (isError) {
      toolObj.outputBox.classList.remove('hidden');
    }
  }
}

function formatToolParams(params) {
  if (!params) return '';
  if (params.CommandLine) return params.CommandLine;
  if (params.TargetFile) return params.TargetFile;
  if (params.AbsolutePath) return params.AbsolutePath;
  if (params.Query) return params.Query;
  return JSON.stringify(params);
}

function appendMessage(role, content, extra = {}, targetContainer = null) {
  // 如果是助手消息，且既无文本内容又无思考过程，则跳过不渲染空泡
  if (role === 'assistant' && !content && !extra.thinking) {
    return;
  }

  const container = targetContainer || (state.currentConversationId ? getOrCreateSessionContainer(state.currentConversationId) : el.messagesList);
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = role === 'user' ? 'U' : 'AI';
  const author = role === 'user' ? '你' : 'Antigravity Agent';

  let innerHtml = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-author">${author}</div>
      <div class="message-body ${role === 'assistant' ? 'markdown-body' : ''}">
  `;

  // Assistant thinking block if present
  if (extra.thinking) {
    innerHtml += `
      <div class="thinking-block">
        <div class="thinking-header">
          <span class="thinking-title">💭 思考过程 (Thinking Process)</span>
          <span class="btn-icon-sm">▼</span>
        </div>
        <div class="thinking-content">${escapeHtml(extra.thinking)}</div>
      </div>
    `;
  }

  // Render attached files/images if any
  if (extra.images && Array.isArray(extra.images) && extra.images.length > 0) {
    innerHtml += `<div class="chat-images-grid">`;
    extra.images.forEach(img => {
      const isImg = img.is_image !== false && (!img.filename || img.filename.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i));
      if (isImg) {
        innerHtml += `<img src="${img.url}" alt="${escapeHtml(img.original_name || img.filename || 'image')}" class="chat-image-attachment" title="点击查看大图" onclick="window.open('${img.url}', '_blank')">`;
      } else {
        const isPdf = (img.filename || '').toLowerCase().endsWith('.pdf');
        innerHtml += `
          <div class="chat-file-attachment" onclick="window.open('${img.url}', '_blank')" title="点击查看文件">
            <span class="file-icon">${isPdf ? '📕' : '📄'}</span>
            <div class="file-meta">
              <span class="file-name">${escapeHtml(img.original_name || img.filename || 'file')}</span>
              <span class="file-sub">已存至 agyweb-uploads</span>
            </div>
          </div>
        `;
      }
    });
    innerHtml += `</div>`;
  }

  if (role === 'assistant') {
    innerHtml += `<div class="response-text">${renderMarkdown(content)}</div>`;
  } else {
    innerHtml += `<div class="response-text">${escapeHtml(content)}</div>`;
  }

  innerHtml += `</div></div>`;
  row.innerHTML = innerHtml;

  // Add click to toggle thinking block
  const thinkingHeader = row.querySelector('.thinking-header');
  if (thinkingHeader) {
    const thinkingContent = row.querySelector('.thinking-content');
    thinkingHeader.addEventListener('click', () => {
      thinkingContent.classList.toggle('hidden');
    });
  }

  container.appendChild(row);
  bindCopyCodeButtons(row);
}

function ensureTypingCursor(textEl) {
  let cursor = textEl.querySelector('.typing-cursor');
  if (!cursor) {
    cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    textEl.appendChild(cursor);
  }
}

function removeTypingCursor(scope = document) {
  (scope || document).querySelectorAll('.typing-cursor').forEach(c => c.remove());
}

function updateGeneratingUI() {
  const currentId = state.currentConversationId;
  const isRunning = currentId && state.runningSessionIds.has(currentId);
  state.isGenerating = !!isRunning;

  // 仅在当前查看的会话处于运行中时，才禁用发送按钮
  el.sendBtn.disabled = !!isRunning;

  if (isRunning) {
    el.agentStatusBar.classList.remove('hidden');
    const activeSession = state.activeSessions.get(currentId);
    if (activeSession && activeSession.statusText) {
      updateStatus(activeSession.statusText);
    } else {
      updateStatus('智能体正在执行任务中...');
    }
  } else {
    el.agentStatusBar.classList.add('hidden');
    removeTypingCursor();
  }
}

function setGenerating(generating) {
  if (state.currentConversationId) {
    if (generating) {
      state.runningSessionIds.add(state.currentConversationId);
    } else {
      state.runningSessionIds.delete(state.currentConversationId);
    }
  }
  updateGeneratingUI();
}

function updateStatus(msg) {
  el.statusMessage.textContent = msg;
}

function scrollToBottom() {
  el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  requestAnimationFrame(() => {
    el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  });
}

// --- Workspace Modal & Logic ---
function openWorkspaceModal() {
  el.addWorkspaceModal.classList.remove('hidden');
  el.wsInputPath.focus();
}

function closeWorkspaceModal() {
  el.addWorkspaceModal.classList.add('hidden');
  el.wsValidationFeedback.textContent = '';
  el.wsValidationFeedback.className = 'validation-feedback';
}

async function validateWorkspacePathInput() {
  const p = el.wsInputPath.value.trim();
  if (!p) {
    el.wsValidationFeedback.textContent = '请输入有效路径';
    el.wsValidationFeedback.className = 'validation-feedback invalid';
    return false;
  }

  try {
    el.wsValidationFeedback.textContent = '正在检测服务器路径...';
    el.wsValidationFeedback.className = 'validation-feedback';
    const res = await fetch(`/api/workspaces/validate?path=${encodeURIComponent(p)}`);
    const data = await res.json();

    if (data.exists && data.isDirectory) {
      el.wsValidationFeedback.textContent = `✓ 路径有效: ${data.path} ${data.is_git ? '(Git 仓库)' : ''}`;
      el.wsValidationFeedback.className = 'validation-feedback valid';
      if (!el.wsInputName.value.trim()) {
        el.wsInputName.value = data.name;
      }
      return true;
    } else {
      el.wsValidationFeedback.textContent = `✕ 路径无效: ${data.error || '目录不存在'}`;
      el.wsValidationFeedback.className = 'validation-feedback invalid';
      return false;
    }
  } catch (err) {
    el.wsValidationFeedback.textContent = `✕ 检测出错: ${err.message}`;
    el.wsValidationFeedback.className = 'validation-feedback invalid';
    return false;
  }
}

async function saveNewWorkspace() {
  const isValid = await validateWorkspacePathInput();
  if (!isValid) return;

  const pathVal = el.wsInputPath.value.trim();
  const nameVal = el.wsInputName.value.trim();

  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathVal, name: nameVal })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');

    state.workspaces = data.workspaces;
    renderWorkspacesList();
    setWorkspace(data.workspace);
    closeWorkspaceModal();
  } catch (err) {
    alert('添加工作区失败: ' + err.message);
  }
}

async function deleteWorkspace(ws) {
  try {
    const res = await fetch('/api/workspaces', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: ws.path })
    });
    const data = await res.json();
    state.workspaces = data.workspaces;
    renderWorkspacesList();
    if (state.currentWorkspace?.path === ws.path) {
      if (state.workspaces.length > 0) {
        setWorkspace(state.workspaces[0]);
      }
    }
  } catch (err) {
    alert('移除工作区失败: ' + err.message);
  }
}

// --- Utilities ---
function copyLanUrl() {
  const url = el.copyUrlBtn.dataset.url || window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    const orig = el.navLanUrl.textContent;
    el.navLanUrl.textContent = '已复制!';
    setTimeout(() => el.navLanUrl.textContent = orig, 1500);
  }).catch(() => {
    prompt('局域网访问地址：', url);
  });
}

function bindCopyCodeButtons(container) {
  container.querySelectorAll('.copy-code-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.closest('.code-block-wrap').querySelector('code').textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '已复制!';
        setTimeout(() => btn.textContent = '复制', 1500);
      });
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  return `${Math.floor(diffSec / 86400)}天前`;
}

// Lightweight Markdown Renderer with Code Highlighting
function renderMarkdown(md) {
  if (!md) return '';

  let html = md;

  // Code blocks: ```lang ... ```
  html = html.replace(/```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const langLabel = lang ? lang.toUpperCase() : 'CODE';
    return `
      <div class="code-block-wrap">
        <div class="code-block-header">
          <span>${escapeHtml(langLabel)}</span>
          <button class="copy-code-btn">复制</button>
        </div>
        <pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>
      </div>
    `;
  });

  // Inline code: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Markdown Tables
  html = html.replace(/\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g, (match, headerRow, bodyRows) => {
    const headers = headerRow.split('|').map(h => h.trim()).filter(h => h.length > 0);
    const rows = bodyRows.trim().split('\n').map(r => r.split('|').map(c => c.trim()).filter(c => c.length > 0));
    
    let tableHtml = '<table><thead><tr>';
    headers.forEach(h => tableHtml += `<th>${h}</th>`);
    tableHtml += '</tr></thead><tbody>';
    rows.forEach(r => {
      tableHtml += '<tr>';
      r.forEach(c => tableHtml += `<td>${c}</td>`);
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    return tableHtml;
  });

  // Unordered Lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Line breaks to paragraphs
  html = html.split('\n\n').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<div') || trimmed.startsWith('<ul') || trimmed.startsWith('<table') || trimmed.startsWith('<blockquote')) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

// Start app
window.addEventListener('DOMContentLoaded', init);
