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
  modelFamilies: [],
  hoveredFamilyId: null,
  theme: 'dark',
  attachedImages: [],           // { tempId, filename, url, server_path }
  historyViewMode: localStorage.getItem('agy_history_view_mode') || 'all', // 'all' (按工作区分组) 或 'current' (仅当前工作区)
  collapsedWsGroups: new Set(JSON.parse(localStorage.getItem('agy_collapsed_ws_groups') || '[]')),
  expandedWsGroups: new Set(JSON.parse(localStorage.getItem('agy_expanded_ws_groups') || '[]')),
  workspaceToRename: null,
  accounts: [],
  activeAccountEmail: '',
  accountSearchTerm: '',
  accountFilter: 'all',
  bestAccountInfo: null,
  isSwitchingAccount: false
};

// DOM Elements
const el = {
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  sidebarCollapseBtn: document.getElementById('sidebarCollapseBtn'),
  sidebarExpandBtn: document.getElementById('sidebarExpandBtn'),
  currentWsName: document.getElementById('currentWsName'),
  currentWsPath: document.getElementById('currentWsPath'),
  renameCurrentWsBtn: document.getElementById('renameCurrentWsBtn'),
  workspaceCard: document.getElementById('workspaceCard'),
  workspaceDropdown: document.getElementById('workspaceDropdown'),
  workspaceList: document.getElementById('workspaceList'),
  toggleWsListBtn: document.getElementById('toggleWsListBtn'),
  openAddWorkspaceBtn: document.getElementById('openAddWorkspaceBtn'),
  manageWsBtn: document.getElementById('manageWsBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  historyList: document.getElementById('historyList'),
  refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
  historyTabAll: document.getElementById('historyTabAll'),
  historyTabCurrent: document.getElementById('historyTabCurrent'),
  modelCascaderContainer: document.getElementById('modelCascaderContainer'),
  modelCascaderTrigger: document.getElementById('modelCascaderTrigger'),
  modelTriggerName: document.getElementById('modelTriggerName'),
  modelTriggerEffort: document.getElementById('modelTriggerEffort'),
  modelTriggerMode: document.getElementById('modelTriggerMode'),
  modelCascaderPopover: document.getElementById('modelCascaderPopover'),
  modelCascaderBackdrop: document.getElementById('modelCascaderBackdrop'),
  modelSheetCloseBtn: document.getElementById('modelSheetCloseBtn'),
  modeCardAccept: document.getElementById('modeCardAccept'),
  modeCardPlan: document.getElementById('modeCardPlan'),
  modelFamiliesList: document.getElementById('modelFamiliesList'),
  modelEffortsHeader: document.getElementById('modelEffortsHeader'),
  modelEffortsList: document.getElementById('modelEffortsList'),
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
  navbarWsPill: document.getElementById('navbarWsPill'),
  navbarBreadcrumbs: document.getElementById('navbarBreadcrumbs') || document.querySelector('.navbar-breadcrumbs'),
  navWsPath: document.getElementById('navWsPath'),
  sessionTitle: document.getElementById('sessionTitle'),
  chatContainer: document.getElementById('chatContainer'),
  welcomeView: document.getElementById('welcomeView'),
  welcomeWsBadge: document.getElementById('welcomeWsBadge'),
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
  browseDirBtn: document.getElementById('browseDirBtn'),
  validatePathBtn: document.getElementById('validatePathBtn'),
  wsValidationFeedback: document.getElementById('wsValidationFeedback'),
  saveWorkspaceBtn: document.getElementById('saveWorkspaceBtn'),
  // Modal: Server Directory Picker
  dirPickerModal: document.getElementById('dirPickerModal'),
  closeDirPickerModal: document.getElementById('closeDirPickerModal'),
  cancelDirPickerModal: document.getElementById('cancelDirPickerModal'),
  confirmDirPickerBtn: document.getElementById('confirmDirPickerBtn'),
  dirNavUpBtn: document.getElementById('dirNavUpBtn'),
  dirRefreshBtn: document.getElementById('dirRefreshBtn'),
  dirBreadcrumb: document.getElementById('dirBreadcrumb'),
  dirFilterInput: document.getElementById('dirFilterInput'),
  dirListContainer: document.getElementById('dirListContainer'),
  dirSelectedPathPreview: document.getElementById('dirSelectedPathPreview'),
  // Modal: Rename Workspace
  renameWorkspaceModal: document.getElementById('renameWorkspaceModal'),
  closeRenameWsModal: document.getElementById('closeRenameWsModal'),
  cancelRenameWsModal: document.getElementById('cancelRenameWsModal'),
  renameWsPathPreview: document.getElementById('renameWsPathPreview'),
  renameWsInputName: document.getElementById('renameWsInputName'),
  submitRenameWsBtn: document.getElementById('submitRenameWsBtn'),
  // Modal: Auth
  authModal: document.getElementById('authModal'),
  accessKeyInput: document.getElementById('accessKeyInput'),
  toggleKeyVisibilityBtn: document.getElementById('toggleKeyVisibilityBtn'),
  submitAuthKeyBtn: document.getElementById('submitAuthKeyBtn'),
  authFeedback: document.getElementById('authFeedback'),
  // Modal & Badges: Google Accounts & Quota Switcher
  accountManagerBtn: document.getElementById('accountManagerBtn'),
  navAccountEmail: document.getElementById('navAccountEmail'),
  navAccountQuota: document.getElementById('navAccountQuota'),
  navQuickSwitchBestBtn: document.getElementById('navQuickSwitchBestBtn'),
  composerAccountPill: document.getElementById('composerAccountPill'),
  composerAccountEmail: document.getElementById('composerAccountEmail'),
  composerAccountQuota: document.getElementById('composerAccountQuota'),
  composerQuickBestBtn: document.getElementById('composerQuickBestBtn'),
  sidebarAccountCard: document.getElementById('sidebarAccountCard'),
  sidebarAccountEmail: document.getElementById('sidebarAccountEmail'),
  sidebarSwitchAccountBtn: document.getElementById('sidebarSwitchAccountBtn'),
  accountModal: document.getElementById('accountModal'),
  closeAccountModalBtn: document.getElementById('closeAccountModalBtn'),
  closeAccountModalFooterBtn: document.getElementById('closeAccountModalFooterBtn'),
  accountPoolTotalBadge: document.getElementById('accountPoolTotalBadge'),
  accountSearchInput: document.getElementById('accountSearchInput'),
  accountSearchClearBtn: document.getElementById('accountSearchClearBtn'),
  accountFilterChips: document.getElementById('accountFilterChips'),
  chipCountAll: document.getElementById('chipCountAll'),
  chipCountNormal: document.getElementById('chipCountNormal'),
  chipCountHigh: document.getElementById('chipCountHigh'),
  chipCountPro: document.getElementById('chipCountPro'),
  chipCountLow: document.getElementById('chipCountLow'),
  switchBestAccountBtn: document.getElementById('switchBestAccountBtn'),
  bestQuotaPreviewTag: document.getElementById('bestQuotaPreviewTag'),
  refreshQuotasBtn: document.getElementById('refreshQuotasBtn'),
  currentAccountBanner: document.getElementById('currentAccountBanner'),
  currentAccountBannerEmail: document.getElementById('currentAccountBannerEmail'),
  currentAccountBannerTier: document.getElementById('currentAccountBannerTier'),
  currentAccountBannerQuotas: document.getElementById('currentAccountBannerQuotas'),
  accountListContainer: document.getElementById('accountListContainer'),
  openManagerLink: document.getElementById('openManagerLink'),
  toastContainer: document.getElementById('toastContainer'),
  // Mobile Top Navbar & New Chat Buttons
  mobileNavModelBtn: document.getElementById('mobileNavModelBtn'),
  mobileNavModelName: document.getElementById('mobileNavModelName'),
  mobileNavModelEffort: document.getElementById('mobileNavModelEffort'),
  mobileNewChatBtn: document.getElementById('mobileNewChatBtn'),
  desktopNewChatBtn: document.getElementById('desktopNewChatBtn'),
  composerModeToggleBtn: document.getElementById('composerModeToggleBtn'),
  composerModeText: document.getElementById('composerModeText'),
  // Modal: Unified Settings
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
  closeSettingsModalFooterBtn: document.getElementById('closeSettingsModalFooterBtn'),
  settingsAccountEmail: document.getElementById('settingsAccountEmail'),
  settingsAccountTier: document.getElementById('settingsAccountTier'),
  settingsQuickBestBtn: document.getElementById('settingsQuickBestBtn'),
  settingsOpenAccountPoolBtn: document.getElementById('settingsOpenAccountPoolBtn'),
  settingsRefreshQuotasBtn: document.getElementById('settingsRefreshQuotasBtn'),
  settingsQuotasBars: document.getElementById('settingsQuotasBars'),
  settingsModeAccept: document.getElementById('settingsModeAccept'),
  settingsModePlan: document.getElementById('settingsModePlan'),
  settingsModelSummary: document.getElementById('settingsModelSummary'),
  settingsOpenModelPickerBtn: document.getElementById('settingsOpenModelPickerBtn'),
  settingsWsName: document.getElementById('settingsWsName'),
  settingsWsPath: document.getElementById('settingsWsPath'),
  settingsSwitchWsBtn: document.getElementById('settingsSwitchWsBtn'),
  settingsAddWsBtn: document.getElementById('settingsAddWsBtn'),
  settingsThemeDark: document.getElementById('settingsThemeDark'),
  settingsThemeLight: document.getElementById('settingsThemeLight'),
  settingsLanUrl: document.getElementById('settingsLanUrl'),
  settingsCopyLanBtn: document.getElementById('settingsCopyLanBtn'),
  settingsLockBtn: document.getElementById('settingsLockBtn')
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
  updateNavbarSessionTitle('新会话');
  updateModelTriggerDisplay();

  // Check Auth Status First
  const authOk = await checkAuthStatus();
  if (!authOk) {
    showAuthModal(true);
    return;
  }

  await loadSystemInfo();
  await loadWorkspaces();
  await loadConversations();
  await loadAccounts(true);
  
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

  // 定时每 45 秒静默同步账号池及额度信息
  setInterval(() => {
    loadAccounts(true);
  }, 45000);
}

// --- Sidebar Drawer Manager (Desktop & Mobile) ---
function openSidebar() {
  if (window.innerWidth <= 768) {
    el.sidebar.classList.add('mobile-open');
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.remove('hidden');
    document.body.classList.add('sidebar-drawer-open');
  } else {
    el.sidebar.classList.remove('collapsed');
  }
}

function closeSidebar() {
  if (window.innerWidth <= 768) {
    el.sidebar.classList.remove('mobile-open');
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add('hidden');
    document.body.classList.remove('sidebar-drawer-open');
  } else {
    el.sidebar.classList.add('collapsed');
  }
}

function toggleSidebar() {
  if (window.innerWidth <= 768) {
    if (el.sidebar.classList.contains('mobile-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  } else {
    el.sidebar.classList.toggle('collapsed');
  }
}

// --- Event Listeners ---
function setupEventListeners() {
  // Sidebar Toggle (Desktop & Mobile Drawer)
  el.sidebarCollapseBtn.addEventListener('click', closeSidebar);
  el.sidebarExpandBtn.addEventListener('click', toggleSidebar);
  if (el.sidebarBackdrop) {
    el.sidebarBackdrop.addEventListener('click', closeSidebar);
  }

  // Mobile touch swipe-to-close on sidebar
  let touchStartX = 0;
  let touchStartY = 0;
  if (el.sidebar) {
    el.sidebar.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });
    el.sidebar.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const dx = touchStartX - touchEndX;
      const dy = Math.abs(touchStartY - touchEndY);
      // If swiped left by more than 40px and mostly horizontal
      if (dx > 40 && dy < dx && window.innerWidth <= 768) {
        closeSidebar();
      }
    }, { passive: true });
  }

  // Workspace dropdown toggle
  el.workspaceCard.addEventListener('click', (e) => {
    if (e.target.closest('#openAddWorkspaceBtn')) return;
    el.workspaceDropdown.classList.toggle('hidden');
  });

  // Click on Navbar Workspace Pill toggles workspace dropdown directly
  if (el.navbarWsPill) {
    el.navbarWsPill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.innerWidth <= 768) {
        openSidebar();
        el.workspaceDropdown.classList.remove('hidden');
      } else {
        if (el.sidebar && el.sidebar.classList.contains('collapsed')) {
          el.sidebar.classList.remove('collapsed');
        }
        el.workspaceDropdown.classList.toggle('hidden');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (
      !el.workspaceCard.contains(e.target) &&
      !el.workspaceDropdown.contains(e.target) &&
      !(el.navbarWsPill && el.navbarWsPill.contains(e.target)) &&
      !e.target.closest('#welcomeWsBadge')
    ) {
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

  // Rename Workspace events
  if (el.renameCurrentWsBtn) {
    el.renameCurrentWsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.currentWorkspace) openRenameWorkspaceModal(state.currentWorkspace);
    });
  }
  if (el.closeRenameWsModal) el.closeRenameWsModal.addEventListener('click', closeRenameWorkspaceModal);
  if (el.cancelRenameWsModal) el.cancelRenameWsModal.addEventListener('click', closeRenameWorkspaceModal);
  if (el.submitRenameWsBtn) el.submitRenameWsBtn.addEventListener('click', saveWorkspaceRename);
  if (el.renameWsInputName) {
    el.renameWsInputName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveWorkspaceRename();
      if (e.key === 'Escape') closeRenameWorkspaceModal();
    });
  }

  // Browse Directory button
  if (el.browseDirBtn) {
    el.browseDirBtn.addEventListener('click', () => {
      openDirPickerModal(el.wsInputPath.value.trim());
    });
  }

  // Dir Picker Modal Events
  if (el.closeDirPickerModal) el.closeDirPickerModal.addEventListener('click', closeDirPickerModal);
  if (el.cancelDirPickerModal) el.cancelDirPickerModal.addEventListener('click', closeDirPickerModal);
  if (el.confirmDirPickerBtn) el.confirmDirPickerBtn.addEventListener('click', confirmDirPickerSelection);
  if (el.dirNavUpBtn) {
    el.dirNavUpBtn.addEventListener('click', () => {
      if (dirPickerParentDir) loadServerDirectories(dirPickerParentDir);
    });
  }
  if (el.dirRefreshBtn) {
    el.dirRefreshBtn.addEventListener('click', () => {
      if (dirPickerCurrentDir) loadServerDirectories(dirPickerCurrentDir);
    });
  }
  if (el.dirFilterInput) {
    el.dirFilterInput.addEventListener('input', renderDirList);
  }
  document.querySelectorAll('.dir-quick-bar .btn-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.dir) loadServerDirectories(btn.dataset.dir);
    });
  });
  if (el.dirPickerModal) {
    el.dirPickerModal.addEventListener('click', (e) => {
      if (e.target === el.dirPickerModal) closeDirPickerModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.dirPickerModal && !el.dirPickerModal.classList.contains('hidden')) {
      closeDirPickerModal();
    }
  });

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
  el.refreshHistoryBtn.addEventListener('click', () => loadConversations());

  // History View Tabs (全部分类 / 当前工作区)
  if (el.historyTabAll) {
    el.historyTabAll.addEventListener('click', () => setHistoryViewMode('all'));
  }
  if (el.historyTabCurrent) {
    el.historyTabCurrent.addEventListener('click', () => setHistoryViewMode('current'));
  }

  // Welcome Starter Cards & Quick Chips handling
  const welcomeViewEl = document.getElementById('welcomeView');
  if (welcomeViewEl) {
    welcomeViewEl.addEventListener('click', (e) => {
      const card = e.target.closest('.starter-card');
      if (card && card.dataset.prompt) {
        el.promptInput.value = card.dataset.prompt;
        el.promptInput.style.height = 'auto';
        el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 180) + 'px';
        el.promptInput.focus();
        return;
      }
      const chip = e.target.closest('.quick-chip-btn');
      if (chip) {
        if (chip.dataset.prefix) {
          if (chip.dataset.prefix.includes('/plan')) {
            setExecutionMode('plan');
          }
          el.promptInput.value = chip.dataset.prefix;
        } else if (chip.dataset.prompt) {
          el.promptInput.value = chip.dataset.prompt;
        }
        el.promptInput.style.height = 'auto';
        el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 180) + 'px';
        el.promptInput.focus();
        return;
      }
      const wsBadge = e.target.closest('#welcomeWsBadge');
      if (wsBadge) {
        if (window.innerWidth <= 768) {
          openSidebar();
          el.workspaceDropdown.classList.remove('hidden');
        } else {
          if (el.sidebar && el.sidebar.classList.contains('collapsed')) {
            el.sidebar.classList.remove('collapsed');
          }
          el.workspaceDropdown.classList.toggle('hidden');
        }
        return;
      }
    });
  }

  // Send message or Stop task
  el.sendBtn.addEventListener('click', () => {
    const currentId = state.currentConversationId;
    const isRunning = currentId && state.runningSessionIds.has(currentId);
    if (isRunning) {
      stopAgentExecution();
    } else {
      sendMessage();
    }
  });
  el.promptInput.addEventListener('keydown', (e) => {
    // Check !e.isComposing to avoid prematurely sending while typing Chinese/IME candidates
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const currentId = state.currentConversationId;
      const isRunning = currentId && state.runningSessionIds.has(currentId);
      if (!isRunning) {
        sendMessage();
      }
    }
  });

  // Mobile virtual keyboard & viewport handling
  el.promptInput.addEventListener('focus', () => {
    if (window.innerWidth <= 768) {
      setTimeout(() => {
        scrollToBottom();
      }, 300);
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (document.activeElement === el.promptInput && window.innerWidth <= 768) {
        scrollToBottom();
      }
    });
  }

  window.addEventListener('resize', () => {
    updateModelTriggerDisplay();
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

  // Model Cascader Trigger & Outside Click
  if (el.modelCascaderTrigger) {
    el.modelCascaderTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleModelCascader();
    });
  }

  if (el.modelCascaderBackdrop) {
    el.modelCascaderBackdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModelCascader();
    });
  }
  if (el.modelSheetCloseBtn) {
    el.modelSheetCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModelCascader();
    });
  }

  document.addEventListener('click', (e) => {
    if (!el.modelCascaderPopover || el.modelCascaderPopover.classList.contains('hidden')) return;
    const inContainer = el.modelCascaderContainer && el.modelCascaderContainer.contains(e.target);
    const inMobileBtn = el.mobileNavModelBtn && el.mobileNavModelBtn.contains(e.target);
    const inSettingsBtn = el.settingsOpenModelPickerBtn && el.settingsOpenModelPickerBtn.contains(e.target);
    if (!inContainer && !inMobileBtn && !inSettingsBtn) {
      closeModelCascader();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.modelCascaderPopover && !el.modelCascaderPopover.classList.contains('hidden')) {
      closeModelCascader();
    }
  });

  // Model & Mode selections
  if (el.modelSelect) {
    el.modelSelect.addEventListener('change', () => {
      state.activeModel = el.modelSelect.value;
      localStorage.setItem('agy_model', state.activeModel);
      updateModelTriggerDisplay();
    });
  }
  if (el.modeSelect) {
    el.modeSelect.addEventListener('change', () => {
      setExecutionMode(el.modeSelect.value);
    });
  }
  if (el.effortSelect) {
    el.effortSelect.addEventListener('change', () => {
      state.activeEffort = el.effortSelect.value;
      localStorage.setItem('agy_effort', state.activeEffort);
      updateModelTriggerDisplay();
    });
  }

  // Execution Mode Cards in Modal
  if (el.modeCardAccept) {
    el.modeCardAccept.addEventListener('click', () => {
      setExecutionMode('accept-edits');
    });
  }
  if (el.modeCardPlan) {
    el.modeCardPlan.addEventListener('click', () => {
      setExecutionMode('plan');
    });
  }

  // Mobile/Browser Tab Visibility & Resume Sync (后台继续执行并恢复同步)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncForegroundOnResume();
    }
  });
  window.addEventListener('pageshow', () => {
    syncForegroundOnResume();
  });
  window.addEventListener('focus', () => {
    syncForegroundOnResume();
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
  if (el.fileImageInput) {
    // Stop click bubbling on input to prevent recursion with button wrapper
    el.fileImageInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    el.fileImageInput.addEventListener('change', () => {
      if (el.fileImageInput.files && el.fileImageInput.files.length > 0) {
        for (let i = 0; i < el.fileImageInput.files.length; i++) {
          uploadAndAttachFile(el.fileImageInput.files[i]);
        }
        el.fileImageInput.value = '';
      }
    });
  }

  if (el.uploadImageBtn) {
    el.uploadImageBtn.addEventListener('click', (e) => {
      if (e.target !== el.fileImageInput && el.fileImageInput) {
        el.fileImageInput.click();
      }
    });
  }

  // Account Modal & Manager Events
  if (el.accountManagerBtn) {
    el.accountManagerBtn.addEventListener('click', openAccountModal);
  }
  if (el.navQuickSwitchBestBtn) {
    el.navQuickSwitchBestBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchToBestAccount();
    });
  }
  if (el.composerAccountPill) {
    el.composerAccountPill.addEventListener('click', openAccountModal);
  }
  if (el.composerQuickBestBtn) {
    el.composerQuickBestBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchToBestAccount();
    });
  }
  if (el.sidebarAccountCard) {
    el.sidebarAccountCard.addEventListener('click', openAccountModal);
  }
  if (el.sidebarSwitchAccountBtn) {
    el.sidebarSwitchAccountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAccountModal();
    });
  }
  if (el.closeAccountModalBtn) {
    el.closeAccountModalBtn.addEventListener('click', closeAccountModal);
  }
  if (el.closeAccountModalFooterBtn) {
    el.closeAccountModalFooterBtn.addEventListener('click', closeAccountModal);
  }
  if (el.accountModal) {
    el.accountModal.addEventListener('click', (e) => {
      if (e.target === el.accountModal) closeAccountModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.accountModal && !el.accountModal.classList.contains('hidden')) {
      closeAccountModal();
    }
  });
  if (el.accountSearchInput) {
    el.accountSearchInput.addEventListener('input', (e) => {
      state.accountSearchTerm = e.target.value;
      if (el.accountSearchClearBtn) {
        if (state.accountSearchTerm) el.accountSearchClearBtn.classList.remove('hidden');
        else el.accountSearchClearBtn.classList.add('hidden');
      }
      renderAccountModal();
    });
  }
  if (el.accountSearchClearBtn) {
    el.accountSearchClearBtn.addEventListener('click', () => {
      if (el.accountSearchInput) el.accountSearchInput.value = '';
      state.accountSearchTerm = '';
      el.accountSearchClearBtn.classList.add('hidden');
      renderAccountModal();
    });
  }
  if (el.accountFilterChips) {
    el.accountFilterChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      const filter = chip.dataset.filter || 'all';
      state.accountFilter = filter;
      el.accountFilterChips.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderAccountModal();
    });
  }

  // Mobile Bottom Sheet Pull-to-Close gesture
  const sheetHandle = document.querySelector('.account-sheet-handle');
  if (sheetHandle) {
    let startY = 0;
    sheetHandle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    sheetHandle.addEventListener('touchmove', (e) => {
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY > 55) {
        closeAccountModal();
      }
    }, { passive: true });
  }

  if (el.switchBestAccountBtn) {
    el.switchBestAccountBtn.addEventListener('click', async () => {
      await switchToBestAccount();
    });
  }
  if (el.refreshQuotasBtn) {
    el.refreshQuotasBtn.addEventListener('click', refreshQuotas);
  }

  // --- Settings Modal Listeners ---
  if (el.settingsBtn) {
    el.settingsBtn.addEventListener('click', openSettingsModal);
  }
  const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  if (sidebarSettingsBtn) {
    sidebarSettingsBtn.addEventListener('click', () => {
      closeSidebar();
      openSettingsModal();
    });
  }
  if (el.closeSettingsModalBtn) {
    el.closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
  }
  if (el.closeSettingsModalFooterBtn) {
    el.closeSettingsModalFooterBtn.addEventListener('click', closeSettingsModal);
  }
  if (el.settingsModal) {
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) closeSettingsModal();
    });
  }
  if (el.settingsQuickBestBtn) {
    el.settingsQuickBestBtn.addEventListener('click', () => {
      switchToBestAccount((success) => {
        if (success) updateSettingsModal();
      });
    });
  }
  if (el.settingsOpenAccountPoolBtn) {
    el.settingsOpenAccountPoolBtn.addEventListener('click', () => {
      closeSettingsModal();
      openAccountModal();
    });
  }
  if (el.settingsRefreshQuotasBtn) {
    el.settingsRefreshQuotasBtn.addEventListener('click', async () => {
      await refreshQuotas();
      updateSettingsModal();
    });
  }
  if (el.settingsModeAccept) {
    el.settingsModeAccept.addEventListener('click', () => {
      setExecutionMode('accept-edits');
      showToast('已切换至：⚡ 自动执行模式', 'info', 2000);
    });
  }
  if (el.settingsModePlan) {
    el.settingsModePlan.addEventListener('click', () => {
      setExecutionMode('plan');
      showToast('已切换至：📋 仅规划模式', 'info', 2000);
    });
  }
  if (el.settingsOpenModelPickerBtn) {
    el.settingsOpenModelPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeSettingsModal();
      setTimeout(() => {
        openModelCascader();
      }, 60);
    });
  }
  if (el.settingsSwitchWsBtn) {
    el.settingsSwitchWsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSettingsModal();
      if (window.innerWidth <= 768) {
        openSidebar();
        el.workspaceDropdown.classList.remove('hidden');
      } else {
        if (el.sidebar && el.sidebar.classList.contains('collapsed')) {
          el.sidebar.classList.remove('collapsed');
        }
        el.workspaceDropdown.classList.remove('hidden');
      }
    });
  }
  if (el.settingsAddWsBtn) {
    el.settingsAddWsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSettingsModal();
      openAddWorkspaceModal();
    });
  }
  if (el.settingsThemeDark) {
    el.settingsThemeDark.addEventListener('click', () => setTheme('dark'));
  }
  if (el.settingsThemeLight) {
    el.settingsThemeLight.addEventListener('click', () => setTheme('light'));
  }
  if (el.settingsCopyLanBtn) {
    el.settingsCopyLanBtn.addEventListener('click', copyLanUrl);
  }
  if (el.settingsLockBtn) {
    el.settingsLockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSettingsModal();
      if (currentAccessToken) {
        currentAccessToken = '';
        localStorage.removeItem('agy_access_token');
        updateAuthBadge(false);
        showAuthModal(true);
        showToast('控制台已锁定', 'info', 2500);
      }
    });
  }

  // Mobile Top Model Pill Trigger
  if (el.mobileNavModelBtn) {
    el.mobileNavModelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleModelCascader();
    });
  }

  // Mobile & Desktop New Chat Buttons
  if (el.mobileNewChatBtn) {
    el.mobileNewChatBtn.addEventListener('click', () => {
      closeSidebar();
      startNewChat();
    });
  }
  if (el.desktopNewChatBtn) {
    el.desktopNewChatBtn.addEventListener('click', () => {
      startNewChat();
    });
  }

  // Mobile Composer Mode Toggle Chip
  if (el.composerModeToggleBtn) {
    el.composerModeToggleBtn.addEventListener('click', () => {
      const nextMode = state.activeMode === 'plan' ? 'accept-edits' : 'plan';
      setExecutionMode(nextMode);
      showToast(nextMode === 'plan' ? '已切换至：📋 仅规划模式' : '已切换至：⚡ 自动执行模式', 'info', 2000);
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

  if (el.settingsThemeDark) el.settingsThemeDark.classList.toggle('active', themeName === 'dark');
  if (el.settingsThemeLight) el.settingsThemeLight.classList.toggle('active', themeName === 'light');
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

    // Point openManagerLink to port 8088 on current host
    if (el.openManagerLink) {
      el.openManagerLink.href = `http://${window.location.hostname}:8088/`;
    }

    // Populate Models & Cascader
    state.modelFamilies = (data.model_families && data.model_families.length > 0)
      ? data.model_families
      : MODEL_FAMILIES_FALLBACK;

    // Backward compatibility for hidden modelSelect
    if (el.modelSelect) {
      el.modelSelect.innerHTML = '';
      (data.models || []).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        el.modelSelect.appendChild(opt);
      });
    }

    // Restore saved model & effort
    const savedModel = localStorage.getItem('agy_model');
    const savedEffort = localStorage.getItem('agy_effort');

    if (savedModel && findEffortByModelId(savedModel)) {
      state.activeModel = savedModel;
      const foundEff = findEffortByModelId(savedModel);
      if (foundEff) state.activeEffort = foundEff.effort;
    } else {
      state.activeModel = 'gemini-3.8-flash-high';
      state.activeEffort = 'high';
    }

    if (savedEffort) {
      state.activeEffort = savedEffort;
    }

    if (el.modelSelect) el.modelSelect.value = state.activeModel;
    if (el.effortSelect) el.effortSelect.value = state.activeEffort;

    // Update the trigger pill display
    updateModelTriggerDisplay();

    // Restore mode
    const savedMode = localStorage.getItem('agy_mode');
    if (savedMode) {
      if (el.modeSelect) el.modeSelect.value = savedMode;
      state.activeMode = savedMode;
    }
    updateModeCardsDisplay();
    updateModelTriggerDisplay();

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

// --- Google Account Management & Quota Switching ---

function getQuotaColorClass(pct) {
  if (pct == null) return 'muted';
  if (pct <= 15) return 'danger';
  if (pct <= 50) return 'warning';
  return 'success';
}

function showToast(message, type = 'info', duration = 3000) {
  const container = el.toastContainer || document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  let icon = 'ℹ️';
  if (type === 'success') icon = '✓';
  else if (type === 'warning') icon = '⚠️';
  else if (type === 'error') icon = '✕';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

async function loadAccounts(silent = false) {
  try {
    const res = await fetch('/api/account-manager/accounts');
    if (!res.ok) {
      if (!silent) console.warn('Account manager accounts endpoint returned', res.status);
      return;
    }
    const data = await res.json();
    state.accounts = data.accounts || [];
    state.activeAccountEmail = data.active_email || '';

    updateNavbarAccountBadge();
    updateComposerAccountBadge();
    updateSidebarAccountBadge();
    updateBestAccountPreview();
    updateSettingsModal();

    // If modal is open, re-render list
    if (el.accountModal && !el.accountModal.classList.contains('hidden')) {
      renderAccountModal();
    }
  } catch (err) {
    if (!silent) console.warn('Failed to load accounts from manager:', err);
  }
}

function getAccountQuotas(acc) {
  const cq = acc?.cached_quota || {};
  const q = cq.quota || {};
  const claudePct = q.claude?.remaining_pct != null ? q.claude.remaining_pct : null;
  const proPct = q.gemini_pro?.remaining_pct != null ? q.gemini_pro.remaining_pct : null;
  const flashPct = q.gemini_flash?.remaining_pct != null ? q.gemini_flash.remaining_pct : null;
  const tier = cq.tier || 'PRO';
  const isForbidden = cq.is_forbidden || false;
  const error = cq.error || null;
  return { claudePct, proPct, flashPct, tier, isForbidden, error };
}

function updateNavbarAccountBadge() {
  if (!el.navAccountEmail || !el.navAccountQuota) return;
  const activeAcc = state.accounts.find(a => a.is_active || a.email === state.activeAccountEmail);
  if (!activeAcc) {
    if (state.activeAccountEmail) {
      el.navAccountEmail.textContent = state.activeAccountEmail.split('@')[0];
      el.navAccountEmail.title = state.activeAccountEmail;
    } else {
      el.navAccountEmail.textContent = '未配置账号';
      el.navAccountEmail.title = '未关联 Google 账号';
    }
    el.navAccountQuota.textContent = '--';
    el.navAccountQuota.className = 'account-quota-badge';
    return;
  }

  const { claudePct, proPct } = getAccountQuotas(activeAcc);
  el.navAccountEmail.textContent = activeAcc.email.split('@')[0];
  el.navAccountEmail.title = `当前活跃账号: ${activeAcc.email}`;

  let quotaText = '';
  let badgeClass = 'account-quota-badge';

  if (claudePct !== null && proPct !== null) {
    quotaText = `C:${claudePct}% P:${proPct}%`;
    const minPct = Math.min(claudePct, proPct);
    badgeClass += ' ' + getQuotaColorClass(minPct);
  } else if (claudePct !== null) {
    quotaText = `Claude:${claudePct}%`;
    badgeClass += ' ' + getQuotaColorClass(claudePct);
  } else if (proPct !== null) {
    quotaText = `Pro:${proPct}%`;
    badgeClass += ' ' + getQuotaColorClass(proPct);
  } else {
    quotaText = '正常';
    badgeClass += ' success';
  }

  el.navAccountQuota.textContent = quotaText;
  el.navAccountQuota.className = badgeClass;
  el.navAccountQuota.title = `Claude: ${claudePct ?? '?'}% · Gemini Pro: ${proPct ?? '?'}%`;
}

function updateComposerAccountBadge() {
  if (!el.composerAccountEmail || !el.composerAccountQuota) return;
  const activeAcc = state.accounts.find(a => a.is_active || a.email === state.activeAccountEmail);
  if (!activeAcc) {
    el.composerAccountEmail.textContent = state.activeAccountEmail ? state.activeAccountEmail.split('@')[0] : '未选账号';
    el.composerAccountQuota.textContent = '--';
    el.composerAccountQuota.className = 'cap-quota';
    return;
  }
  const { claudePct, proPct } = getAccountQuotas(activeAcc);
  el.composerAccountEmail.textContent = activeAcc.email.split('@')[0];
  const maxPct = Math.max(claudePct != null ? claudePct : 0, proPct != null ? proPct : 0);
  el.composerAccountQuota.textContent = `${maxPct}%`;
  el.composerAccountQuota.className = `cap-quota ${getQuotaColorClass(maxPct)}`;
}

function updateSidebarAccountBadge() {
  if (!el.sidebarAccountEmail) return;
  const activeAcc = state.accounts.find(a => a.is_active || a.email === state.activeAccountEmail);
  if (activeAcc) {
    el.sidebarAccountEmail.textContent = activeAcc.email;
    el.sidebarAccountEmail.title = activeAcc.email;
  } else if (state.activeAccountEmail) {
    el.sidebarAccountEmail.textContent = state.activeAccountEmail;
    el.sidebarAccountEmail.title = state.activeAccountEmail;
  } else {
    el.sidebarAccountEmail.textContent = '账号管理中...';
  }
}

async function updateBestAccountPreview() {
  if (!el.bestQuotaPreviewTag) return;
  try {
    const res = await fetch('/api/account-manager/best');
    if (!res.ok) return;
    const data = await res.json();
    state.bestAccountInfo = data;
    if (data.email && data.avg_remaining_pct != null) {
      el.bestQuotaPreviewTag.textContent = `${Math.round(data.avg_remaining_pct)}%`;
      if (el.switchBestAccountBtn) {
        el.switchBestAccountBtn.title = `一键切换至当前最佳账号: ${data.email} (平均配额: ${Math.round(data.avg_remaining_pct)}%)`;
      }
    }
  } catch (e) {}
}

function openAccountModal() {
  if (!el.accountModal) return;
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
  el.accountModal.classList.remove('hidden');
  if (el.accountSearchInput) {
    el.accountSearchInput.value = '';
    state.accountSearchTerm = '';
  }
  loadAccounts();
  renderAccountModal();
  setTimeout(() => {
    if (window.innerWidth > 768 && el.accountSearchInput) {
      el.accountSearchInput.focus();
    }
  }, 100);
}

function closeAccountModal() {
  if (!el.accountModal) return;
  el.accountModal.classList.add('hidden');
}

function openSettingsModal() {
  if (!el.settingsModal) return;
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
  updateSettingsModal();
  el.settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  if (!el.settingsModal) return;
  el.settingsModal.classList.add('hidden');
}

function updateSettingsModal() {
  // 1. Account & Quotas
  const activeAcc = state.accounts.find(a => a.is_active || a.email === state.activeAccountEmail);
  if (el.settingsAccountEmail) {
    if (activeAcc) {
      el.settingsAccountEmail.textContent = activeAcc.email;
      el.settingsAccountEmail.title = activeAcc.email;
    } else if (state.activeAccountEmail) {
      el.settingsAccountEmail.textContent = state.activeAccountEmail;
      el.settingsAccountEmail.title = state.activeAccountEmail;
    } else {
      el.settingsAccountEmail.textContent = '未选定账号';
    }
  }

  if (el.settingsAccountTier) {
    if (activeAcc) {
      const { tier } = getAccountQuotas(activeAcc);
      let tierLabel = tier || 'PRO';
      if (tierLabel.toLowerCase().includes('g1-pro') || tierLabel.toLowerCase().includes('g1_pro')) {
        tierLabel = 'Google One Pro 会员';
      } else if (tierLabel.toLowerCase().includes('pro')) {
        tierLabel = 'Pro 高级会员';
      } else if (tierLabel.toLowerCase().includes('free')) {
        tierLabel = '免费标准版';
      }
      el.settingsAccountTier.textContent = tierLabel;
    } else {
      el.settingsAccountTier.textContent = 'Pro 高级会员';
    }
  }

  if (el.settingsQuotasBars) {
    if (activeAcc) {
      const { claudePct, proPct, flashPct } = getAccountQuotas(activeAcc);
      const getFillColor = (pct) => {
        if (pct === null || pct === undefined) return '#94a3b8';
        if (pct <= 0) return 'var(--danger)';
        if (pct < 20) return 'var(--warning)';
        return 'var(--success)';
      };

      el.settingsQuotasBars.innerHTML = `
        <div class="settings-quota-item">
          <div class="settings-quota-label">
            <span>Claude</span>
            <span class="settings-quota-val" style="color:${getFillColor(claudePct)}">${claudePct !== null ? claudePct + '%' : '--'}</span>
          </div>
          <div class="settings-quota-track">
            <div class="settings-quota-fill" style="width:${Math.max(0, Math.min(100, claudePct || 0))}%; background-color:${getFillColor(claudePct)};"></div>
          </div>
        </div>
        <div class="settings-quota-item">
          <div class="settings-quota-label">
            <span>Gemini Pro</span>
            <span class="settings-quota-val" style="color:${getFillColor(proPct)}">${proPct !== null ? proPct + '%' : '--'}</span>
          </div>
          <div class="settings-quota-track">
            <div class="settings-quota-fill" style="width:${Math.max(0, Math.min(100, proPct || 0))}%; background-color:${getFillColor(proPct)};"></div>
          </div>
        </div>
        <div class="settings-quota-item">
          <div class="settings-quota-label">
            <span>Flash</span>
            <span class="settings-quota-val" style="color:${getFillColor(flashPct)}">${flashPct !== null ? flashPct + '%' : '--'}</span>
          </div>
          <div class="settings-quota-track">
            <div class="settings-quota-fill" style="width:${Math.max(0, Math.min(100, flashPct || 0))}%; background-color:${getFillColor(flashPct)};"></div>
          </div>
        </div>
      `;
    } else {
      el.settingsQuotasBars.innerHTML = '<span style="color:var(--text-dim);font-size:12px;padding:4px 0;">暂无配额详情</span>';
    }
  }

  // 2. Execution Mode & Model
  const isPlan = state.activeMode === 'plan';
  if (el.settingsModeAccept) el.settingsModeAccept.classList.toggle('active', !isPlan);
  if (el.settingsModePlan) el.settingsModePlan.classList.toggle('active', isPlan);

  const family = findFamilyByModelId(state.activeModel);
  const effort = findEffortByModelId(state.activeModel);
  if (el.settingsModelSummary) {
    const fName = family ? family.name : state.activeModel;
    const eLabel = effort ? effort.label : state.activeEffort;
    el.settingsModelSummary.textContent = `${fName} · ${eLabel}`;
  }

  // 3. Workspace
  if (state.currentWorkspace) {
    if (el.settingsWsName) el.settingsWsName.textContent = state.currentWorkspace.name || '工作区';
    if (el.settingsWsPath) el.settingsWsPath.textContent = state.currentWorkspace.path || '';
  }

  // 4. Theme
  const isDark = state.theme === 'dark';
  if (el.settingsThemeDark) el.settingsThemeDark.classList.toggle('active', isDark);
  if (el.settingsThemeLight) el.settingsThemeLight.classList.toggle('active', !isDark);

  // 5. LAN URL
  if (el.settingsLanUrl && el.navLanUrl) {
    el.settingsLanUrl.textContent = el.navLanUrl.textContent || window.location.origin;
  }
}

function renderAccountModal() {
  if (!el.accountListContainer) return;

  const activeAcc = state.accounts.find(a => a.is_active || a.email === state.activeAccountEmail);
  
  // Total badge
  if (el.accountPoolTotalBadge) {
    el.accountPoolTotalBadge.textContent = `${state.accounts.length}个`;
  }

  // Filter counts
  if (el.chipCountAll) el.chipCountAll.textContent = state.accounts.length;
  if (el.chipCountNormal) el.chipCountNormal.textContent = state.accounts.filter(a => a.status !== 'abnormal').length;
  if (el.chipCountHigh) {
    el.chipCountHigh.textContent = state.accounts.filter(a => {
      const q = getAccountQuotas(a);
      return Math.max(q.claudePct || 0, q.proPct || 0) >= 70;
    }).length;
  }
  if (el.chipCountPro) {
    el.chipCountPro.textContent = state.accounts.filter(a => {
      const t = (a.cached_quota?.tier || '').toLowerCase();
      return t.includes('pro');
    }).length;
  }
  if (el.chipCountLow) {
    el.chipCountLow.textContent = state.accounts.filter(a => {
      const q = getAccountQuotas(a);
      return Math.max(q.claudePct || 0, q.proPct || 0) <= 30;
    }).length;
  }

  // Render Current Active Account Spotlight
  if (el.currentAccountBannerEmail) {
    if (activeAcc) {
      el.currentAccountBannerEmail.textContent = activeAcc.email;
      const { claudePct, proPct, flashPct, tier } = getAccountQuotas(activeAcc);
      if (el.currentAccountBannerTier) {
        el.currentAccountBannerTier.textContent = tier.toUpperCase();
      }
      if (el.currentAccountBannerQuotas) {
        const cColor = getQuotaColorClass(claudePct);
        const pColor = getQuotaColorClass(proPct);
        const fColor = getQuotaColorClass(flashPct);
        el.currentAccountBannerQuotas.innerHTML = `
          <div class="quota-chip ${cColor}">
            <div class="qc-header">
              <span class="qc-name">Claude Sonnet</span>
              <span class="qc-val">${claudePct != null ? claudePct + '%' : '无'}</span>
            </div>
            <div class="qc-bar-track">
              <div class="qc-bar-fill ${cColor}" style="width: ${claudePct ?? 0}%"></div>
            </div>
          </div>
          <div class="quota-chip ${pColor}">
            <div class="qc-header">
              <span class="qc-name">Gemini Pro</span>
              <span class="qc-val">${proPct != null ? proPct + '%' : '无'}</span>
            </div>
            <div class="qc-bar-track">
              <div class="qc-bar-fill ${pColor}" style="width: ${proPct ?? 0}%"></div>
            </div>
          </div>
          <div class="quota-chip ${fColor}">
            <div class="qc-header">
              <span class="qc-name">Gemini Flash</span>
              <span class="qc-val">${flashPct != null ? flashPct + '%' : '无'}</span>
            </div>
            <div class="qc-bar-track">
              <div class="qc-bar-fill ${fColor}" style="width: ${flashPct ?? 0}%"></div>
            </div>
          </div>
        `;
      }
    } else {
      el.currentAccountBannerEmail.textContent = state.activeAccountEmail || '未选定账号';
      if (el.currentAccountBannerQuotas) {
        el.currentAccountBannerQuotas.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">暂无配额详情</span>';
      }
    }
  }

  // Filter accounts
  const query = (state.accountSearchTerm || '').trim().toLowerCase();
  const filter = state.accountFilter || 'all';
  let list = [...state.accounts];

  // Apply search query
  if (query) {
    list = list.filter(a => {
      const email = (a.email || '').toLowerCase();
      const status = (a.status || '').toLowerCase();
      const note = (a.status_note || '').toLowerCase();
      const tier = (a.cached_quota?.tier || '').toLowerCase();
      return email.includes(query) || status.includes(query) || note.includes(query) || tier.includes(query);
    });
  }

  // Apply quick category filter
  if (filter === 'normal') {
    list = list.filter(a => a.status !== 'abnormal');
  } else if (filter === 'high') {
    list = list.filter(a => {
      const q = getAccountQuotas(a);
      return Math.max(q.claudePct || 0, q.proPct || 0) >= 70;
    });
  } else if (filter === 'pro') {
    list = list.filter(a => {
      const t = (a.cached_quota?.tier || '').toLowerCase();
      return t.includes('pro');
    });
  } else if (filter === 'low') {
    list = list.filter(a => {
      const q = getAccountQuotas(a);
      return Math.max(q.claudePct || 0, q.proPct || 0) <= 30;
    });
  }

  // Sort: Active first, then higher quotas descending, abnormal last
  list.sort((a, b) => {
    const aIsActive = a.is_active || a.email === state.activeAccountEmail;
    const bIsActive = b.is_active || b.email === state.activeAccountEmail;
    if (aIsActive) return -1;
    if (bIsActive) return 1;
    if (a.status === 'abnormal' && b.status !== 'abnormal') return 1;
    if (a.status !== 'abnormal' && b.status === 'abnormal') return -1;
    
    const qa = getAccountQuotas(a);
    const qb = getAccountQuotas(b);
    const maxA = Math.max(qa.claudePct || 0, qa.proPct || 0);
    const maxB = Math.max(qb.claudePct || 0, qb.proPct || 0);
    return maxB - maxA;
  });

  if (list.length === 0) {
    el.accountListContainer.innerHTML = `
      <div class="account-empty-state" style="text-align:center;padding:24px 10px;color:var(--text-dim);font-size:12.5px;">
        ${query ? `未搜索到匹配 "${escapeHtml(query)}" 的账号` : '暂无匹配此筛选条件的账号'}
      </div>
    `;
    return;
  }

  let html = '';
  list.forEach(acc => {
    const isActive = acc.is_active || acc.email === state.activeAccountEmail;
    const isAbnormal = acc.status === 'abnormal';
    const { claudePct, proPct, flashPct, tier } = getAccountQuotas(acc);
    const cColor = getQuotaColorClass(claudePct);
    const pColor = getQuotaColorClass(proPct);
    const fColor = getQuotaColorClass(flashPct);

    html += `
      <div class="account-item-card ${isActive ? 'is-active' : ''} ${isAbnormal ? 'is-abnormal' : ''}" data-email="${escapeHtml(acc.email)}" title="${isActive ? '当前活跃账号' : '点击直接切换到此账号'}">
        <div class="acc-card-left">
          <div class="acc-header-row">
            <span class="acc-status-indicator ${isActive ? 'online' : isAbnormal ? 'abnormal' : 'normal'}"></span>
            <span class="acc-email-text">${escapeHtml(acc.email)}</span>
            <span class="acc-tier-pill ${escapeHtml(tier.toLowerCase())}">${escapeHtml(tier)}</span>
            ${isActive ? '<span class="acc-using-pill">使用中</span>' : ''}
          </div>
          <div class="acc-meters-row">
            <div class="acc-meter-item">
              <span class="acc-meter-name">Claude:</span>
              <div class="acc-meter-track">
                <div class="acc-meter-fill ${cColor}" style="width: ${claudePct ?? 0}%"></div>
              </div>
              <span class="acc-meter-val ${cColor}">${claudePct != null ? claudePct + '%' : '--'}</span>
            </div>
            <div class="acc-meter-item">
              <span class="acc-meter-name">Pro:</span>
              <div class="acc-meter-track">
                <div class="acc-meter-fill ${pColor}" style="width: ${proPct ?? 0}%"></div>
              </div>
              <span class="acc-meter-val ${pColor}">${proPct != null ? proPct + '%' : '--'}</span>
            </div>
            <div class="acc-meter-item">
              <span class="acc-meter-name">Flash:</span>
              <div class="acc-meter-track">
                <div class="acc-meter-fill ${fColor}" style="width: ${flashPct ?? 0}%"></div>
              </div>
              <span class="acc-meter-val ${fColor}">${flashPct != null ? flashPct + '%' : '--'}</span>
            </div>
          </div>
        </div>
        <div class="acc-card-right">
          ${isActive ? `
            <div class="acc-active-check">✓ 当前</div>
          ` : `
            <button type="button" class="btn btn-primary btn-xs btn-switch-account" data-email="${escapeHtml(acc.email)}">
              切换
            </button>
          `}
        </div>
      </div>
    `;
  });

  el.accountListContainer.innerHTML = html;

  // Clicking anywhere on the card switches to that account
  el.accountListContainer.querySelectorAll('.account-item-card:not(.is-active)').forEach(card => {
    card.addEventListener('click', async () => {
      const email = card.dataset.email;
      if (!email) return;
      const btn = card.querySelector('.btn-switch-account');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '切换中...';
      }
      await switchAccount(email);
    });
  });
}

async function switchAccount(email, onComplete = null) {
  if (state.isSwitchingAccount) return;
  state.isSwitchingAccount = true;
  updateStatus(`正在切换至账号 ${email}...`);
  showToast(`正在切换至账号 ${email.split('@')[0]}...`, 'info', 2000);

  try {
    const res = await fetch('/api/account-manager/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.detail || '切换失败');
    }

    state.activeAccountEmail = email;
    await loadAccounts(true);
    updateStatus(`✓ 已切换至账号: ${email}`);
    showToast(`✓ 已成功切换至账号: ${email}`, 'success', 3000);

    closeAccountModal();

    if (typeof onComplete === 'function') {
      onComplete(true, email);
    }
  } catch (err) {
    console.error('Account switch failed:', err);
    showToast(`切换账号失败: ${err.message}`, 'error', 4000);
    updateStatus(`切换失败: ${err.message}`);
    if (typeof onComplete === 'function') {
      onComplete(false, err);
    }
  } finally {
    state.isSwitchingAccount = false;
  }
}

async function switchToBestAccount(onComplete = null) {
  if (state.isSwitchingAccount) return;
  updateStatus('正在查询配额最高最佳账号...');
  showToast('正在查询配额最佳账号...', 'info', 1500);

  try {
    const res = await fetch('/api/account-manager/best');
    const data = await res.json();
    if (!res.ok || !data.email) {
      throw new Error(data.error || data.detail || '无法获取最佳账号');
    }

    const bestEmail = data.email;
    if (bestEmail === state.activeAccountEmail) {
      updateStatus(`当前账号已是最佳状态 (${bestEmail})`);
      showToast(`当前账号 (${bestEmail.split('@')[0]}) 额度已是最高状态`, 'success', 2500);
      if (typeof onComplete === 'function') {
        onComplete(true, bestEmail);
      }
      return;
    }

    await switchAccount(bestEmail, onComplete);
  } catch (err) {
    console.error('Failed to get best account:', err);
    showToast(`获取最佳账号失败: ${err.message}`, 'error', 4000);
    if (typeof onComplete === 'function') {
      onComplete(false, err);
    }
  }
}

async function refreshQuotas() {
  if (!el.refreshQuotasBtn) return;
  const origText = el.refreshQuotasBtn.textContent;
  el.refreshQuotasBtn.disabled = true;
  el.refreshQuotasBtn.textContent = '正在刷新...';
  try {
    await fetch('/api/account-manager/quota/refresh', { method: 'POST' });
    updateStatus('已发起全量额度刷新，后台正在检测...');
    setTimeout(async () => {
      await loadAccounts(true);
      if (el.refreshQuotasBtn) {
        el.refreshQuotasBtn.disabled = false;
        el.refreshQuotasBtn.textContent = origText;
      }
    }, 2500);
  } catch (err) {
    console.warn('Refresh quotas error:', err);
    if (el.refreshQuotasBtn) {
      el.refreshQuotasBtn.disabled = false;
      el.refreshQuotasBtn.textContent = origText;
    }
  }
}

function showQuotaExhaustedCard(session, errorMsg = '') {
  if (!session || !session.currentStreamMessage) return;
  const bodyEl = session.currentStreamMessage.bodyEl;
  if (!bodyEl) return;

  if (bodyEl.querySelector('.quota-exhausted-card')) {
    return;
  }

  const card = document.createElement('div');
  card.className = 'quota-exhausted-card';

  let displayMsg = '当前账号可用配额已耗尽或触发速率限制 (429 / Resource Exhausted)。可随时一键切换账号继续任务。';
  if (errorMsg) {
    try {
      const parsed = typeof errorMsg === 'string' ? JSON.parse(errorMsg) : errorMsg;
      if (parsed.message) displayMsg = parsed.message;
      else if (parsed.error) displayMsg = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || displayMsg;
    } catch (e) {
      displayMsg = String(errorMsg).slice(0, 160);
    }
  }

  card.innerHTML = `
    <div class="qec-header">
      <span class="qec-icon">⚠️</span>
      <div class="qec-title-wrap">
        <div class="qec-title">智能体请求配额已耗尽 (Resource Exhausted)</div>
        <div class="qec-desc">${escapeHtml(displayMsg)}</div>
      </div>
    </div>
    <div class="qec-actions">
      <button type="button" class="qec-btn-best">
        <span>⚡ 一键切换最佳账号并重试</span>
      </button>
      <button type="button" class="qec-btn-select">
        <span>👤 挑选账号...</span>
      </button>
    </div>
  `;

  bodyEl.appendChild(card);
  scrollToBottom();

  const bestBtn = card.querySelector('.qec-btn-best');
  const selectBtn = card.querySelector('.qec-btn-select');

  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      openAccountModal();
    });
  }

  if (bestBtn) {
    bestBtn.addEventListener('click', async () => {
      bestBtn.disabled = true;
      bestBtn.innerHTML = '<span class="spinner-inline"></span> <span>正在切换最佳账号...</span>';

      await switchToBestAccount(async (success, newEmail) => {
        if (success) {
          bestBtn.innerHTML = `<span>✓ 已切换至 ${newEmail.split('@')[0]}，准备重试</span>`;
          card.classList.add('resolved');
          if (session.prompt) {
            setTimeout(() => {
              retrySessionTask(session);
            }, 600);
          }
        } else {
          bestBtn.disabled = false;
          bestBtn.innerHTML = '<span>⚡ 重试切换最佳账号</span>';
        }
      });
    });
  }
}

