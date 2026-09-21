#!/usr/bin/env node

/**
 * Antigravity Web UI Server
 * Multi-workspace AI Coding Agent Interface for LAN
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '3999', 10);
const HOST = process.env.HOST || '0.0.0.0';
const AGY_PATH = process.env.AGY_PATH || '/root/.local/bin/agy';
const BRAIN_DIR = process.env.BRAIN_DIR || '/root/.gemini/antigravity-cli/brain';
const WORKSPACES_FILE = path.join(__dirname, 'data', 'workspaces.json');
const CONV_WORKSPACES_FILE = path.join(__dirname, 'data', 'conversation_workspaces.json');
const AUTH_FILE = path.join(__dirname, 'data', 'auth.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE || process.cwd();
const ACCOUNT_MANAGER_URL = process.env.ACCOUNT_MANAGER_URL || 'http://127.0.0.1:8088';

// Active agent processes: conversation_id -> child_process
const activeProcesses = new Map();
// Active running conversations metadata: conversation_id -> { id, title, created_at, updated_at, is_running: true, workspace: string }
const runningConversationsMeta = new Map();

// Persistent mapping of conversation_id -> workspace path
let conversationWorkspacesMap = new Map();
function loadConversationWorkspaces() {
  try {
    if (fs.existsSync(CONV_WORKSPACES_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONV_WORKSPACES_FILE, 'utf-8'));
      conversationWorkspacesMap = new Map(Object.entries(data));
    }
  } catch (err) {
    console.error('Error loading conversation workspaces:', err);
  }
}
loadConversationWorkspaces();

let saveConvWorkspacesTimer = null;
function saveConversationWorkspace(convId, wsPath) {
  if (!convId || !wsPath) return;
  conversationWorkspacesMap.set(convId, wsPath);
  if (!saveConvWorkspacesTimer) {
    saveConvWorkspacesTimer = setTimeout(() => {
      saveConvWorkspacesTimer = null;
      try {
        const obj = Object.fromEntries(conversationWorkspacesMap);
        fs.mkdirSync(path.dirname(CONV_WORKSPACES_FILE), { recursive: true });
        fs.writeFileSync(CONV_WORKSPACES_FILE, JSON.stringify(obj, null, 2), 'utf-8');
      } catch (e) {
        console.error('Error saving conversation workspaces:', e);
      }
    }, 200);
  }
}

// Authentication Configuration
let AUTH_CONFIG = {
  enabled: true,
  secret_key: process.env.AGY_AUTH_KEY || ''
};

function loadAuthConfig() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      if (data.secret_key) {
        AUTH_CONFIG.secret_key = String(data.secret_key).trim();
        AUTH_CONFIG.enabled = data.enabled !== false;
        return;
      }
    }
  } catch (e) {
    console.error('Error reading auth file:', e);
  }

  if (!AUTH_CONFIG.secret_key) {
    AUTH_CONFIG.secret_key = 'agy_sec_' + crypto.randomBytes(18).toString('hex');
    AUTH_CONFIG.enabled = true;
    try {
      fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
      fs.writeFileSync(AUTH_FILE, JSON.stringify({
        secret_key: AUTH_CONFIG.secret_key,
        enabled: true,
        created_at: new Date().toISOString()
      }, null, 2), { mode: 0o600 });
      console.log(`[Security] Generated new secret key and saved to ${AUTH_FILE}`);
    } catch (err) {
      console.error('Error saving auth file:', err);
    }
  }
}
loadAuthConfig();

// Helper: Check if client IP is private LAN
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = (forwarded ? forwarded.split(',')[0].trim() : '') || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}

function isLanIp(ip) {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  const m172 = ip.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const second = parseInt(m172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 link-local or ULA
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

// Helper: Extract token from request
function extractToken(req, parsedUrl) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.headers['x-agy-token']) {
    return String(req.headers['x-agy-token']).trim();
  }
  if (parsedUrl && parsedUrl.searchParams) {
    if (parsedUrl.searchParams.get('token')) return parsedUrl.searchParams.get('token').trim();
    if (parsedUrl.searchParams.get('key')) return parsedUrl.searchParams.get('key').trim();
  }
  const cookie = req.headers['cookie'];
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)agy_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]).trim();
  }
  return null;
}

// Helper: Constant-time token verification
function isAuthorized(req, parsedUrl) {
  if (!AUTH_CONFIG.enabled || !AUTH_CONFIG.secret_key) return true;
  const token = extractToken(req, parsedUrl);
  if (!token) return false;
  try {
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(AUTH_CONFIG.secret_key);
    if (tokenBuf.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(tokenBuf, keyBuf);
  } catch (e) {
    return false;
  }
}

// Supported Model Families and Reasoning Efforts
const MODEL_FAMILIES = [
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

const AVAILABLE_MODELS = [];
for (const fam of MODEL_FAMILIES) {
  for (const eff of fam.efforts) {
    AVAILABLE_MODELS.push({
      id: eff.id,
      name: `${fam.name} (${eff.label})`,
      family_id: fam.id,
      family_name: fam.name,
      effort: eff.effort,
      effort_label: eff.label,
      default: !!eff.default
    });
  }
}

// Helper: Get Non-internal IPv4 LAN addresses
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        // filter out virtual docker / br interfaces if primary exists
        addresses.push({
          interface: name,
          ip: net.address,
          url: `http://${net.address}:${PORT}`
        });
      }
    }
  }
  return addresses;
}

// Helper: Read Workspaces
function getWorkspaces() {
  try {
    if (fs.existsSync(WORKSPACES_FILE)) {
      const content = fs.readFileSync(WORKSPACES_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Error reading workspaces file:', err);
  }
  return [];
}

// Helper: Save Workspaces
function saveWorkspaces(list) {
  try {
    fs.mkdirSync(path.dirname(WORKSPACES_FILE), { recursive: true });
    fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving workspaces file:', err);
    return false;
  }
}

// Helper: Query SQLite Summaries DB map if available
function getSummariesDbMap() {
  const map = new Map();
  try {
    const dbPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db');
    if (fs.existsSync(dbPath)) {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare('SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries').all();
      for (const r of rows) {
        let ws = null;
        if (r.workspace_uris) {
          try {
            const arr = JSON.parse(r.workspace_uris);
            if (Array.isArray(arr) && arr[0]) {
              ws = arr[0].replace('file://', '');
            }
          } catch (e) {}
        }
        map.set(r.conversation_id, { title: r.title, ws, mtime: r.last_modified_time });
      }
    }
  } catch (e) {
    // Graceful fallback if SQLite is locked or unavailable
  }
  return map;
}

// Helper: Resolve workspace path for a conversation
function resolveConvWorkspacePath(convId, transcriptPath, dbMap) {
  if (conversationWorkspacesMap.has(convId)) {
    return conversationWorkspacesMap.get(convId);
  }
  const runningMeta = runningConversationsMeta.get(convId);
  if (runningMeta && runningMeta.workspace) {
    saveConversationWorkspace(convId, runningMeta.workspace);
    return runningMeta.workspace;
  }
  const dbEntry = dbMap ? dbMap.get(convId) : null;
  if (dbEntry && dbEntry.ws) {
    saveConversationWorkspace(convId, dbEntry.ws);
    return dbEntry.ws;
  }
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      const stat = fs.statSync(transcriptPath);
      const fd = fs.openSync(transcriptPath, 'r');
      const buf = Buffer.alloc(Math.min(stat.size, 65536));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const chunk = buf.toString('utf-8');

      // 1. Rule pattern: <RULE[/opt/1panel/www/sites/.../AGENTS.md]>
      const mRule = chunk.match(/<RULE\[(\/opt\/1panel\/[^\s\"\'\<\>]+)\/AGENTS\.md\]>/);
      if (mRule) {
        saveConversationWorkspace(convId, mRule[1]);
        return mRule[1];
      }
      // 2. Cwd in tool calls: "Cwd": "/opt/..."
      const mCwd = chunk.match(/\"Cwd\":\s*\"(\/opt\/[^\"]+)\"/);
      if (mCwd) {
        saveConversationWorkspace(convId, mCwd[1]);
        return mCwd[1];
      }
      // 3. File paths in user requests or assistant responses
      const mPath = chunk.match(/(\/opt\/1panel\/www\/sites\/[a-zA-Z0-9\._\-]+(?:\/index)?)/);
      if (mPath) {
        saveConversationWorkspace(convId, mPath[1]);
        return mPath[1];
      }
    } catch (e) {}
  }
  return null;
}

// Helper: Classify workspace path into a structured workspace object
function classifyWorkspaceInfo(wsPath, registeredList) {
  if (!wsPath) {
    return {
      workspace_id: 'unclassified',
      workspace_name: '其它 / 未分类',
      workspace_path: '',
      is_registered: false
    };
  }

  const resolved = path.resolve(wsPath);

  // 1. Exact match in registered workspaces
  const exact = registeredList.find(w => path.resolve(w.path) === resolved);
  if (exact) {
    return {
      workspace_id: exact.id,
      workspace_name: exact.name,
      workspace_path: exact.path,
      is_registered: true
    };
  }

  // 2. Prefix match in registered workspaces (most specific, ignoring generic /opt/1panel/www/sites root)
  const matches = registeredList
    .filter(w => resolved.startsWith(path.resolve(w.path)))
    .sort((a, b) => b.path.length - a.path.length);
  if (matches.length > 0 && path.resolve(matches[0].path) !== '/opt/1panel/www/sites') {
    return {
      workspace_id: matches[0].id,
      workspace_name: matches[0].name,
      workspace_path: matches[0].path,
      is_registered: true
    };
  }

  // 3. Extract site name from /opt/1panel/www/sites/<site_name>
  const siteMatch = resolved.match(/\/opt\/1panel\/www\/sites\/([a-zA-Z0-9\._\-]+)/);
  if (siteMatch) {
    const siteName = siteMatch[1];
    const sitePath = `/opt/1panel/www/sites/${siteName}/index`;
    return {
      workspace_id: 'ws_auto_' + siteName.replace(/[^a-zA-Z0-9]/g, '_'),
      workspace_name: siteName,
      workspace_path: fs.existsSync(sitePath) ? sitePath : `/opt/1panel/www/sites/${siteName}`,
      is_registered: false
    };
  }

  // 4. Fallback folder name
  let name = path.basename(resolved);
  if (name === 'index') name = path.basename(path.dirname(resolved));
  return {
    workspace_id: 'ws_auto_' + Buffer.from(resolved).toString('hex').slice(0, 8),
    workspace_name: name,
    workspace_path: resolved,
    is_registered: false
  };
}

// Helper: Parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB limit
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Helper: Serve Static Files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function serveStatic(req, res, pathname, parsedUrl) {
  // Serve uploaded images: /uploads/*
  if (pathname.startsWith('/uploads/')) {
    if (!isAuthorized(req, parsedUrl)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized: Missing or invalid secret key');
      return;
    }
    const filename = path.basename(pathname);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Image Not Found');
      return;
    }
  }

  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';
  
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback to index.html
      const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(fallbackPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(fallbackPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Extract prompt text from USER_REQUEST tags
function cleanUserPrompt(raw) {
  if (!raw) return '';
  const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return raw.trim();
}

// Main HTTP Request Handler
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. LAN Access Enforcement (Defense in depth)
  const clientIp = getClientIp(req);
  if (!isLanIp(clientIp)) {
    console.warn(`[Security] Blocked non-LAN request from ${clientIp} to ${pathname}`);
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '403 Forbidden: Only LAN access allowed.' }));
    return;
  }

  // 2. Auto-set cookie if valid token is provided in query params (?token=xxx or ?key=xxx)
  const queryToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('key');
  if (queryToken && isAuthorized(req, parsedUrl)) {
    res.setHeader('Set-Cookie', `agy_token=${encodeURIComponent(queryToken.trim())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }

  // 3. Auth API Endpoints (accessible from LAN)
  if (pathname === '/api/auth/verify' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const token = (body.token || '').trim();
    if (!token) {
      return sendJson(res, 400, { success: false, error: '请输入访问密钥' });
    }
    let valid = false;
    try {
      const tokenBuf = Buffer.from(token);
      const keyBuf = Buffer.from(AUTH_CONFIG.secret_key);
      valid = (tokenBuf.length === keyBuf.length) && crypto.timingSafeEqual(tokenBuf, keyBuf);
    } catch (e) {}

    if (valid) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `agy_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: true, valid: true, message: '密钥验证成功' }));
      return;
    } else {
      return sendJson(res, 401, { success: false, valid: false, error: '访问密钥错误，请重新输入' });
    }
  }

  if (pathname === '/api/auth/status' && req.method === 'GET') {
    const auth = isAuthorized(req, parsedUrl);
    return sendJson(res, 200, {
      authenticated: auth,
      requires_auth: AUTH_CONFIG.enabled
    });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `agy_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, message: '已退出登录' }));
    return;
  }

  // 4. Protect all other /api/ endpoints with Secret Key
  if (pathname.startsWith('/api/')) {
    if (!isAuthorized(req, parsedUrl)) {
      return sendJson(res, 401, { error: '未授权：需要有效的访问密钥', auth_required: true });
    }
  }

  try {
    // 1. API: System Info & LAN IPs
    if (pathname === '/api/info' && req.method === 'GET') {
      const lanList = getLanAddresses();
      // pick preferred LAN IP (e.g. 192.168.x.x or 10.x.x.x)
      let primaryIp = '127.0.0.1';
      for (const item of lanList) {
        if (item.ip.startsWith('192.168.')) {
          primaryIp = item.ip;
          break;
        }
      }
      if (primaryIp === '127.0.0.1' && lanList.length > 0) {
        primaryIp = lanList[0].ip;
      }

      return sendJson(res, 200, {
        name: 'Antigravity Web UI',
        version: '1.0.0',
        port: PORT,
        primary_lan_ip: primaryIp,
        primary_url: `http://${primaryIp}:${PORT}`,
        lan_interfaces: lanList,
        hostname: os.hostname(),
        models: AVAILABLE_MODELS,
        model_families: MODEL_FAMILIES,
        default_workspace: DEFAULT_WORKSPACE,
        account_manager_url: `http://${primaryIp}:8088`
      });
    }

    // --- Account Manager Integration (http://127.0.0.1:8088) ---
    if (pathname === '/api/account-manager/accounts' && req.method === 'GET') {
      try {
        const response = await fetch(`${ACCOUNT_MANAGER_URL}/api/accounts`);
        const data = await response.json();
        return sendJson(res, response.status, data);
      } catch (err) {
        return sendJson(res, 502, { error: '无法连接到账号管理服务 (8088): ' + err.message });
      }
    }

    if (pathname === '/api/account-manager/best' && req.method === 'GET') {
      try {
        const response = await fetch(`${ACCOUNT_MANAGER_URL}/api/accounts/best`);
        const data = await response.json();
        return sendJson(res, response.status, data);
      } catch (err) {
        return sendJson(res, 502, { error: '无法获取最佳额度账号: ' + err.message });
      }
    }

    if (pathname === '/api/account-manager/switch' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const email = (body.email || '').trim();
        if (!email) {
          return sendJson(res, 400, { error: '请提供要切换的目标账号邮箱' });
        }
        const response = await fetch(`${ACCOUNT_MANAGER_URL}/api/accounts/switch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await response.json();
        return sendJson(res, response.status, data);
      } catch (err) {
        return sendJson(res, 502, { error: '切换账号请求失败: ' + err.message });
      }
    }

    if (pathname === '/api/account-manager/quota/refresh' && req.method === 'POST') {
      try {
        const response = await fetch(`${ACCOUNT_MANAGER_URL}/api/quota/refresh`, {
          method: 'POST'
        });
        const data = await response.json().catch(() => ({ ok: true }));
        return sendJson(res, response.status, data);
      } catch (err) {
        return sendJson(res, 502, { error: '刷新额度请求失败: ' + err.message });
      }
    }

    // 2. API: List Workspaces
    if (pathname === '/api/workspaces' && req.method === 'GET') {
      const workspaces = getWorkspaces();
      return sendJson(res, 200, workspaces);
    }

    // 3. API: Add Workspace
    if (pathname === '/api/workspaces' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const wsPath = (body.path || '').trim();
      const wsName = (body.name || '').trim() || path.basename(wsPath);
      const wsDesc = (body.description || '').trim();

      if (!wsPath) {
        return sendJson(res, 400, { error: 'Workspace path is required' });
      }

      if (!fs.existsSync(wsPath)) {
        return sendJson(res, 400, { error: `Path does not exist on server: ${wsPath}` });
      }

      const stat = fs.statSync(wsPath);
      if (!stat.isDirectory()) {
        return sendJson(res, 400, { error: `Path is not a directory: ${wsPath}` });
      }

      const workspaces = getWorkspaces();
      const existingIndex = workspaces.findIndex(w => path.resolve(w.path) === path.resolve(wsPath));
      
      const newEntry = {
        id: body.id || 'ws_' + Date.now(),
        name: wsName,
        path: path.resolve(wsPath),
        description: wsDesc,
        added_at: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        workspaces[existingIndex] = newEntry;
      } else {
        workspaces.push(newEntry);
      }

      saveWorkspaces(workspaces);
      return sendJson(res, 200, { success: true, workspace: newEntry, workspaces });
    }

    // 4. API: Delete Workspace
    if (pathname === '/api/workspaces' && req.method === 'DELETE') {
      const body = await parseJsonBody(req);
      const wsPath = (body.path || '').trim();
      const wsId = (body.id || '').trim();

      let workspaces = getWorkspaces();
      workspaces = workspaces.filter(w => {
        if (wsId && w.id === wsId) return false;
        if (wsPath && path.resolve(w.path) === path.resolve(wsPath)) return false;
        return true;
      });

      saveWorkspaces(workspaces);
      return sendJson(res, 200, { success: true, workspaces });
    }

    // 4.1 API: Rename / Update Workspace
    if (((pathname === '/api/workspaces/rename') && req.method === 'POST') || (pathname === '/api/workspaces' && req.method === 'PUT')) {
      const body = await parseJsonBody(req);
      const wsPath = (body.path || '').trim();
      const wsId = (body.id || '').trim();
      const newName = (body.name || '').trim();
      const newDesc = body.description !== undefined ? String(body.description).trim() : null;

      if (!newName) {
        return sendJson(res, 400, { error: '工作区名称不能为空' });
      }

      let workspaces = getWorkspaces();
      let target = workspaces.find(w => (wsId && w.id === wsId) || (wsPath && path.resolve(w.path) === path.resolve(wsPath)));

      if (target) {
        target.name = newName;
        if (newDesc !== null) target.description = newDesc;
      } else if (wsPath && fs.existsSync(wsPath)) {
        target = {
          id: wsId || 'ws_' + Date.now(),
          name: newName,
          path: path.resolve(wsPath),
          description: newDesc || '',
          added_at: new Date().toISOString()
        };
        workspaces.push(target);
      } else {
        return sendJson(res, 404, { error: '未找到指定工作区' });
      }

      saveWorkspaces(workspaces);
      return sendJson(res, 200, { success: true, workspace: target, workspaces });
    }

    // 4.2 API: Assign / Change Conversation Workspace
    if (pathname === '/api/conversations/assign-workspace' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const convId = (body.conversation_id || '').trim();
      const wsPath = (body.workspace_path || '').trim();
      if (!convId) {
        return sendJson(res, 400, { error: 'conversation_id required' });
      }
      saveConversationWorkspace(convId, wsPath);
      return sendJson(res, 200, { success: true, conversation_id: convId, workspace_path: wsPath });
    }

    // 5. API: Validate Workspace Path
    if (pathname === '/api/workspaces/validate' && req.method === 'GET') {
      const checkPath = parsedUrl.searchParams.get('path');
      if (!checkPath) {
        return sendJson(res, 400, { error: 'path parameter required' });
      }
      try {
        const resolved = path.resolve(checkPath);
        if (!fs.existsSync(resolved)) {
          return sendJson(res, 200, { exists: false, error: 'Directory does not exist' });
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          return sendJson(res, 200, { exists: false, error: 'Path is a file, not a directory' });
        }
        const isGit = fs.existsSync(path.join(resolved, '.git'));
        return sendJson(res, 200, {
          exists: true,
          isDirectory: true,
          path: resolved,
          name: path.basename(resolved),
          is_git: isGit
        });
      } catch (err) {
        return sendJson(res, 200, { exists: false, error: err.message });
      }
    }

    // 6. API: Browse Server Directories
    if (pathname === '/api/workspaces/browse' && req.method === 'GET') {
      const targetDir = parsedUrl.searchParams.get('dir') || DEFAULT_WORKSPACE || '/';
      try {
        const resolved = path.resolve(targetDir);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          return sendJson(res, 400, { error: '指定目录不存在或不是文件夹: ' + resolved });
        }
        
        let dirs = [];
        try {
          const entries = fs.readdirSync(resolved, { withFileTypes: true });
          dirs = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => {
              const subPath = path.join(resolved, e.name);
              let isGit = false;
              try {
                isGit = fs.existsSync(path.join(subPath, '.git'));
              } catch (_) {}
              return {
                name: e.name,
                path: subPath,
                is_git: isGit
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        } catch (readErr) {
          return sendJson(res, 200, {
            current: resolved,
            parent: resolved === '/' ? null : path.dirname(resolved),
            is_root: resolved === '/',
            directories: [],
            warning: '读取目录失败 (权限不足): ' + readErr.message
          });
        }

        return sendJson(res, 200, {
          current: resolved,
          parent: resolved === '/' ? null : path.dirname(resolved),
          is_root: resolved === '/',
          directories: dirs
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // 7. API: List Conversations
    if (pathname === '/api/conversations' && req.method === 'GET') {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
      const filterWs = (parsedUrl.searchParams.get('workspace') || '').trim();
      const registeredWorkspaces = getWorkspaces();
      const dbMap = getSummariesDbMap();
      const conversations = [];

      if (fs.existsSync(BRAIN_DIR)) {
        const dirs = fs.readdirSync(BRAIN_DIR);
        for (const dir of dirs) {
          const transcriptPath = path.join(BRAIN_DIR, dir, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(transcriptPath)) {
            try {
              const stat = fs.statSync(transcriptPath);
              // Read first 32KB to get first user prompt
              const fd = fs.openSync(transcriptPath, 'r');
              const buffer = Buffer.alloc(Math.min(stat.size, 32768));
              fs.readSync(fd, buffer, 0, buffer.length, 0);
              fs.closeSync(fd);

              const chunkStr = buffer.toString('utf-8');
              const firstLine = chunkStr.split('\n')[0];
              let title = '';
              let createdAt = stat.birthtime;
              if (firstLine) {
                try {
                  const parsed = JSON.parse(firstLine);
                  if (parsed.content) {
                    title = cleanUserPrompt(parsed.content).slice(0, 100);
                  }
                  if (parsed.created_at) {
                    createdAt = new Date(parsed.created_at);
                  }
                } catch (e) {}
              }

              if (!title) {
                title = dbMap.get(dir)?.title || 'Conversation';
              }

              const isRunning = activeProcesses.has(dir) || runningConversationsMeta.has(dir);
              const wsPath = resolveConvWorkspacePath(dir, transcriptPath, dbMap);
              const wsInfo = classifyWorkspaceInfo(wsPath, registeredWorkspaces);

              conversations.push({
                id: dir,
                title: title || 'New Conversation',
                created_at: createdAt,
                updated_at: stat.mtime,
                size: stat.size,
                is_running: isRunning,
                status: isRunning ? 'running' : 'completed',
                workspace_id: wsInfo.workspace_id,
                workspace_name: wsInfo.workspace_name,
                workspace_path: wsInfo.workspace_path
              });
            } catch (err) {
              // ignore unreadable
            }
          }
        }
      }

      // Merge active memory conversations that haven't written to disk yet
      for (const [rId, meta] of runningConversationsMeta.entries()) {
        if (!conversations.some(c => c.id === rId)) {
          const wsPath = meta.workspace || null;
          const wsInfo = classifyWorkspaceInfo(wsPath, registeredWorkspaces);
          conversations.unshift({
            id: rId,
            title: meta.title || '正在运行的任务',
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            size: 0,
            is_running: true,
            status: 'running',
            workspace_id: wsInfo.workspace_id,
            workspace_name: wsInfo.workspace_name,
            workspace_path: wsInfo.workspace_path
          });
        }
      }

      // Sort by updated_at desc, keeping running ones top
      conversations.sort((a, b) => {
        if (a.is_running && !b.is_running) return -1;
        if (!a.is_running && b.is_running) return 1;
        return new Date(b.updated_at) - new Date(a.updated_at);
      });

      // Filter by workspace if requested
      let filtered = conversations;
      if (filterWs) {
        filtered = conversations.filter(c => {
          if (c.workspace_id === filterWs) return true;
          if (c.workspace_path && path.resolve(c.workspace_path) === path.resolve(filterWs)) return true;
          return false;
        });
      }

      return sendJson(res, 200, filtered.slice(0, limit));
    }

    // 8. API: Get Conversation Details
    if (pathname.startsWith('/api/conversations/') && req.method === 'GET') {
      const convId = pathname.replace('/api/conversations/', '').trim();
      const transcriptPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
      const isRunning = activeProcesses.has(convId) || runningConversationsMeta.has(convId);
      
      if (!fs.existsSync(transcriptPath)) {
        if (isRunning) {
          return sendJson(res, 200, {
            id: convId,
            messages: [],
            total_steps: 0,
            is_running: true,
            status: 'running'
          });
        }
        return sendJson(res, 404, { error: 'Conversation not found' });
      }

      try {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        const messages = [];
        let currentAssistant = null;

        function commitAssistant() {
          if (!currentAssistant) return;
          const trimmedContent = (currentAssistant.content || '').trim();
          const trimmedThinking = (currentAssistant.thinking || '').trim();
          if (trimmedContent || trimmedThinking) {
            messages.push({
              id: currentAssistant.id,
              role: 'assistant',
              content: trimmedContent,
              thinking: trimmedThinking,
              timestamp: currentAssistant.timestamp
            });
          }
          currentAssistant = null;
        }

        for (const line of lines) {
          try {
            const row = JSON.parse(line);
            if (row.type === 'USER_INPUT') {
              commitAssistant();
              messages.push({
                id: `step_${row.step_index}`,
                role: 'user',
                content: cleanUserPrompt(row.content),
                timestamp: row.created_at
              });
            } else if (row.type === 'PLANNER_RESPONSE') {
              if (!currentAssistant) {
                currentAssistant = {
                  id: `step_${row.step_index}`,
                  role: 'assistant',
                  content: '',
                  thinking: '',
                  timestamp: row.created_at
                };
              }
              if (row.thinking) {
                if (currentAssistant.thinking) {
                  currentAssistant.thinking += '\n\n' + row.thinking;
                } else {
                  currentAssistant.thinking = row.thinking;
                }
              }
              if (row.content) {
                if (currentAssistant.content) {
                  currentAssistant.content += '\n' + row.content;
                } else {
                  currentAssistant.content = row.content;
                }
              }
              if (row.created_at) {
                currentAssistant.timestamp = row.created_at;
              }
            }
          } catch (e) {}
        }
        commitAssistant();

        return sendJson(res, 200, {
          id: convId,
          messages,
          total_steps: lines.length,
          is_running: isRunning,
          status: isRunning ? 'running' : 'completed'
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // 9. API: Stop Agent Execution
    if (pathname === '/api/chat/stop' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const convId = body.conversation_id || body.session_id;
      if (convId && (activeProcesses.has(convId) || runningConversationsMeta.has(convId))) {
        const child = activeProcesses.get(convId);
        if (child) {
          try {
            child.kill('SIGTERM');
            setTimeout(() => {
              try { child.kill('SIGKILL'); } catch (e) {}
            }, 1500);
          } catch (e) {}
        }
        activeProcesses.delete(convId);
        runningConversationsMeta.delete(convId);
        return sendJson(res, 200, { success: true, message: 'Agent stopped' });
      }
      return sendJson(res, 200, { success: true, message: 'No active process found' });
    }

    // 9.5. API: Upload File / Image (Base64) - 保存到当前工作区的 agyweb-uploads 目录
    if (pathname === '/api/upload' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const dataUrl = body.file || body.image || body.data;
      const originalName = (body.name || '').trim();
      const wsPath = (body.workspace || '').trim();
      if (!dataUrl) {
        return sendJson(res, 400, { error: 'No file or image data provided' });
      }

      // 确定上传目录：在当前工作区下创建 agyweb-uploads 文件夹
      let targetUploadDir = path.join(__dirname, 'data', 'agyweb-uploads');
      if (wsPath && fs.existsSync(wsPath) && fs.statSync(wsPath).isDirectory()) {
        targetUploadDir = path.join(path.resolve(wsPath), 'agyweb-uploads');
      } else {
        const defaultRoot = DEFAULT_WORKSPACE;
        if (fs.existsSync(defaultRoot)) {
          targetUploadDir = path.join(defaultRoot, 'agyweb-uploads');
        }
      }

      try {
        fs.mkdirSync(targetUploadDir, { recursive: true });
        try { fs.chownSync(targetUploadDir, 1000, 1000); } catch (e) {}
      } catch (err) {
        console.error('Failed to create target upload dir:', err);
      }

      let ext = originalName ? path.extname(originalName).toLowerCase() : '';
      let buffer;
      let isImage = false;

      const matches = dataUrl.match(/^data:([A-Za-z0-9\/\-+.]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mime = matches[1].toLowerCase();
        if (mime.startsWith('image/')) isImage = true;
        if (!ext) {
          if (mime === 'image/jpeg' || mime === 'image/jpg') ext = '.jpg';
          else if (mime === 'image/webp') ext = '.webp';
          else if (mime === 'image/gif') ext = '.gif';
          else if (mime === 'image/svg+xml') ext = '.svg';
          else if (mime === 'image/png') ext = '.png';
          else if (mime === 'application/pdf') ext = '.pdf';
          else if (mime === 'text/plain') ext = '.txt';
          else if (mime === 'application/json') ext = '.json';
          else ext = '.bin';
        }
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(dataUrl, 'base64');
      }

      if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
        isImage = true;
      }

      let filename;
      const timestamp = Date.now();
      const randStr = Math.random().toString(36).substring(2, 7);

      if (originalName && originalName !== 'pasted_image.png' && originalName !== 'blob') {
        const baseName = path.basename(originalName, ext).replace(/[^\w\u4e00-\u9fa5\-_.]/g, '_') || 'file';
        filename = `${baseName}_${timestamp.toString(36)}_${randStr}${ext || ''}`;
      } else {
        filename = `img_${timestamp}_${randStr}${ext || '.png'}`;
      }

      const filePath = path.join(targetUploadDir, filename);
      fs.writeFileSync(filePath, buffer);
      try { fs.chownSync(filePath, 1000, 1000); } catch (e) {}

      const resolvedPath = path.resolve(filePath);
      return sendJson(res, 200, {
        success: true,
        filename,
        original_name: originalName,
        is_image: isImage,
        url: `/api/file-view?path=${encodeURIComponent(resolvedPath)}`,
        server_path: resolvedPath
      });
    }

    // 9.6. API: Serve Local Workspace File / Image
    if ((pathname === '/api/image-file' || pathname === '/api/file-view') && (req.method === 'GET' || req.method === 'HEAD')) {
      const filePath = parsedUrl.searchParams.get('path');
      if (filePath && fs.existsSync(filePath)) {
        try {
          const resolved = path.resolve(filePath);
          const stat = fs.statSync(resolved);
          if (stat.isFile()) {
            const ext = path.extname(resolved).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400'
            });
            fs.createReadStream(resolved).pipe(res);
            return;
          }
        } catch (e) {}
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    // 10. API: Chat (SSE Streaming)
    if (pathname === '/api/chat' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const prompt = (body.prompt || '').trim();
      let workspace = (body.workspace || '').trim();
      const conversationId = (body.conversation_id || '').trim();
      const model = (body.model || 'gemini-3.8-flash-high').trim();
      const mode = (body.mode || 'accept-edits').trim(); // 'accept-edits' or 'plan'
      const effort = (body.effort || 'high').trim();
      const images = body.images || [];

      if (!prompt && images.length === 0) {
        return sendJson(res, 400, { error: 'Prompt or image is required' });
      }

      // Check workspace
      if (!workspace || !fs.existsSync(workspace)) {
        workspace = DEFAULT_WORKSPACE;
      }

      // 对话指令：直接输入文件路径即可，若用户输入框已包含该路径则不重复拼接
      let finalPrompt = prompt;
      if (Array.isArray(images) && images.length > 0) {
        const missingPaths = images
          .map(img => (typeof img === 'string' ? img : img.server_path))
          .filter(p => p && !finalPrompt.includes(p))
          .join('\n');
        if (missingPaths) {
          finalPrompt = finalPrompt ? `${missingPaths}\n${finalPrompt}` : missingPaths;
        }
      }

      // Setup SSE response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no'
      });

      const sendEvent = (event, data) => {
        if (res.writable && !res.writableEnded && !res.destroyed) {
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch (e) {
            // Client socket disconnected/backgrounded; ignore write error
          }
        }
      };

      // Periodic SSE keep-alive heartbeat for mobile carriers and proxies
      const heartbeatTimer = setInterval(() => {
        if (res.writable && !res.writableEnded && !res.destroyed) {
          try {
            res.write(': keepalive\n\n');
          } catch (e) {}
        }
      }, 15000);

      // Construct CLI Arguments
      const args = [
        '--output-format', 'stream-json',
        '-p', finalPrompt,
        '--dangerously-skip-permissions'
      ];

      if (conversationId) {
        args.push('--conversation', conversationId);
      }
      if (model) {
        args.push('--model', model);
      }
      if (mode) {
        args.push('--mode', mode);
      }
      if (effort) {
        args.push('--effort', effort);
      }

      sendEvent('status', { status: 'starting', workspace, model, mode });

      console.log(`[Chat] Spawning agy in ${workspace} (model=${model}, conv=${conversationId || 'new'})`);

      let child;
      try {
        child = spawn(AGY_PATH, args, {
          cwd: workspace,
          env: {
            ...process.env,
            PAGER: 'cat',
            FORCE_COLOR: '0',
            TERM: 'dumb'
          }
        });
      } catch (err) {
        sendEvent('error', { error: `Failed to spawn agent: ${err.message}` });
        res.end();
        return;
      }

      const sessionKey = conversationId || `tmp_${Date.now()}`;
      activeProcesses.set(sessionKey, child);
      runningConversationsMeta.set(sessionKey, {
        id: sessionKey,
        title: prompt.slice(0, 80) || '正在运行的任务',
        created_at: new Date(),
        updated_at: new Date(),
        is_running: true,
        workspace: workspace
      });
      if (conversationId && workspace) {
        saveConversationWorkspace(conversationId, workspace);
      }

      let stdoutBuffer = '';
      let detectedConvId = conversationId;

      child.stdout.on('data', chunk => {
        stdoutBuffer += chunk.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop(); // keep last partial line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (data.conversation_id && !detectedConvId) {
              detectedConvId = data.conversation_id;
              activeProcesses.set(detectedConvId, child);
              runningConversationsMeta.delete(sessionKey);
              runningConversationsMeta.set(detectedConvId, {
                id: detectedConvId,
                title: prompt.slice(0, 80) || '正在运行的任务',
                created_at: new Date(),
                updated_at: new Date(),
                is_running: true,
                workspace: workspace
              });
              saveConversationWorkspace(detectedConvId, workspace);
            }

            if (data.event === 'init') {
              sendEvent('init', {
                conversation_id: data.conversation_id,
                cwd: data.init?.cwd,
                tools: data.init?.tools,
                permission_mode: data.init?.permission_mode
              });
            } else if (data.event === 'step_update') {
              const su = data.step_update || {};
              sendEvent('step', {
                conversation_id: su.conversation_id,
                step_index: su.step_index,
                state: su.state,
                step_type: su.step_type,
                text_delta: su.text_delta,
                duration_seconds: su.duration_seconds,
                usage: su.usage,
                tool_name: su.tool_name,
                tool_info: su.tool_info
              });
            } else if (data.event === 'result') {
              sendEvent('result', data.result);
              const resStr = JSON.stringify(data.result || {});
              if (/RESOURCE_EXHAUSTED|quota exceeded|Rate limit|Too Many Requests|429|exceeded your current quota|Capacity exhausted/i.test(resStr)) {
                sendEvent('quota_exhausted', { message: resStr });
              }
            } else {
              sendEvent('raw', data);
            }
          } catch (e) {
            // Non-JSON line from agy (e.g. log message)
            sendEvent('log', { message: trimmed });
            if (/RESOURCE_EXHAUSTED|quota exceeded|Rate limit|Too Many Requests|429|exceeded your current quota|Capacity exhausted/i.test(trimmed)) {
              sendEvent('quota_exhausted', { message: trimmed });
            }
          }
        }
      });

      child.stderr.on('data', chunk => {
        const text = chunk.toString('utf-8').trim();
        if (text) {
          sendEvent('stderr', { message: text });
          if (/RESOURCE_EXHAUSTED|quota exceeded|Rate limit|Too Many Requests|429|exceeded your current quota|Capacity exhausted/i.test(text)) {
            sendEvent('quota_exhausted', { message: text });
          }
        }
      });

      child.on('close', code => {
        clearInterval(heartbeatTimer);
        activeProcesses.delete(sessionKey);
        runningConversationsMeta.delete(sessionKey);
        if (detectedConvId) {
          activeProcesses.delete(detectedConvId);
          runningConversationsMeta.delete(detectedConvId);
        }

        // Process any remaining buffer
        if (stdoutBuffer.trim()) {
          try {
            const data = JSON.parse(stdoutBuffer.trim());
            sendEvent('raw', data);
          } catch (e) {
            sendEvent('log', { message: stdoutBuffer.trim() });
          }
        }

        sendEvent('done', {
          exit_code: code,
          conversation_id: detectedConvId
        });
        if (res.writable && !res.writableEnded) {
          try { res.end(); } catch (e) {}
        }
      });

      child.on('error', err => {
        clearInterval(heartbeatTimer);
        activeProcesses.delete(sessionKey);
        runningConversationsMeta.delete(sessionKey);
        if (detectedConvId) {
          activeProcesses.delete(detectedConvId);
          runningConversationsMeta.delete(detectedConvId);
        }
        sendEvent('error', { error: err.message });
        if (res.writable && !res.writableEnded) {
          try { res.end(); } catch (e) {}
        }
      });

      // If client closes or backgrounds connection
      req.on('close', () => {
        clearInterval(heartbeatTimer);
        console.log(`[Chat] Client disconnected/backgrounded for session ${sessionKey}. Process PID ${child.pid} will continue running in background.`);
      });

      return;
    }

    // 11. Static File Serving (Web UI)
    return serveStatic(req, res, pathname, parsedUrl);

  } catch (globalErr) {
    console.error('Server error:', globalErr);
    return sendJson(res, 500, { error: globalErr.message });
  }
});

// Start Server
server.listen(PORT, HOST, () => {
  const lanList = getLanAddresses();
  console.log(`\n======================================================`);
  console.log(`🚀 Antigravity Web UI running on http://${HOST}:${PORT}`);
  console.log(`======================================================`);
  console.log(`🔒 Security Status:   Active (LAN Only + Secret Key Protection)`);
  console.log(`🔑 Current Secret:    ${AUTH_CONFIG.secret_key}`);
  console.log(`📍 Local URL:         http://127.0.0.1:${PORT}`);
  if (lanList.length > 0) {
    console.log(`🌐 LAN URLs:`);
    lanList.forEach(item => {
      console.log(`   👉 ${item.interface.padEnd(8)}: ${item.url}`);
    });
  }
  console.log(`📁 Default Workspace: ${DEFAULT_WORKSPACE}`);
  console.log(`🤖 Agent Backend:      ${AGY_PATH}`);
  console.log(`======================================================\n`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping Antigravity Web UI...');
  for (const [id, child] of activeProcesses.entries()) {
    try { child.kill('SIGTERM'); } catch (e) {}
  }
  process.exit(0);
});
