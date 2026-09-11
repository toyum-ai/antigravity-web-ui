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
const AUTH_FILE = path.join(__dirname, 'data', 'auth.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE || process.cwd();

// Active agent processes: conversation_id -> child_process
const activeProcesses = new Map();
// Active running conversations metadata: conversation_id -> { id, title, created_at, updated_at, is_running: true }
const runningConversationsMeta = new Map();

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

// Supported Models
const AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High Reasoning)', default: true },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High Reasoning)' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
];

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
  '.zip': 'application/zip'
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
        default_workspace: DEFAULT_WORKSPACE
      });
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
      const targetDir = parsedUrl.searchParams.get('dir') || DEFAULT_WORKSPACE;
      try {
        const resolved = path.resolve(targetDir);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          return sendJson(res, 400, { error: 'Invalid directory' });
        }
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            path: path.join(resolved, e.name)
          }));
        return sendJson(res, 200, {
          current: resolved,
          parent: path.dirname(resolved),
          directories: dirs
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // 7. API: List Conversations
    if (pathname === '/api/conversations' && req.method === 'GET') {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
      const conversations = [];

      if (fs.existsSync(BRAIN_DIR)) {
        const dirs = fs.readdirSync(BRAIN_DIR);
        for (const dir of dirs) {
          const transcriptPath = path.join(BRAIN_DIR, dir, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(transcriptPath)) {
            try {
              const stat = fs.statSync(transcriptPath);
              // Read first 20KB to get first user prompt
              const fd = fs.openSync(transcriptPath, 'r');
              const buffer = Buffer.alloc(Math.min(stat.size, 32768));
              fs.readSync(fd, buffer, 0, buffer.length, 0);
              fs.closeSync(fd);

              const chunkStr = buffer.toString('utf-8');
              const firstLine = chunkStr.split('\n')[0];
              let title = 'Conversation';
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

              const isRunning = activeProcesses.has(dir) || runningConversationsMeta.has(dir);
              conversations.push({
                id: dir,
                title: title || 'New Conversation',
                created_at: createdAt,
                updated_at: stat.mtime,
                size: stat.size,
                is_running: isRunning,
                status: isRunning ? 'running' : 'completed'
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
          conversations.unshift({
            id: rId,
            title: meta.title || '正在运行的任务',
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            size: 0,
            is_running: true,
            status: 'running'
          });
        }
      }

      // Sort by updated_at desc, keeping running ones top
      conversations.sort((a, b) => {
        if (a.is_running && !b.is_running) return -1;
        if (!a.is_running && b.is_running) return 1;
        return new Date(b.updated_at) - new Date(a.updated_at);
      });

      return sendJson(res, 200, conversations.slice(0, limit));
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
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

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
        is_running: true
      });

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
                is_running: true
              });
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
            } else {
              sendEvent('raw', data);
            }
          } catch (e) {
            // Non-JSON line from agy (e.g. log message)
            sendEvent('log', { message: trimmed });
          }
        }
      });

      child.stderr.on('data', chunk => {
        const text = chunk.toString('utf-8').trim();
        if (text) {
          sendEvent('stderr', { message: text });
        }
      });

      child.on('close', code => {
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
        res.end();
      });

      child.on('error', err => {
        activeProcesses.delete(sessionKey);
        runningConversationsMeta.delete(sessionKey);
        if (detectedConvId) {
          activeProcesses.delete(detectedConvId);
          runningConversationsMeta.delete(detectedConvId);
        }
        sendEvent('error', { error: err.message });
        res.end();
      });

      // If client closes connection
      req.on('close', () => {
        // keep process running or kill? For web chat, let's keep running or cleanup if early disconnect
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