function retrySessionTask(session) {
  if (!session || !session.prompt) return;

  const currentWs = session.workspace || state.currentWorkspace?.path || '.';
  const container = session.container || getOrCreateSessionContainer(session.sessionId);

  const newAssistantMsgObj = createAssistantMessageContainer(container);
  const abortController = new AbortController();

  const retryContext = {
    sessionId: session.sessionId,
    tempId: session.tempId,
    container: container,
    currentStreamMessage: newAssistantMsgObj,
    currentToolsMap: new Map(),
    abortController: abortController,
    statusText: '已切换账号，正在重新发起任务...',
    prompt: session.prompt,
    workspace: currentWs,
    images: session.images || []
  };

  state.activeSessions.set(session.sessionId, retryContext);
  state.runningSessionIds.add(session.sessionId);

  updateGeneratingUI();
  scrollToBottom();

  runSessionStream(retryContext, session.prompt, currentWs, session.sessionId, session.images || []);
}

function pathResolve(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

// --- Workspace Rename Helpers ---
function openRenameWorkspaceModal(ws) {
  if (window.innerWidth <= 768) closeSidebar();
  if (!ws) return;
  state.workspaceToRename = ws;
  if (el.renameWsPathPreview) {
    el.renameWsPathPreview.textContent = ws.path || '(无路径)';
    el.renameWsPathPreview.title = ws.path || '';
  }
  if (el.renameWsInputName) {
    el.renameWsInputName.value = ws.name || '';
  }
  if (el.renameWorkspaceModal) {
    el.renameWorkspaceModal.classList.remove('hidden');
    setTimeout(() => el.renameWsInputName?.focus(), 50);
  }
}

function closeRenameWorkspaceModal() {
  state.workspaceToRename = null;
  if (el.renameWorkspaceModal) {
    el.renameWorkspaceModal.classList.add('hidden');
  }
}

async function saveWorkspaceRename() {
  const ws = state.workspaceToRename;
  if (!ws) return;
  const newName = (el.renameWsInputName?.value || '').trim();
  if (!newName) {
    alert('工作区名称不能为空');
    return;
  }

  try {
    const res = await fetch('/api/workspaces/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: ws.id,
        path: ws.path,
        name: newName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '重命名失败');

    state.workspaces = data.workspaces;

    if (state.currentWorkspace && (state.currentWorkspace.id === ws.id || pathResolve(state.currentWorkspace.path) === pathResolve(ws.path))) {
      state.currentWorkspace.name = newName;
      if (el.currentWsName) el.currentWsName.textContent = newName;
      if (el.navWsPath) el.navWsPath.textContent = newName;
    }

    state.conversations.forEach(c => {
      if (c.workspace_id === ws.id || (c.workspace_path && pathResolve(c.workspace_path) === pathResolve(ws.path))) {
        c.workspace_name = newName;
      }
    });

    closeRenameWorkspaceModal();
    renderWorkspacesList();
    renderConversationsList();
  } catch (err) {
    alert('重命名工作区失败: ' + err.message);
  }
}

function setHistoryViewMode(mode) {
  state.historyViewMode = mode;
  localStorage.setItem('agy_history_view_mode', mode);
  if (el.historyTabAll) el.historyTabAll.classList.toggle('active', mode === 'all');
  if (el.historyTabCurrent) el.historyTabCurrent.classList.toggle('active', mode === 'current');
  renderConversationsList();
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
      <div class="ws-item-actions">
        <button class="btn-icon-sm rename-ws-btn" title="重命名工作区">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon-sm delete-ws-btn" title="从列表移除">✕</button>
      </div>
    `;

    item.querySelector('.ws-item-info').addEventListener('click', () => {
      setWorkspace(ws);
      el.workspaceDropdown.classList.add('hidden');
      if (window.innerWidth <= 768) {
        closeSidebar();
      }
    });

    item.querySelector('.rename-ws-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openRenameWorkspaceModal(ws);
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

function formatShortWsName(ws) {
  if (!ws) return '';
  const raw = ws.name || ws.path || '';
  return raw.replace(/\s*\([^)]*\)/g, '').trim() || raw;
}

function setWorkspace(ws) {
  if (!ws) return;
  state.currentWorkspace = ws;
  if (ws.path) localStorage.setItem('agy_last_ws', ws.path);
  if (el.currentWsName) el.currentWsName.textContent = ws.name || ws.path || '';
  if (el.currentWsPath) {
    el.currentWsPath.textContent = ws.path || '';
    el.currentWsPath.title = ws.path || '';
  }
  if (el.navWsPath) {
    el.navWsPath.textContent = formatShortWsName(ws);
    el.navWsPath.title = `${ws.name || ''}\n${ws.path || ''}`;
  }
  if (el.navbarWsPill) el.navbarWsPill.title = `工作区路径: ${ws.path || ''} (点击切换)`;
  if (el.welcomeWsPath) el.welcomeWsPath.textContent = ws.path || '';
  const wsTextEl = document.getElementById('welcomeWsBadgeText');
  if (wsTextEl) {
    wsTextEl.textContent = ws.name || ws.path || '';
  } else if (el.welcomeWsBadge) {
    el.welcomeWsBadge.textContent = ws.name ? `📁 ${ws.name}` : `📁 ${ws.path}`;
  }
  if (el.welcomeWsBadge) {
    el.welcomeWsBadge.title = `工作区路径: ${ws.path || ''} (点击切换)`;
  }
  if (el.settingsWsName) el.settingsWsName.textContent = ws.name || '工作区';
  if (el.settingsWsPath) el.settingsWsPath.textContent = ws.path || '';
  renderWorkspacesList();
  renderConversationsList();
}

async function loadConversations(silent = false) {
  try {
    if (!silent && state.conversations.length === 0) {
      el.historyList.innerHTML = '<div class="loading-state">加载中...</div>';
    }
    const res = await fetch('/api/conversations?limit=100');
    if (!res.ok) throw new Error('Failed to load conversations');
    const list = await res.json();
    state.conversations = list;

    // 同步后端返回的运行中会话状态
    list.forEach(c => {
      if (c.is_running) {
        state.runningSessionIds.add(c.id);
      } else {
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

function createHistoryItemElement(c) {
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

  item.addEventListener('click', () => {
    // If conversation belongs to another workspace, switch active workspace
    if (c.workspace_path && state.currentWorkspace && pathResolve(state.currentWorkspace.path) !== pathResolve(c.workspace_path)) {
      const match = state.workspaces.find(w => pathResolve(w.path) === pathResolve(c.workspace_path));
      if (match) {
        setWorkspace(match);
      } else {
        setWorkspace({
          id: c.workspace_id || 'ws_' + Date.now(),
          name: c.workspace_name || c.workspace_path,
          path: c.workspace_path
        });
      }
    }
    switchConversation(c.id, c.title);
  });

  return item;
}

function renderConversationsList() {
  el.historyList.innerHTML = '';
  if (state.conversations.length === 0) {
    el.historyList.innerHTML = '<div class="loading-state">暂无历史会话</div>';
    return;
  }

  // Update tabs active state
  if (el.historyTabAll) el.historyTabAll.classList.toggle('active', state.historyViewMode === 'all');
  if (el.historyTabCurrent) el.historyTabCurrent.classList.toggle('active', state.historyViewMode === 'current');

  // Mode 1: Current Workspace Only
  if (state.historyViewMode === 'current') {
    const curPath = state.currentWorkspace ? pathResolve(state.currentWorkspace.path) : '';
    const curId = state.currentWorkspace ? state.currentWorkspace.id : '';

    const currentItems = state.conversations.filter(c => {
      if (curPath && c.workspace_path && pathResolve(c.workspace_path) === curPath) return true;
      if (curId && c.workspace_id === curId) return true;
      return false;
    });

    if (currentItems.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-state';
      emptyBox.style.cssText = 'padding: 24px 12px; text-align: center; color: var(--text-dim); font-size: 11px;';
      emptyBox.innerHTML = `
        <div>当前工作区暂无历史会话</div>
        <button class="btn btn-secondary btn-sm" style="margin-top: 8px;" id="curWsNewChatBtn">+ 新建对话</button>
      `;
      emptyBox.querySelector('#curWsNewChatBtn')?.addEventListener('click', startNewChat);
      el.historyList.appendChild(emptyBox);
      return;
    }

    currentItems.forEach(c => {
      el.historyList.appendChild(createHistoryItemElement(c));
    });
    return;
  }

  // Mode 2: Grouped by Workspace (全部分类)
  const curPath = state.currentWorkspace ? pathResolve(state.currentWorkspace.path) : '';
  const curId = state.currentWorkspace ? state.currentWorkspace.id : '';

  // Collect groups
  const groupsMap = new Map();
  if (state.currentWorkspace) {
    groupsMap.set(state.currentWorkspace.id, {
      id: state.currentWorkspace.id,
      name: state.currentWorkspace.name,
      path: state.currentWorkspace.path,
      is_current: true,
      items: []
    });
  }

  state.conversations.forEach(c => {
    let gKey = c.workspace_id || 'unclassified';
    if (c.workspace_path) {
      const reg = state.workspaces.find(w => pathResolve(w.path) === pathResolve(c.workspace_path));
      if (reg) gKey = reg.id;
    }

    if (!groupsMap.has(gKey)) {
      const isCurrent = (curId && gKey === curId) || (curPath && c.workspace_path && pathResolve(c.workspace_path) === curPath);
      groupsMap.set(gKey, {
        id: gKey,
        name: c.workspace_name || (gKey === 'unclassified' ? '其它 / 未分类' : '工作区'),
        path: c.workspace_path || '',
        is_current: isCurrent,
        items: []
      });
    }

    groupsMap.get(gKey).items.push(c);
  });

  const groups = Array.from(groupsMap.values()).filter(g => g.items.length > 0 || g.is_current);
  groups.sort((a, b) => {
    if (a.is_current) return -1;
    if (b.is_current) return 1;
    if (a.id === 'unclassified') return 1;
    if (b.id === 'unclassified') return -1;
    const aTime = a.items[0]?.updated_at ? new Date(a.items[0].updated_at) : 0;
    const bTime = b.items[0]?.updated_at ? new Date(b.items[0].updated_at) : 0;
    return bTime - aTime;
  });

  groups.forEach(group => {
    let isCollapsed = false;
    if (group.is_current) {
      isCollapsed = state.collapsedWsGroups.has(group.id);
    } else {
      isCollapsed = !state.expandedWsGroups?.has(group.id);
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'history-group' + (isCollapsed ? ' collapsed' : '');
    groupEl.dataset.wsId = group.id;

    groupEl.innerHTML = `
      <div class="history-group-header ${group.is_current ? 'is-current' : ''}">
        <div class="group-header-left">
          <svg class="group-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          <span class="group-icon">📁</span>
          <span class="group-title" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</span>
          ${group.is_current ? '<span class="group-active-tag">当前</span>' : ''}
          <span class="group-count">${group.items.length}</span>
        </div>
        <div class="group-header-right">
          ${group.id !== 'unclassified' ? `
            <button class="group-rename-btn" title="重命名此工作区">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
      <div class="history-group-items"></div>
    `;

    // Toggle collapse
    const headerEl = groupEl.querySelector('.history-group-header');
    headerEl.addEventListener('click', (e) => {
      if (e.target.closest('.group-rename-btn')) return;
      groupEl.classList.toggle('collapsed');
      const nowCollapsed = groupEl.classList.contains('collapsed');
      if (!state.expandedWsGroups) state.expandedWsGroups = new Set();
      if (nowCollapsed) {
        state.collapsedWsGroups.add(group.id);
        state.expandedWsGroups.delete(group.id);
      } else {
        state.collapsedWsGroups.delete(group.id);
        state.expandedWsGroups.add(group.id);
      }
      localStorage.setItem('agy_collapsed_ws_groups', JSON.stringify(Array.from(state.collapsedWsGroups)));
      localStorage.setItem('agy_expanded_ws_groups', JSON.stringify(Array.from(state.expandedWsGroups)));
    });

    // Rename workspace button
    const renameBtn = groupEl.querySelector('.group-rename-btn');
    if (renameBtn) {
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRenameWorkspaceModal(group);
      });
    }

    // Append items
    const itemsContainer = groupEl.querySelector('.history-group-items');
    if (group.items.length === 0) {
      const emptyNote = document.createElement('div');
      emptyNote.style.cssText = 'padding: 6px 8px; color: var(--text-dim); font-size: 11px;';
      emptyNote.textContent = '暂无历史会话';
      itemsContainer.appendChild(emptyNote);
    } else {
      group.items.forEach(c => {
        itemsContainer.appendChild(createHistoryItemElement(c));
      });
    }

    el.historyList.appendChild(groupEl);
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
    if (el.welcomeView) el.welcomeView.classList.remove('hidden');
    if (state.currentWorkspace) {
      const wsTextEl = document.getElementById('welcomeWsBadgeText');
      if (wsTextEl) {
        wsTextEl.textContent = state.currentWorkspace.name || state.currentWorkspace.path || '';
      } else if (el.welcomeWsBadge) {
        el.welcomeWsBadge.textContent = state.currentWorkspace.name ? `📁 ${state.currentWorkspace.name}` : `📁 ${state.currentWorkspace.path}`;
      }
      if (el.welcomeWsBadge) {
        el.welcomeWsBadge.title = `工作区路径: ${state.currentWorkspace.path || ''} (点击切换)`;
      }
    }
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

// Update Navbar Session Title & Breadcrumb state
function updateNavbarSessionTitle(title) {
  const isNew = !title || title === '新会话' || !state.currentConversationId;
  if (el.navbarBreadcrumbs) {
    if (isNew) {
      el.navbarBreadcrumbs.classList.add('is-new-session');
    } else {
      el.navbarBreadcrumbs.classList.remove('is-new-session');
    }
  }
  if (el.sessionTitle) {
    el.sessionTitle.textContent = title || '新会话';
  }
}

// Switch Conversation (随时进入之前或正在运行的会话)
async function switchConversation(convId, title) {
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
  state.currentConversationId = convId;
  updateNavbarSessionTitle(title || '历史会话');
  
  const container = getOrCreateSessionContainer(convId);
  showSessionContainer(convId);
  renderConversationsList();
  updateGeneratingUI();

  // 若容器内已有内容，且该会话非运行中状态，直接恢复展示
  if (container.children.length > 0 && !state.runningSessionIds.has(convId)) {
    scrollToBottom();
    return;
  }

  // 否则从后端拉取历史记录 / 同步最新后台执行进度
  try {
    if (container.children.length === 0) {
      container.innerHTML = '<div class="loading-state" style="padding: 24px; text-align: center; color: var(--text-dim);">加载记录中...</div>';
    }
    const res = await fetch(`/api/conversations/${convId}`);
    if (!res.ok) throw new Error('Failed to load conversation');
    const data = await res.json();

    renderConversationMessages(container, data.messages);
    if (data.is_running) {
      ensureTypingCursor(container);
    }
    scrollToBottom();
  } catch (err) {
    if (container.children.length === 0) {
      container.innerHTML = `<div class="tool-badge error" style="margin: 16px;">加载会话失败: ${escapeHtml(err.message)}</div>`;
    }
  }
}

// Start New Chat (随时新建会话，不影响后台正在运行的其他会话)
function startNewChat() {
  state.currentConversationId = null;
  updateNavbarSessionTitle('新会话');
  showSessionContainer(null);
  el.promptInput.value = '';
  el.promptInput.focus();
  renderConversationsList();
  updateGeneratingUI();
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
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
    updateNavbarSessionTitle(prompt.slice(0, 24) || '新任务');

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
  if (window.innerWidth <= 768) {
    el.promptInput.blur(); // Dismiss mobile soft keyboard
  }

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
    statusText: '正在连接智能体...',
    prompt: prompt,
    workspace: currentWs,
    images: images
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
    if (err.name !== 'AbortError' && !session.isUserAborted) {
      console.warn('Session stream interrupted or backgrounded:', err);

      // 尝试后台无感恢复轮询（手机端切后台、锁屏、临时断网等场景）
      const recovered = await handleBackgroundRecovery(session);
      if (recovered) {
        return; // 后台任务已无缝同步完成
      }

      if (session.currentStreamMessage) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'tool-badge error';
        errorDiv.style.marginTop = '8px';
        errorDiv.textContent = `执行异常: ${err.message}`;
        session.currentStreamMessage.bodyEl.appendChild(errorDiv);
      }
      if (/RESOURCE_EXHAUSTED|quota exceeded|Rate limit|Too Many Requests|429|exceeded your current quota|Capacity exhausted/i.test(err.message)) {
        showQuotaExhaustedCard(session, err.message);
      }
    }
  } finally {
    if (session.currentStreamMessage?.statusBadgeEl) {
      session.currentStreamMessage.statusBadgeEl.remove();
      session.currentStreamMessage.statusBadgeEl = null;
    }
    if (!session.streamFinished && !session.isUserAborted && !session.inBackgroundRecovery) {
      if (!session.currentStreamMessage || !session.currentStreamMessage.rawText.trim()) {
        const notice = document.createElement('div');
        notice.className = 'stream-notice-card warning';
        notice.innerHTML = `<span class="notice-icon">⚠️</span> <span class="notice-msg">与后端的任务执行连接已中断（服务重启或网络闪断）。如需继续，请点击下方输入框重新发送。</span>`;
        session.currentStreamMessage?.bodyEl?.appendChild(notice);
      }
    }
    if (!session.inBackgroundRecovery) {
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
    updateSessionBadge(session, session.statusText);
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
    session.streamFinished = true;
    if (session.currentStreamMessage?.statusBadgeEl) {
      session.currentStreamMessage.statusBadgeEl.remove();
      session.currentStreamMessage.statusBadgeEl = null;
    }
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
  } else if (event === 'quota_exhausted') {
    session.statusText = '额度已耗尽，请快捷切换账号';
    if (state.currentConversationId === session.sessionId) {
      updateStatus(session.statusText);
    }
    showQuotaExhaustedCard(session, data.message || '当前账号额度已耗尽');
  } else if (event === 'error') {
    session.statusText = `错误: ${data.error}`;
    if (state.currentConversationId === session.sessionId) {
      updateStatus(session.statusText);
    }
    if (/RESOURCE_EXHAUSTED|quota exceeded|Rate limit|Too Many Requests|429|exceeded your current quota|Capacity exhausted/i.test(data.error || '')) {
      showQuotaExhaustedCard(session, data.error);
    }
  }
}

// 绑定到会话实例的 Step 事件处理（思考过程、工具调用卡片、Markdown 流式文本）
function handleStepEventForSession(session, step) {
  const msgObj = session.currentStreamMessage;
  if (!msgObj) return;

  const isCurrentView = state.currentConversationId === session.sessionId;

  // 1. Tool execution: 实时在底部状态栏与消息气泡内反馈工具执行进度
  if (step.step_type === 'tool') {
    const toolName = step.tool_name || step.tool_info?.name || '执行操作';
    session.statusText = `正在执行工具: ${toolName}...`;
    updateSessionBadge(session, `🔧 正在执行: ${toolName}...`);
    if (isCurrentView) {
      updateStatus(session.statusText);
    }
    return;
  }

  // 2. Thinking / Reasoning text
  if (step.thinking_delta || step.step_type === 'thinking') {
    updateSessionBadge(session, '💭 正在深度推理思考中...');
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
    if (msgObj.statusBadgeEl) {
      msgObj.statusBadgeEl.remove();
      msgObj.statusBadgeEl = null;
    }
    if (msgObj.thinkingEl && typeof msgObj.thinkingEl.finalize === 'function') {
      msgObj.thinkingEl.finalize();
    }
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
    const active = state.activeSessions.get(currentId);
    if (active) {
      active.isUserAborted = true;
      if (active.abortController) {
        active.abortController.abort();
      }
      if (active.currentStreamMessage?.statusBadgeEl) {
        active.currentStreamMessage.statusBadgeEl.remove();
        active.currentStreamMessage.statusBadgeEl = null;
      }
      if (active.currentStreamMessage?.thinkingEl && typeof active.currentStreamMessage.thinkingEl.finalize === 'function') {
        active.currentStreamMessage.thinkingEl.finalize();
      }
      if (active.currentStreamMessage && active.currentStreamMessage.bodyEl) {
        const stopNotice = document.createElement('div');
        stopNotice.className = 'tool-badge warning';
        stopNotice.style.marginTop = '8px';
        stopNotice.style.display = 'inline-flex';
        stopNotice.textContent = '⏹ 用户已终止任务';
        active.currentStreamMessage.bodyEl.appendChild(stopNotice);
      }
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

  row.innerHTML = `<div class="message-header"><div class="message-avatar">AI</div><span class="message-author">Antigravity Agent</span></div><div class="message-content"><div class="message-body markdown-body"><div class="inline-status-badge"><span class="spinner-inline"></span><span class="badge-text">正在启动并规划任务...</span></div><div class="response-text"></div></div></div>`;

  container.appendChild(row);
  const textEl = row.querySelector('.response-text');
  const bodyEl = row.querySelector('.message-body');
  const statusBadgeEl = row.querySelector('.inline-status-badge');

  return {
    rowEl: row,
    bodyEl: bodyEl,
    textEl: textEl,
    statusBadgeEl: statusBadgeEl,
    rawText: '',
    thinkingEl: null
  };
}

function updateSessionBadge(session, text) {
  if (session && session.currentStreamMessage && session.currentStreamMessage.statusBadgeEl) {
    const textNode = session.currentStreamMessage.statusBadgeEl.querySelector('.badge-text');
    if (textNode) textNode.textContent = text;
  }
}

function cleanThinkingText(text) {
  if (!text) return '';
  return text.trim().replace(/\n{3,}/g, '\n\n');
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
    },
    finalize: () => {
      content.textContent = cleanThinkingText(content.textContent);
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

  let innerHtml = '';
  if (role === 'assistant') {
    innerHtml += `<div class="message-header"><div class="message-avatar">AI</div><span class="message-author">Antigravity Agent</span></div><div class="message-content"><div class="message-body markdown-body">`;
  } else {
    innerHtml += `<div class="message-content"><div class="message-body">`;
  }

  // Assistant thinking block if present
  if (extra.thinking) {
    innerHtml += `<div class="thinking-block"><div class="thinking-header"><span class="thinking-title">💭 思考过程 (Thinking Process)</span><span class="btn-icon-sm">▼</span></div><div class="thinking-content">${escapeHtml(cleanThinkingText(extra.thinking))}</div></div>`;
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

  const cleanText = (content || '').trim();
  if (role === 'assistant') {
    innerHtml += `<div class="response-text">${renderMarkdown(content)}</div>`;
  } else {
    innerHtml += `<div class="response-text">${escapeHtml(cleanText)}</div>`;
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

function ensureTypingCursor(targetEl) {
  if (!targetEl) return;
  const textTarget = targetEl.classList?.contains('response-text') 
    ? targetEl 
    : (targetEl.querySelector?.('.message-row.assistant:last-child .response-text') || targetEl);
  let cursor = textTarget.querySelector?.('.typing-cursor');
  if (!cursor) {
    cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    textTarget.appendChild(cursor);
  }
}

function removeTypingCursor(scope = document) {
  (scope || document).querySelectorAll('.typing-cursor').forEach(c => c.remove());
}

const SEND_ICON_HTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
const STOP_ICON_HTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>`;

function updateGeneratingUI() {
  const currentId = state.currentConversationId;
  const isRunning = currentId && state.runningSessionIds.has(currentId);
  state.isGenerating = !!isRunning;

  // 底部提示条不显示，避免与消息流内的状态提示重复
  if (el.agentStatusBar) {
    el.agentStatusBar.classList.add('hidden');
  }

  if (isRunning) {
    // 运行中：发送按钮变红，点击终止任务
    el.sendBtn.disabled = false;
    el.sendBtn.classList.add('is-stop');
    el.sendBtn.title = '终止任务';
    el.sendBtn.setAttribute('aria-label', '终止任务');
    el.sendBtn.innerHTML = STOP_ICON_HTML;
  } else {
    // 空闲：发送按钮恢复正常蓝色
    el.sendBtn.classList.remove('is-stop');
    el.sendBtn.title = '发送 (Enter)';
    el.sendBtn.setAttribute('aria-label', '发送 (Enter)');
    el.sendBtn.disabled = false;
    el.sendBtn.innerHTML = SEND_ICON_HTML;
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
  if (el.statusMessage) {
    el.statusMessage.textContent = msg;
  }
}

function scrollToBottom() {
  el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  requestAnimationFrame(() => {
    el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  });
}

// --- Model & Reasoning Effort Cascader Logic ---
const MODEL_FAMILIES_FALLBACK = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    tag: '推荐',
    icon: '⚡',
    description: '新一代极速主力模型，强悍推理',
    efforts: [
      { id: 'gemini-3.8-flash-high', effort: 'high', label: '高思考 (深度推理)', desc: '复杂逻辑推导与大工程代码重构', default: true },
      { id: 'gemini-3.8-flash-medium', effort: 'medium', label: '中思考 (均衡模式)', desc: '平衡响应速度与日常编程任务' },
      { id: 'gemini-3.8-flash-low', effort: 'low', label: '低思考 (极速响应)', desc: '毫秒级响应，简单问答与快速处理' }
    ]
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    icon: '⚡',
    description: '轻快灵活的大语言模型',
    efforts: [
      { id: 'gemini-3.7-flash-high', effort: 'high', label: '高思考 (深度推理)', desc: '多步骤深度思考推理' },
      { id: 'gemini-3.7-flash-medium', effort: 'medium', label: '中思考 (均衡模式)', desc: '速度与准确率平衡模式' },
      { id: 'gemini-3.7-flash-low', effort: 'low', label: '低思考 (极速响应)', desc: '快速低延迟即时响应' }
    ]
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    icon: '⚡',
    description: '稳定代际 Flash',
    efforts: [
      { id: 'gemini-3.6-flash-high', effort: 'high', label: '高思考 (深度推理)', desc: '长上下文稳定深度推理' },
      { id: 'gemini-3.6-flash-medium', effort: 'medium', label: '中思考 (均衡模式)', desc: '标准均衡执行模式' },
      { id: 'gemini-3.6-flash-low', effort: 'low', label: '低思考 (极速响应)', desc: '快速响应模式' }
    ]
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    tag: '旗舰',
    icon: '🧠',
    description: 'Google 旗舰级多模态推理大模型',
    efforts: [
      { id: 'gemini-3.1-pro-high', effort: 'high', label: '高思考 (深度推理)', desc: '顶级算法推导、数学证明与高难度逻辑' },
      { id: 'gemini-3.1-pro-low', effort: 'low', label: '低思考 (极速响应)', desc: '轻量低延迟快速推理' }
    ]
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    tag: 'Anthropic',
    icon: '🟣',
    description: 'Anthropic 顶尖编程推理模型',
    efforts: [
      { id: 'claude-sonnet-4-6', effort: 'high', label: '内置深度思考 (代码推理)', desc: '卓越的系统架构设计与严谨代码审查' }
    ]
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6',
    tag: 'Anthropic',
    icon: '🟣',
    description: 'Anthropic 旗舰超级模型',
    efforts: [
      { id: 'claude-opus-4-6-thinking', effort: 'high', label: '内置深度思考 (顶级推理)', desc: '最深邃的认知推理与复杂长程推导' }
    ]
  },
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B',
    tag: '开源',
    icon: '🟢',
    description: '开源 120B 稠密大模型',
    efforts: [
      { id: 'gpt-oss-120b-medium', effort: 'medium', label: '中思考 (均衡模式)', desc: '开源高性价比平衡推理' }
    ]
  }
];

function findFamilyByModelId(modelId) {
  const families = state.modelFamilies?.length > 0 ? state.modelFamilies : MODEL_FAMILIES_FALLBACK;
  for (const fam of families) {
    if (fam.efforts.some(e => e.id === modelId)) {
      return fam;
    }
  }
  return null;
}

function findEffortByModelId(modelId) {
  const families = state.modelFamilies?.length > 0 ? state.modelFamilies : MODEL_FAMILIES_FALLBACK;
  for (const fam of families) {
    const found = fam.efforts.find(e => e.id === modelId);
    if (found) return found;
  }
  return null;
}

function toggleModelCascader() {
  if (!el.modelCascaderPopover) return;
  const isHidden = el.modelCascaderPopover.classList.contains('hidden');
  if (isHidden) {
    openModelCascader();
  } else {
    closeModelCascader();
  }
}

function openModelCascader() {
  if (!el.modelCascaderPopover) return;
  el.modelCascaderPopover.classList.remove('hidden');
  if (el.modelCascaderBackdrop) el.modelCascaderBackdrop.classList.remove('hidden');
  if (el.modelCascaderTrigger) el.modelCascaderTrigger.classList.add('open');

  updateModeCardsDisplay();

  const curFam = findFamilyByModelId(state.activeModel);
  const families = state.modelFamilies?.length > 0 ? state.modelFamilies : MODEL_FAMILIES_FALLBACK;
  state.hoveredFamilyId = curFam ? curFam.id : (families[0]?.id || 'gemini-3.8-flash');

  renderModelFamiliesList();
  renderModelEffortsList(state.hoveredFamilyId);
}

function closeModelCascader() {
  if (!el.modelCascaderPopover) return;
  el.modelCascaderPopover.classList.add('hidden');
  if (el.modelCascaderBackdrop) el.modelCascaderBackdrop.classList.add('hidden');
  if (el.modelCascaderTrigger) el.modelCascaderTrigger.classList.remove('open');
}

function renderModelFamiliesList() {
  if (!el.modelFamiliesList) return;
  el.modelFamiliesList.innerHTML = '';

  const families = state.modelFamilies?.length > 0 ? state.modelFamilies : MODEL_FAMILIES_FALLBACK;
  const activeFam = findFamilyByModelId(state.activeModel);

  families.forEach(fam => {
    const item = document.createElement('div');
    const isHovered = fam.id === state.hoveredFamilyId;
    const isActive = activeFam && activeFam.id === fam.id;

    item.className = `model-family-item ${isHovered ? 'hovered' : ''} ${isActive ? 'active' : ''}`;

    let badgeClass = 'badge-primary';
    if (fam.tag === 'Pro') badgeClass = 'badge-purple';
    else if (fam.tag === 'Anthropic') badgeClass = 'badge-orange';
    else if (fam.tag === '开源') badgeClass = 'badge-green';

    item.innerHTML = `
      <div class="model-family-left">
        <span class="model-family-icon">${fam.icon || '⚡'}</span>
        <span class="model-family-name">${escapeHtml(fam.name)}</span>
      </div>
      <div class="model-family-right">
        ${fam.tag ? `<span class="model-family-badge ${badgeClass}">${escapeHtml(fam.tag)}</span>` : ''}
        <span class="model-family-arrow">›</span>
      </div>
    `;

    // Mouseenter (Hover): updates hovered family and renders effort list
    item.addEventListener('mouseenter', () => {
      state.hoveredFamilyId = fam.id;
      document.querySelectorAll('.model-family-item').forEach(i => i.classList.remove('hovered'));
      item.classList.add('hovered');
      renderModelEffortsList(fam.id);
    });

    // Click: if only 1 effort option, select it directly; otherwise hover it
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      state.hoveredFamilyId = fam.id;
      document.querySelectorAll('.model-family-item').forEach(i => i.classList.remove('hovered'));
      item.classList.add('hovered');
      renderModelEffortsList(fam.id);
      if (fam.efforts.length === 1) {
        selectModelAndEffort(fam, fam.efforts[0]);
      }
    });

    el.modelFamiliesList.appendChild(item);
  });
}

function renderModelEffortsList(familyId) {
  if (!el.modelEffortsList) return;
  el.modelEffortsList.innerHTML = '';

  const families = state.modelFamilies?.length > 0 ? state.modelFamilies : MODEL_FAMILIES_FALLBACK;
  const fam = families.find(f => f.id === familyId);
  if (!fam) return;

  if (el.modelEffortsHeader) {
    el.modelEffortsHeader.textContent = `${fam.name} · 思考强度`;
  }

  fam.efforts.forEach(eff => {
    const item = document.createElement('div');
    const isSelected = state.activeModel === eff.id;

    item.className = `model-effort-item ${isSelected ? 'selected' : ''}`;

    let effortIcon = '🧠';
    if (eff.effort === 'medium') effortIcon = '⚖️';
    else if (eff.effort === 'low') effortIcon = '🚀';
    else if (fam.id.startsWith('claude')) effortIcon = '🟣';

    item.innerHTML = `
      <div class="effort-item-left">
        <div class="effort-item-title">
          <span>${effortIcon}</span>
          <span>${escapeHtml(eff.label)}</span>
        </div>
        ${eff.desc ? `<div class="effort-item-desc">${escapeHtml(eff.desc)}</div>` : ''}
      </div>
      ${isSelected ? '<span class="effort-check-icon">✓</span>' : ''}
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectModelAndEffort(fam, eff);
    });

    el.modelEffortsList.appendChild(item);
  });
}

function selectModelAndEffort(family, effort) {
  state.activeModel = effort.id;
  state.activeEffort = effort.effort;

  localStorage.setItem('agy_model', state.activeModel);
  localStorage.setItem('agy_effort', state.activeEffort);

  // Sync hidden selects
  if (el.modelSelect) el.modelSelect.value = state.activeModel;
  if (el.effortSelect) el.effortSelect.value = state.activeEffort;

  updateModelTriggerDisplay(family, effort);
  closeModelCascader();
  showToast(`已选择模型：${family ? family.name : state.activeModel} · ${effort ? effort.label : ''}`, 'success', 2200);
}

function setExecutionMode(mode) {
  state.activeMode = mode;
  localStorage.setItem('agy_mode', mode);
  if (el.modeSelect) el.modeSelect.value = mode;
  updateModeCardsDisplay();
  updateModelTriggerDisplay();
}

function updateModeCardsDisplay() {
  const isPlan = state.activeMode === 'plan';
  if (el.modeCardAccept) el.modeCardAccept.classList.toggle('active', !isPlan);
  if (el.modeCardPlan) el.modeCardPlan.classList.toggle('active', isPlan);
}

function updateModelTriggerDisplay(family, effort) {
  if (!family || !effort) {
    family = findFamilyByModelId(state.activeModel);
    effort = findEffortByModelId(state.activeModel);
  }
  if (el.modelTriggerName) {
    el.modelTriggerName.textContent = family ? family.name : state.activeModel;
    el.modelTriggerName.title = family ? family.name : state.activeModel;
  }
  if (el.modelTriggerEffort) {
    let effortText = effort ? effort.label : `思考: ${state.activeEffort}`;
    if (window.innerWidth <= 768) {
      effortText = effortText.replace(/\s*\([^)]*\)/, '');
    }
    el.modelTriggerEffort.textContent = effortText;
    el.modelTriggerEffort.title = effort ? `${effort.label} - ${effort.desc || ''}` : '';
  }
  if (el.modelTriggerMode) {
    const isPlan = state.activeMode === 'plan';
    el.modelTriggerMode.textContent = isPlan ? '仅规划' : '自动执行';
    el.modelTriggerMode.className = `model-trigger-mode ${isPlan ? 'mode-plan' : 'mode-accept'}`;
    el.modelTriggerMode.title = isPlan ? '当前模式：仅制定规划方案，不自动修改文件' : '当前模式：自动分析、修改代码并执行命令';
  }

  // Sync Mobile Top Navbar Model Pill
  if (el.mobileNavModelName) {
    el.mobileNavModelName.textContent = family ? family.name : state.activeModel;
  }
  if (el.mobileNavModelEffort) {
    let effortText = effort ? effort.label : `思考: ${state.activeEffort}`;
    effortText = effortText.replace(/\s*\([^)]*\)/, '');
    el.mobileNavModelEffort.textContent = effortText;
  }

  // Sync Mobile Composer Mode Chip
  if (el.composerModeText) {
    const isPlan = state.activeMode === 'plan';
    el.composerModeText.textContent = isPlan ? '📋 仅规划' : '⚡ 自动执行';
    if (el.composerModeToggleBtn) {
      el.composerModeToggleBtn.classList.toggle('mode-plan', isPlan);
    }
  }

  // Sync Settings Modal Summary
  if (el.settingsModelSummary) {
    const fName = family ? family.name : state.activeModel;
    const eLabel = effort ? effort.label : state.activeEffort;
    el.settingsModelSummary.textContent = `${fName} · ${eLabel}`;
  }
  const isPlan = state.activeMode === 'plan';
  if (el.settingsModeAccept) el.settingsModeAccept.classList.toggle('active', !isPlan);
  if (el.settingsModePlan) el.settingsModePlan.classList.toggle('active', isPlan);
}

function renderConversationMessages(container, messages) {
  if (!container) return;
  container.innerHTML = '';
  if (Array.isArray(messages)) {
    messages.forEach(msg => {
      appendMessage(msg.role, msg.content, {
        thinking: msg.thinking,
        tool_calls: msg.tool_calls,
        timestamp: msg.timestamp
      }, container);
    });
  }
}

async function handleBackgroundRecovery(session) {
  if (session.isUserAborted) return false;
  const convId = session.sessionId;
  if (!convId || convId.startsWith('sess_')) return false;

  session.inBackgroundRecovery = true;
  session.statusText = '后台持续执行中 · 正在保持同步...';
  if (state.currentConversationId === convId) {
    updateStatus(session.statusText);
  }

  const startTime = Date.now();
  const maxTimeout = 20 * 60 * 1000; // 20分钟超时

  while (Date.now() - startTime < maxTimeout) {
    if (session.isUserAborted) {
      session.inBackgroundRecovery = false;
      return false;
    }

    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();

        // 持续同步最新收到的消息和执行结果
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          renderConversationMessages(session.container, data.messages);
        }

        if (!data.is_running) {
          // 后端进程已执行完成
          session.inBackgroundRecovery = false;
          session.statusText = '执行完成';
          state.runningSessionIds.delete(convId);
          if (session.tempId) state.runningSessionIds.delete(session.tempId);
          state.activeSessions.delete(convId);
          removeTypingCursor(session.container);

          if (state.currentConversationId === convId) {
            updateStatus('执行完成');
            updateGeneratingUI();
            scrollToBottom();
          }
          loadConversations(true);
          return true;
        } else {
          // 仍在后端执行中
          ensureTypingCursor(session.container);
          session.statusText = `智能体后台执行中 (已推进 ${data.total_steps || 0} 步)...`;
          if (state.currentConversationId === convId) {
            updateStatus(session.statusText);
          }
        }
      }
    } catch (e) {
      console.warn('Background sync poll error:', e);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  session.inBackgroundRecovery = false;
  return false;
}

async function syncForegroundOnResume() {
  loadConversations(true);

  const currentId = state.currentConversationId;
  if (!currentId || currentId.startsWith('sess_')) return;

  try {
    const res = await fetch(`/api/conversations/${currentId}`);
    if (!res.ok) return;
    const data = await res.json();

    const container = getOrCreateSessionContainer(currentId);

    if (!data.is_running) {
      if (state.runningSessionIds.has(currentId)) {
        state.runningSessionIds.delete(currentId);
        state.activeSessions.delete(currentId);
        removeTypingCursor(container);
        renderConversationMessages(container, data.messages);
        updateStatus('执行完成');
        updateGeneratingUI();
        scrollToBottom();
      }
    } else {
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        renderConversationMessages(container, data.messages);
      }
      ensureTypingCursor(container);
      updateStatus(`智能体后台执行中 (已推进 ${data.total_steps || 0} 步)...`);
      updateGeneratingUI();
    }
  } catch (err) {
    console.warn('syncForegroundOnResume error:', err);
  }
}

// --- Server Directory Picker Modal & Logic ---
let dirPickerCurrentDir = '/';
let dirPickerParentDir = null;
let dirPickerRawList = [];
let dirPickerSelectedPath = '';

function openDirPickerModal(startDir) {
  if (window.innerWidth <= 768) closeSidebar();
  let target = (startDir || '').trim();
  if (!target) {
    target = state.currentWorkspace?.path ? state.currentWorkspace.path : '/opt/1panel/www/sites';
  }
  if (el.dirPickerModal) {
    el.dirPickerModal.classList.remove('hidden');
    if (el.dirFilterInput) el.dirFilterInput.value = '';
    loadServerDirectories(target);
  }
}

function closeDirPickerModal() {
  if (el.dirPickerModal) {
    el.dirPickerModal.classList.add('hidden');
  }
}

async function loadServerDirectories(dirPath) {
  if (!el.dirListContainer) return;
  el.dirListContainer.innerHTML = '<div class="dir-list-loading">正在读取服务器目录...</div>';
  
  try {
    const res = await fetch(`/api/workspaces/browse?dir=${encodeURIComponent(dirPath)}`);
    const data = await res.json();
    
    if (!res.ok || data.error) {
      el.dirListContainer.innerHTML = `
        <div class="dir-list-error">
          <div>无法访问目录：${escapeHtml(data.error || '未知错误')}</div>
          <div style="margin-top:10px; display:flex; gap:8px; justify-content:center;">
            <button type="button" class="btn btn-secondary btn-sm" id="btnFallbackRoot">前往根目录 /</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btnFallbackOpt">前往 /opt</button>
          </div>
        </div>
      `;
      const btnRoot = document.getElementById('btnFallbackRoot');
      const btnOpt = document.getElementById('btnFallbackOpt');
      if (btnRoot) btnRoot.addEventListener('click', () => loadServerDirectories('/'));
      if (btnOpt) btnOpt.addEventListener('click', () => loadServerDirectories('/opt'));
      return;
    }

    dirPickerCurrentDir = data.current || dirPath;
    dirPickerParentDir = data.parent;
    dirPickerRawList = data.directories || [];
    dirPickerSelectedPath = dirPickerCurrentDir;

    if (el.dirSelectedPathPreview) {
      el.dirSelectedPathPreview.textContent = dirPickerSelectedPath;
    }

    if (el.dirNavUpBtn) {
      el.dirNavUpBtn.disabled = !data.parent || data.is_root;
    }

    renderDirBreadcrumb(dirPickerCurrentDir);
    renderDirList();
  } catch (err) {
    el.dirListContainer.innerHTML = `<div class="dir-list-error">请求失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDirBreadcrumb(fullPath) {
  if (!el.dirBreadcrumb) return;
  el.dirBreadcrumb.innerHTML = '';

  const parts = fullPath.split('/').filter(Boolean);
  
  // Root item
  const rootSpan = document.createElement('span');
  rootSpan.className = 'dir-crumb-item' + (parts.length === 0 ? ' active' : '');
  rootSpan.textContent = '/ (根)';
  rootSpan.title = '根目录 /';
  rootSpan.addEventListener('click', () => {
    if (dirPickerCurrentDir !== '/') loadServerDirectories('/');
  });
  el.dirBreadcrumb.appendChild(rootSpan);

  let accumulated = '';
  parts.forEach((part, idx) => {
    accumulated += '/' + part;
    const currentAcc = accumulated;
    const isLast = idx === parts.length - 1;

    const sep = document.createElement('span');
    sep.className = 'dir-crumb-sep';
    sep.textContent = '>';
    el.dirBreadcrumb.appendChild(sep);

    const crumb = document.createElement('span');
    crumb.className = 'dir-crumb-item' + (isLast ? ' active' : '');
    crumb.textContent = part;
    crumb.title = currentAcc;
    if (!isLast) {
      crumb.addEventListener('click', () => loadServerDirectories(currentAcc));
    }
    el.dirBreadcrumb.appendChild(crumb);
  });
}

function renderDirList() {
  if (!el.dirListContainer) return;
  const keyword = (el.dirFilterInput ? el.dirFilterInput.value : '').trim().toLowerCase();
  
  const filtered = dirPickerRawList.filter(item => {
    if (!keyword) return true;
    return item.name.toLowerCase().includes(keyword);
  });

  if (filtered.length === 0) {
    el.dirListContainer.innerHTML = `
      <div class="dir-list-empty">
        ${keyword ? '无匹配文件夹' : '当前目录下无子文件夹'}
      </div>
    `;
    return;
  }

  el.dirListContainer.innerHTML = '';
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'dir-item' + (dirPickerSelectedPath === item.path ? ' selected' : '');
    
    row.innerHTML = `
      <div class="dir-item-left">
        <span class="dir-item-icon">📁</span>
        <span class="dir-item-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</span>
        ${item.is_git ? '<span class="dir-git-badge">Git</span>' : ''}
      </div>
      <div class="dir-item-actions">
        <button type="button" class="dir-enter-btn" title="进入该文件夹">进入 ➔</button>
      </div>
    `;

    // Click row: select this directory
    row.addEventListener('click', (e) => {
      if (e.target.closest('.dir-enter-btn')) return;
      dirPickerSelectedPath = item.path;
      if (el.dirSelectedPathPreview) {
        el.dirSelectedPathPreview.textContent = dirPickerSelectedPath;
      }
      document.querySelectorAll('.dir-item').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
    });

    // Double click row: enter directory
    row.addEventListener('dblclick', () => {
      loadServerDirectories(item.path);
    });

    // Enter button click: enter directory
    const enterBtn = row.querySelector('.dir-enter-btn');
    if (enterBtn) {
      enterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadServerDirectories(item.path);
      });
    }

    el.dirListContainer.appendChild(row);
  });
}

function confirmDirPickerSelection() {
  if (!dirPickerSelectedPath) {
    dirPickerSelectedPath = dirPickerCurrentDir;
  }
  if (el.wsInputPath) {
    el.wsInputPath.value = dirPickerSelectedPath;
  }
  // Auto-fill workspace name if empty
  if (el.wsInputName && !el.wsInputName.value.trim()) {
    const parts = dirPickerSelectedPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      el.wsInputName.value = parts[parts.length - 1];
    }
  }
  closeDirPickerModal();
  validateWorkspacePathInput();
}

// --- Workspace Modal & Logic ---
function openWorkspaceModal() {
  if (window.innerWidth <= 768) closeSidebar();
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
      } else {
        state.currentWorkspace = null;
        localStorage.removeItem('agy_last_ws');
        if (el.currentWsName) el.currentWsName.textContent = '未选择工作区';
        if (el.currentWsPath) {
          el.currentWsPath.textContent = '';
          el.currentWsPath.title = '';
        }
        if (el.navWsPath) el.navWsPath.textContent = '未选择工作区';
        if (el.navbarWsPill) el.navbarWsPill.title = '';
        renderWorkspacesList();
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

let isMarkedConfigured = false;
function setupMarked() {
  if (isMarkedConfigured || typeof marked === 'undefined') return;

  const renderer = new marked.Renderer();

  // Code blocks: ```lang ... ```
  renderer.code = function(args) {
    const text = typeof args === 'object' ? args.text : arguments[0];
    const lang = ((typeof args === 'object' ? args.lang : arguments[1]) || 'text').toLowerCase();
    const langLabel = lang.toUpperCase();
    return `
      <div class="code-block-wrap">
        <div class="code-block-header">
          <span>${escapeHtml(langLabel)}</span>
          <button class="copy-code-btn">复制</button>
        </div>
        <pre><code class="language-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>
      </div>
    `;
  };

  // Links: [text](url)
  renderer.link = function(args) {
    const href = typeof args === 'object' ? args.href : arguments[0];
    const title = typeof args === 'object' ? args.title : arguments[1];
    const text = typeof args === 'object' ? args.text : arguments[2];
    const isFile = href && href.startsWith('file://');
    const icon = isFile ? '<span class="link-file-icon">📄</span> ' : '';
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="md-link ${isFile ? 'md-file-link' : ''}" ${title ? `title="${escapeHtml(title)}"` : ''}>${icon}${text}</a>`;
  };

  // Blockquotes & GitHub Alerts
  renderer.blockquote = function(args) {
    const quote = typeof args === 'object' ? args.text : arguments[0];
    const alertMatch = quote.match(/^\s*<p>\s*\[\!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?([\s\S]*?)<\/p>([\s\S]*)$/i);
    if (alertMatch) {
      const type = alertMatch[1].toUpperCase();
      const firstLine = alertMatch[2].trim();
      const rest = alertMatch[3] || '';
      const alertMap = {
        NOTE: { title: '说明', icon: 'ℹ️', cls: 'callout-note' },
        TIP: { title: '提示', icon: '💡', cls: 'callout-tip' },
        IMPORTANT: { title: '重要', icon: '📌', cls: 'callout-important' },
        WARNING: { title: '警告', icon: '⚠️', cls: 'callout-warning' },
        CAUTION: { title: '注意', icon: '🛑', cls: 'callout-caution' }
      };
      const info = alertMap[type] || { title: type, icon: '💡', cls: 'callout-tip' };
      return `<div class="callout-block ${info.cls}"><div class="callout-title">${info.icon} <span>${info.title}</span></div><div class="callout-body">${firstLine ? `<p>${firstLine}</p>` : ''}${rest}</div></div>`;
    }
    return `<blockquote>${quote}</blockquote>`;
  };

  renderer.hr = function() {
    return `<hr class="markdown-hr">`;
  };

  marked.use({ renderer, gfm: true, breaks: false });
  isMarkedConfigured = true;
}

// Markdown Renderer with marked.js & Fallback
function renderMarkdown(md) {
  if (!md) return '';

  // Clean excessive empty lines
  const sanitized = md.replace(/\n{3,}/g, '\n\n');

  if (typeof marked !== 'undefined') {
    setupMarked();
    try {
      return marked.parse(sanitized);
    } catch (e) {
      console.warn('marked.parse error, falling back:', e);
    }
  }

  // Robust Fallback Renderer if marked is unavailable
  let html = sanitized;

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

  // Headers (h1 to h6)
  html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr class="markdown-hr">');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

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
  html = html.replace(/^\s*[-*•]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(?:<li>.*?<\/li>\s*)+/gs, match => `<ul>${match}</ul>`);

  // Line breaks to paragraphs
  html = html.split('\n\n').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<div') || trimmed.startsWith('<ul') || trimmed.startsWith('<table') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<hr')) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

// Start app
window.addEventListener('DOMContentLoaded', init);
