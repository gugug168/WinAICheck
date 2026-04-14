import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ORIGIN = 'https://aicoevo.net';
const MAX_CAPTURE_CHARS = 8000;
const MAX_UPLOAD_EVENTS = 50;
const FAILURE_LOOP_THRESHOLD = 5;
const HOOK_START = '# >>> WinAICheck Agent Hook >>>';
const HOOK_END = '# <<< WinAICheck Agent Hook <<<';

const SENSITIVE_PATTERNS = [
  { regex: /(?:sk-|api[_-]?key[_-]?)([a-zA-Z0-9_-]{20,})/gi, replacement: '<API_KEY>' },
  { regex: /sk-proj-[A-Za-z0-9\-_]{20,}/g, replacement: '<API_KEY>' },
  { regex: /sk-ant-[A-Za-z0-9\-_]{20,}/g, replacement: '<API_KEY>' },
  { regex: /Bearer\s+[a-zA-Z0-9._-]+/gi, replacement: 'Bearer <TOKEN>' },
  { regex: /gh[pous]_[A-Za-z0-9]{30,}/g, replacement: '<GITHUB_TOKEN>' },
  { regex: /github_pat_[A-Za-z0-9_]{22,}/g, replacement: '<GITHUB_TOKEN>' },
  { regex: /npm_[A-Za-z0-9]{30,}/g, replacement: '<NPM_TOKEN>' },
  { regex: /AKIA[0-9A-Z]{16}/g, replacement: '<AWS_ACCESS_KEY>' },
  { regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g, replacement: '<PRIVATE_KEY>' },
  { regex: /https:\/\/[^@\s]+:[^@\s]+@/g, replacement: 'https://<BASIC_AUTH>@' },
  { regex: /http:\/\/[^@\s]+:[^@\s]+@/g, replacement: 'http://<BASIC_AUTH>@' },
  { regex: /(?:mongodb|postgres|postgresql|mysql|redis|amqp):\/\/[^\s"',;)}\]]{10,}/gi, replacement: '<DATABASE_URL>' },
  { regex: /C:\\Users\\([^\\\/\s]+)/gi, replacement: 'C:\\Users\\<USER>' },
  { regex: /\b(\d{1,3}\.){3}\d{1,3}\b/g, replacement: '<IP>' },
  { regex: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '<EMAIL>' },
  { regex: /(?:OPENAI|ANTHROPIC|OPENROUTER|OPENCLAW|DASHSCOPE|ZHIPU|MOONSHOT|GEMINI)[\w-]*(?:KEY|TOKEN)?\s*=\s*[^\s]+/gi, replacement: '<SECRET_ENV>' },
];

function getHome() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir() || process.cwd();
}

function getBaseDir(deps = {}) {
  return deps.baseDir || path.join(getHome(), '.aicoevo');
}

function paths(deps = {}) {
  const base = getBaseDir(deps);
  return {
    base,
    config: path.join(base, 'config.json'),
    hooks: path.join(base, 'hooks.json'),
    outbox: path.join(base, 'outbox', 'events.jsonl'),
    ledger: path.join(base, 'uploads', 'ledger.jsonl'),
    adviceJson: path.join(base, 'advice', 'latest.json'),
    adviceMd: path.join(base, 'advice', 'latest.md'),
    dailyDir: path.join(base, 'daily'),
    agentDir: path.join(base, 'agent'),
    agentJs: path.join(base, 'agent', 'agent-lite.js'),
    agentCmd: path.join(base, 'agent', 'winaicheck-agent.cmd'),
    experience: path.join(base, 'experience.jsonl'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureParent(file) {
  ensureDir(path.dirname(file));
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data, mode = 0o600) {
  ensureParent(file);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode });
}

function appendJsonl(file, data) {
  ensureParent(file);
  fs.appendFileSync(file, `${JSON.stringify(data)}\n`, 'utf8');
}

const MAX_JSONL_READ = 5000;

function readJsonl(file, maxRows = MAX_JSONL_READ) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const result = [];
  // Read from the end to get the most recent entries
  for (let i = lines.length - 1; i >= 0 && result.length < maxRows; i--) {
    if (!lines[i]) continue;
    try { result.push(JSON.parse(lines[i])); } catch { /* skip */ }
  }
  return result.reverse();
}

function writeJsonl(file, rows) {
  ensureParent(file);
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

const MAX_LEDGER_ENTRIES = 500;

function appendJsonlWithRotation(file, data) {
  appendJsonl(file, data);
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length > MAX_LEDGER_ENTRIES) {
      writeJsonl(file, lines.slice(-MAX_LEDGER_ENTRIES).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
    }
  } catch { /* rotation failure is non-critical */ }
}

export function sanitizeText(text) {
  let result = String(text || '');
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

function trimForCapture(text) {
  const sanitized = sanitizeText(text);
  if (sanitized.length <= MAX_CAPTURE_CHARS) return sanitized;
  return `${sanitized.slice(0, MAX_CAPTURE_CHARS)}\n<TRUNCATED>`;
}

const EXPERIENCE_PATTERNS = [
  {
    patterns: ['ModuleNotFoundError', 'No module named', 'ImportError'],
    title: 'Python 模块缺失',
    advice: '安装缺失的 Python 依赖后重试。',
    commands: ['pip install <module>', 'pip3 install <module>'],
  },
  {
    patterns: ['SyntaxError:', 'IndentationError', 'TabError'],
    title: 'Python 语法错误',
    advice: '检查报错文件附近的缩进、括号和语法。',
    commands: ['python -m py_compile <file>'],
  },
  {
    patterns: ['TypeError:', 'AttributeError:', 'KeyError:', 'ValueError:'],
    title: 'Python 运行时错误',
    advice: '检查变量类型、空值、字典键和对象属性是否符合预期。',
    commands: [],
  },
  {
    patterns: ['alembic'],
    title: 'Alembic 数据库迁移工具缺失',
    advice: '当前环境缺少 alembic，先安装项目依赖或单独安装 alembic。',
    commands: ['pip install alembic'],
  },
  {
    patterns: ['Permission denied', 'EACCES', 'operation not permitted', '拒绝访问'],
    title: '权限错误',
    advice: '检查文件权限，必要时用管理员 PowerShell 重新执行。',
    commands: ['whoami /priv'],
  },
  {
    patterns: ['ECONNREFUSED', 'Connection refused'],
    title: '连接被拒绝',
    advice: '目标服务未启动或端口不可达，先确认本地服务和代理状态。',
    commands: ['netstat -ano | findstr <port>'],
  },
  {
    patterns: ['ETIMEDOUT', 'Timed out', 'timeout', '超时'],
    title: '连接超时',
    advice: '网络请求超时，检查代理、DNS、证书或稍后重试。',
    commands: [],
  },
  {
    patterns: ['MCP server error', 'mcp server', 'MCP error', 'mcpServers'],
    title: 'MCP 配置或服务错误',
    advice: '检查 MCP JSON 配置、命令路径和对应服务日志。',
    commands: ['claude mcp list'],
  },
  {
    patterns: ['unknown flag:', 'unknown option', 'invalid option', 'Unknown skill:'],
    title: '命令参数错误',
    advice: '当前命令参数不被支持，先查看该命令的帮助输出。',
    commands: ['<cmd> --help'],
  },
  {
    patterns: ['fatal:', 'not an empty directory', 'needs merge'],
    title: 'Git 操作错误',
    advice: '检查仓库状态、冲突和远端同步情况。',
    commands: ['git status', 'git pull --rebase'],
  },
  {
    patterns: ['command not found', 'not found:', 'ENOENT', '不是内部或外部命令'],
    title: '命令不存在',
    advice: '缺少可执行命令，检查 PATH 或安装对应工具。',
    commands: ['where.exe <cmd>'],
  },
  {
    patterns: ['Traceback', 'most recent call last'],
    title: '代码执行错误',
    advice: '根据堆栈顶部和底部定位真正的异常来源。',
    commands: [],
  },
  {
    patterns: ['GraphQL:', 'GitHub API'],
    title: 'GitHub API 错误',
    advice: '检查 GitHub 登录状态、权限范围和网络连接。',
    commands: ['gh auth status'],
  },
  {
    patterns: ['npm', 'node_modules', 'package.json'],
    title: 'Node.js 项目问题',
    advice: '检查 Node.js 版本和依赖安装状态。',
    commands: ['npm install', 'node --version'],
  },
];

function lookupExperience(message) {
  const text = String(message || '').toLowerCase();
  for (const item of EXPERIENCE_PATTERNS) {
    if (item.patterns.some(pattern => text.includes(pattern.toLowerCase()))) {
      return {
        title: item.title,
        advice: item.advice,
        commands: item.commands || [],
      };
    }
  }
  return null;
}

function appendExperience(event, experience, deps = {}) {
  appendJsonl(paths(deps).experience, {
    fingerprint: event.fingerprint,
    eventType: event.eventType,
    title: experience.title,
    advice: experience.advice,
    commands: experience.commands,
    happenedAt: nowIso(deps),
    resolved: false,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function shortHash(value) {
  return sha256(value).slice(0, 16);
}

function nowIso(deps = {}) {
  return deps.now ? deps.now().toISOString() : new Date().toISOString();
}

function today(deps = {}) {
  return nowIso(deps).slice(0, 10);
}

function loadConfig(deps = {}) {
  const p = paths(deps);
  const hadExisting = fs.existsSync(p.config);
  let oldIds = null;
  if (hadExisting) {
    try { const raw = JSON.parse(fs.readFileSync(p.config, 'utf8')); oldIds = { clientId: raw.clientId, deviceId: raw.deviceId }; } catch { /* corrupt */ }
  }
  const config = readJson(p.config, {});
  if (!config.clientId) config.clientId = `client_${crypto.randomUUID()}`;
  if (!config.deviceId) config.deviceId = `device_${crypto.randomUUID()}`;
  if (config.shareData === undefined) config.shareData = false;
  if (config.autoSync === undefined) config.autoSync = false;
  if (config.paused === undefined) config.paused = false;
  // If IDs were regenerated, back up old config
  if (oldIds && (oldIds.clientId && oldIds.clientId !== config.clientId)) {
    try {
      const backupPath = `${p.config}.lost-${Date.now()}.bak`;
      fs.copyFileSync(p.config, backupPath);
    } catch { /* non-critical */ }
  }
  writeJson(p.config, config);
  return config;
}

function saveConfig(config, deps = {}) {
  writeJson(paths(deps).config, config);
}

function normalizeAgent(value) {
  const agent = String(value || 'custom').toLowerCase();
  if (agent === 'claude' || agent === 'claude-code' || agent === 'claude_code') return 'claude-code';
  if (agent === 'openclaw' || agent === 'open-claw') return 'openclaw';
  return 'custom';
}

function classifyEvent(agent, message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('mcp') || text.includes('mcpservers')) return 'mcp_error';
  if (text.includes('config') || text.includes('json') || text.includes('配置')) return 'agent_config';
  if (text.includes('traceback') || text.includes('syntaxerror') || text.includes('typeerror') || text.includes('编译') || text.includes('build failed')) {
    return 'coding_error_summary';
  }
  return agent === 'custom' ? 'coding_error_summary' : 'agent_runtime';
}

function severityFromMessage(message, fallback = 'error') {
  const text = String(message || '').toLowerCase();
  if (text.includes('warn') || text.includes('warning') || text.includes('警告')) return 'warn';
  if (text.includes('info')) return 'info';
  return fallback;
}

function localContext() {
  return {
    os: `${os.platform()} ${os.release()}`,
    shell: process.env.SHELL || process.env.ComSpec || undefined,
    node: process.version,
    cwdHash: shortHash(process.cwd()),
  };
}

export function createEvent(input, deps = {}) {
  const config = loadConfig(deps);
  const agent = normalizeAgent(input.agent);
  const sanitizedMessage = trimForCapture(input.message);
  const eventType = input.eventType || classifyEvent(agent, sanitizedMessage);
  const occurredAt = input.occurredAt || nowIso(deps);
  const fingerprint = input.fingerprint || shortHash(`${agent}\n${eventType}\n${sanitizedMessage.replace(/\d+/g, '<N>')}`);

  return {
    schemaVersion: 1,
    eventId: input.eventId || `evt_${crypto.randomUUID()}`,
    clientId: config.clientId,
    deviceId: config.deviceId,
    source: 'winaicheck-lite',
    agent,
    eventType,
    occurredAt,
    fingerprint,
    sanitizedMessage,
    severity: input.severity || severityFromMessage(sanitizedMessage),
    localContext: localContext(),
    syncStatus: 'pending',
  };
}

let _dailyMutex = Promise.resolve();

function updateDaily(event, deps = {}) {
  const prev = _dailyMutex;
  let resolve;
  _dailyMutex = new Promise(r => { resolve = r; });
  // Synchronous mutex: queue writes
  // Since this is sync file I/O, we just serialize calls
  try {
    const p = paths(deps);
    const date = event.occurredAt.slice(0, 10);
    const file = path.join(p.dailyDir, `${date}.json`);
    const pack = readJson(file, {
      date,
      totalEvents: 0,
      uniqueFingerprints: 0,
      repeatedEvents: 0,
      fixedEvents: 0,
      consecutiveFailures: 0,
      lastFailureFingerprint: null,
      lastEventAt: null,
      topProblems: [],
    });

    pack.totalEvents += 1;
    pack.lastEventAt = event.occurredAt;
    const problem = pack.topProblems.find(item => item.fingerprint === event.fingerprint);
    if (problem) {
      problem.count += 1;
      problem.status = 'repeated';
      pack.repeatedEvents += 1;
    } else {
      pack.topProblems.push({
        fingerprint: event.fingerprint,
        title: event.sanitizedMessage.split(/\r?\n/)[0].slice(0, 120) || event.eventType,
        count: 1,
        status: 'new',
      });
    }

    if (event.severity === 'error' || event.severity === 'warn') {
      const currentFailures = Number.isFinite(pack.consecutiveFailures) ? pack.consecutiveFailures : 0;
      if (pack.lastFailureFingerprint === event.fingerprint) {
        pack.consecutiveFailures = currentFailures + 1;
      } else {
        pack.consecutiveFailures = 1;
        pack.lastFailureFingerprint = event.fingerprint;
      }
      if (pack.consecutiveFailures >= FAILURE_LOOP_THRESHOLD) {
        const current = pack.topProblems.find(item => item.fingerprint === event.fingerprint);
        if (current) current.status = 'looping';
      }
    }

    pack.uniqueFingerprints = pack.topProblems.length;
    pack.topProblems.sort((a, b) => b.count - a.count);
    writeJson(file, pack);
    return pack;
  } finally {
    resolve();
  }
}

export function storeEvent(event, deps = {}) {
  appendJsonl(paths(deps).outbox, event);
  updateDaily(event, deps);
  return event;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      result._.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s);
      const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      if (inlineValue !== undefined) {
        result[key] = inlineValue;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        result[key] = argv[++i];
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

let _syncMutex = Promise.resolve();

function withMutex(fn) {
  const prev = _syncMutex;
  let resolve;
  _syncMutex = new Promise(r => { resolve = r; });
  return prev.then(() => fn()).finally(resolve);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function messageFromCaptureArgs(args) {
  if (args.message) return String(args.message);
  if (args.log) {
    const logPath = path.resolve(String(args.log));
    const home = getHome();
    const cwd = process.cwd();
    const allowed = [home, cwd, path.join(os.tmpdir(), 'winaicheck')];
    const isAllowed = allowed.some(prefix => logPath.startsWith(prefix));
    if (!isAllowed) throw new Error(`--log 只允许读取 HOME、当前目录或临时目录下的文件`);
    return fs.readFileSync(logPath, 'utf8');
  }
  return readStdin();
}

function apiBase() {
  const raw = (process.env.AICOEVO_API_BASE || process.env.AICOEVO_BASE_URL || process.env.AICOEVO_WEB_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
  if (!raw.startsWith('https://') && process.env.NODE_ENV !== 'development' && !process.env.WINAICHECK_ALLOW_HTTP) {
    const safe = raw.replace(/^http:\/\//, 'https://');
    return safe.endsWith('/api/v1') ? safe : `${safe}/api/v1`;
  }
  return raw.endsWith('/api/v1') ? raw : `${raw}/api/v1`;
}

async function requestJson(url, init = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    method: init.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs || 5000),
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 200) }; }
  }
  return {
    status: response.status,
    data,
  };
}

function authHeaders(config) {
  return config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {};
}

async function syncEvents(deps = {}) {
  return withMutex(async () => {
    const p = paths(deps);
    const config = loadConfig(deps);
    if (config.paused) return { ok: false, skipped: true, reason: 'paused' };
    if (!config.shareData) return { ok: false, skipped: true, reason: 'not_authorized' };

    const all = readJsonl(p.outbox);
    const pending = all.filter(event => event.syncStatus !== 'synced').slice(0, MAX_UPLOAD_EVENTS);
    if (pending.length === 0) return { ok: true, uploaded: 0 };

    const remote = await requestJson(`${apiBase()}/agent-events/batch`, {
      method: 'POST',
      headers: authHeaders(config),
      body: {
        clientId: config.clientId,
        deviceId: config.deviceId,
        events: pending.map(({ syncStatus, ...event }) => event),
      },
    }, deps);

    if (remote.status < 200 || remote.status >= 300) {
      for (const event of pending) {
        appendJsonlWithRotation(p.ledger, {
          uploadedAt: nowIso(deps),
          eventId: event.eventId,
          fingerprint: event.fingerprint,
          status: 'failed',
          remoteStatus: remote.status,
        });
      }
      return { ok: false, uploaded: 0, status: remote.status, data: remote.data };
    }

    const pendingIds = new Set(pending.map(event => event.eventId));
    const updated = all.map(event => pendingIds.has(event.eventId) ? { ...event, syncStatus: 'synced', syncedAt: nowIso(deps) } : event);
    writeJsonl(p.outbox, updated);
    for (const event of pending) {
      appendJsonlWithRotation(p.ledger, {
        uploadedAt: nowIso(deps),
        eventId: event.eventId,
        fingerprint: event.fingerprint,
        status: 'synced',
        remoteStatus: remote.status,
      });
    }

    if (remote.data?.advice) {
      writeAdvice(remote.data.advice, deps);
    }

    return { ok: true, uploaded: pending.length, data: remote.data };
  });
}

async function bestEffortSync(deps = {}) {
  try {
    return await syncEvents(deps);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function writeAdvice(advice, deps = {}) {
  const p = paths(deps);
  const normalized = {
    schemaVersion: 1,
    adviceId: advice.adviceId || `adv_${crypto.randomUUID()}`,
    generatedAt: advice.generatedAt || nowIso(deps),
    summary: advice.summary || 'AICOEVO 已生成新的优化建议。',
    confidence: typeof advice.confidence === 'number' ? advice.confidence : 0,
    matchedEvents: advice.matchedEvents || [],
    steps: Array.isArray(advice.steps) ? advice.steps : [],
    links: Array.isArray(advice.links) ? advice.links : [],
  };
  writeJson(p.adviceJson, normalized);
  const lines = [
    '# AICOEVO 修复建议',
    '',
    normalized.summary,
    '',
    `置信度: ${Math.round(normalized.confidence * 100)}%`,
    '',
  ];
  const SAFE_COMMAND_RE = /^[a-zA-Z0-9._\-\/\\: ]+$/;
  const SAFE_URL_RE = /^https?:\/\/[^\s<>"{}|\\^`]+$/;
  const cleanSteps = normalized.steps.map(step => ({
    ...step,
    command: (step.command && SAFE_COMMAND_RE.test(step.command)) ? step.command : undefined,
  }));
  const cleanLinks = normalized.links.filter(link => link.url && SAFE_URL_RE.test(link.url));
  if (cleanSteps.length) {
    lines.push('## 建议步骤', '');
    cleanSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.title}`);
      if (step.detail) lines.push(`   ${step.detail}`);
      if (step.command) lines.push(`   命令: \`${step.command}\``);
    });
    lines.push('');
  }
  if (cleanLinks.length) {
    lines.push('## 参考链接', '');
    for (const link of cleanLinks) lines.push(`- [${link.title}](${link.url})`);
    lines.push('');
  }
  ensureParent(p.adviceMd);
  fs.writeFileSync(p.adviceMd, `${lines.join('\n')}\n`, 'utf8');
  return normalized;
}

function printHelp(io = {}) {
  const out = io.stdout || process.stdout;
  out.write(`WinAICheck Agent Lite\n\n` +
    `用法:\n` +
    `  winaicheck agent install-hook --target claude-code|openclaw|all\n` +
    `  winaicheck agent enable --target claude-code|openclaw|all\n` +
    `  winaicheck agent uninstall-hook --target claude-code|openclaw|all\n` +
    `  winaicheck agent capture --agent <name> --message <text>\n` +
    `  winaicheck agent capture --agent <name> --log <path>\n` +
    `  winaicheck agent sync\n` +
    `  winaicheck agent uploads --local|--remote\n` +
    `  winaicheck agent pause|resume\n` +
    `  winaicheck agent summary --date today\n` +
    `  winaicheck agent diagnose\n` +
    `  winaicheck agent advice --format json|markdown\n`);
}

function selectResolvedCommand(matches, command, platform = process.platform) {
  if (platform === 'win32') {
    return matches.find(match => /\.(cmd|bat|exe)$/i.test(match)) || matches[0] || command;
  }
  return matches[0] || command;
}

function resolveCommand(command) {
  try {
    const exe = process.platform === 'win32' ? 'where.exe' : 'command';
    const args = process.platform === 'win32' ? [command] : ['-v', command];
    const stdout = execFileSync(exe, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const matches = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return selectResolvedCommand(matches, command);
  } catch {
    return command;
  }
}

function defaultProfilePaths() {
  const home = getHome();
  return [
    path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];
}

function targetAgents(target) {
  if (!target || target === 'all') return [
    { target: 'claude-code', command: 'claude', functionName: 'claude' },
    { target: 'openclaw', command: 'openclaw', functionName: 'openclaw' },
  ];
  if (target === 'claude-code' || target === 'claude') return [{ target: 'claude-code', command: 'claude', functionName: 'claude' }];
  if (target === 'openclaw') return [{ target: 'openclaw', command: 'openclaw', functionName: 'openclaw' }];
  throw new Error(`不支持的 hook 目标: ${target}`);
}

function buildHookBlock(agents) {
  const lines = [HOOK_START, '# This block is managed by WinAICheck.'];
  for (const agent of agents) {
    const original = agent.original.replace(/'/g, "''");
    lines.push(`function ${agent.functionName} {`);
    lines.push(`  $winaicheckAgent = Join-Path $HOME '.aicoevo\\agent\\winaicheck-agent.cmd'`);
    lines.push(`  if (Test-Path $winaicheckAgent) {`);
    lines.push(`    & $winaicheckAgent run --agent ${agent.target} --original '${original}' -- @args`);
    lines.push(`  } else {`);
    lines.push(`    & npx winaicheck agent run --agent ${agent.target} --original '${original}' -- @args`);
    lines.push(`  }`);
    lines.push('}');
  }
  lines.push(HOOK_END);
  return lines.join('\n');
}

function stripHookBlock(text) {
  let result = text;
  while (true) {
    const start = result.indexOf(HOOK_START);
    const end = result.indexOf(HOOK_END);
    if (start === -1 || end === -1 || end < start) break;
    result = `${result.slice(0, start).trimEnd()}\n${result.slice(end + HOOK_END.length).trimStart()}`;
  }
  return result.trim() + '\n';
}

function installHook(args, deps = {}) {
  const p = paths(deps);
  const agents = targetAgents(args.target).map(agent => ({ ...agent, original: resolveCommand(agent.command) }));
  const profiles = deps.profilePaths || defaultProfilePaths();
  const hooks = readJson(p.hooks, { installedAt: null, profiles: [], agents: [] });
  hooks.installedAt = nowIso(deps);
  hooks.agents = agents;
  hooks.profiles = profiles;
  writeJson(p.hooks, hooks);

  const block = buildHookBlock(agents);
  for (const profile of profiles) {
    const before = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
    ensureParent(profile);
    if (before && !fs.existsSync(`${profile}.winaicheck.bak`)) {
      fs.writeFileSync(`${profile}.winaicheck.bak`, before, 'utf8');
    }
    const withoutOld = stripHookBlock(before);
    fs.writeFileSync(profile, `${withoutOld.trimEnd()}\n\n${block}\n`, 'utf8');
  }
  return { profiles, agents };
}

function uninstallHook(args, deps = {}) {
  const p = paths(deps);
  const hooks = readJson(p.hooks, {});
  const profiles = deps.profilePaths || hooks.profiles || defaultProfilePaths();
  for (const profile of profiles) {
    if (!fs.existsSync(profile)) continue;
    const before = fs.readFileSync(profile, 'utf8');
    fs.writeFileSync(profile, stripHookBlock(before), 'utf8');
  }
  writeJson(p.hooks, { ...hooks, uninstalledAt: nowIso(deps), target: args.target || 'all' });
  return { profiles };
}

function computeFileHash(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function installLocalAgent(deps = {}) {
  const p = paths(deps);
  ensureDir(p.agentDir);
  const selfPath = fileURLToPath(import.meta.url);
  fs.copyFileSync(selfPath, p.agentJs);
  const hash = computeFileHash(p.agentJs);
  writeJson(path.join(p.agentDir, 'agent-lite.hash.json'), { sha256: hash, installedAt: nowIso(deps) });
  const cmd = [
    '@echo off',
    'setlocal',
    'node "%~dp0agent-lite.js" %*',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  fs.writeFileSync(p.agentCmd, cmd, 'utf8');
  return {
    agentDir: p.agentDir,
    agentJs: p.agentJs,
    agentCmd: p.agentCmd,
  };
}

function verifyAgentIntegrity(deps = {}) {
  const p = paths(deps);
  const hashFile = path.join(p.agentDir, 'agent-lite.hash.json');
  if (!fs.existsSync(p.agentJs) || !fs.existsSync(hashFile)) return false;
  const expected = readJson(hashFile, {}).sha256;
  if (!expected) return false;
  return computeFileHash(p.agentJs) === expected;
}

async function runOriginalAgent(args, deps = {}) {
  const original = args.original;
  if (!original) throw new Error('缺少 --original');
  if (!verifyAgentIntegrity(deps)) {
    process.stderr.write('WinAICheck: Agent runner 完整性校验失败，正在重新安装...\n');
    installLocalAgent(deps);
  }
  const passthrough = args._ || [];
  const stderrChunks = [];
  const stdoutChunks = [];
  const child = spawn(original, passthrough, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && (!/[\\/]/.test(original) || /\.(cmd|bat)$/i.test(original)),
    windowsHide: false,
  });
  child.stdout.on('data', chunk => {
    const buf = Buffer.from(chunk);
    stdoutChunks.push(buf);
    process.stdout.write(buf);
  });
  child.stderr.on('data', chunk => {
    const buf = Buffer.from(chunk);
    stderrChunks.push(buf);
    process.stderr.write(buf);
  });
  const exitCode = await new Promise((resolve) => {
    child.on('error', error => {
      stderrChunks.push(Buffer.from(error.message));
      resolve(127);
    });
    child.on('close', code => resolve(code ?? 0));
  });

  const stderrText = Buffer.concat(stderrChunks).toString('utf8');
  const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
  const errorBlocks = [];
  const extractBlock = (regex, maxLines = 6) => {
    let match;
    while ((match = regex.exec(stdoutText)) !== null) {
      const context = stdoutText.slice(match.index).split(/\r?\n/).slice(0, maxLines).join('\n');
      if (context.trim() && !errorBlocks.some(block => block.includes(match[0]))) {
        errorBlocks.push(context);
      }
    }
  };
  extractBlock(/^Error:.*$/gm);
  extractBlock(/^Error: Exit code \d+.*$/gm);
  extractBlock(/^unknown flag:.*$/gm, 3);
  extractBlock(/^Unknown skill:.*$/gm, 3);
  extractBlock(/^fatal:.*$/gm, 4);
  extractBlock(/^GraphQL:.*$/gm, 3);
  extractBlock(/^\s+at .*$/gm, 5);
  extractBlock(/^\s*File ".*$/gm, 5);
  extractBlock(/^Traceback.*$/gm, 6);

  const extractedError = errorBlocks.join('\n---\n').trim();
  const hasError = exitCode !== 0 || stderrText.trim() || extractedError;
  if (hasError) {
    const message = stderrText.trim() || extractedError || `${normalizeAgent(args.agent)} exited with code ${exitCode}`;
    const event = storeEvent(createEvent({
      agent: args.agent,
      message,
      severity: exitCode === 0 && (stderrText.trim() || extractedError) ? 'warn' : 'error',
    }, deps), deps);
    const experience = lookupExperience(message);
    if (experience) {
      appendExperience(event, experience, deps);
      process.stderr.write('\nWinAICheck 经验库建议:\n');
      process.stderr.write(`  ${experience.title}\n`);
      process.stderr.write(`  ${experience.advice}\n`);
      if (experience.commands.length > 0) {
        process.stderr.write(`  可尝试: ${experience.commands.join(' | ')}\n`);
      }
    }
    const config = loadConfig(deps);
    if (config.autoSync && config.shareData && !config.paused) await bestEffortSync(deps);
    process.stderr.write(`\nWinAICheck: 已记录 Agent 问题 ${event.eventId}\n`);
  }
  return exitCode;
}

async function showUploads(args, deps = {}, io = {}) {
  const out = io.stdout || process.stdout;
  if (args.remote) {
    const config = loadConfig(deps);
    const remote = await requestJson(`${apiBase()}/agent-events/mine`, {
      method: 'GET',
      headers: authHeaders(config),
    }, deps);
    out.write(`${JSON.stringify(remote.data, null, 2)}\n`);
    return remote;
  }
  const events = readJsonl(paths(deps).outbox);
  const ledger = readJsonl(paths(deps).ledger);
  out.write(`${JSON.stringify({ events, ledger }, null, 2)}\n`);
  return { events, ledger };
}

function showSummary(args, deps = {}, io = {}) {
  const date = args.date && args.date !== 'today' ? args.date : today(deps);
  const file = path.join(paths(deps).dailyDir, `${date}.json`);
  const summary = readJson(file, { date, totalEvents: 0, uniqueFingerprints: 0, repeatedEvents: 0, fixedEvents: 0, topProblems: [] });
  (io.stdout || process.stdout).write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function showAdvice(args, deps = {}, io = {}) {
  const p = paths(deps);
  const format = args.format || 'json';
  const file = format === 'markdown' ? p.adviceMd : p.adviceJson;
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : (format === 'markdown' ? '# AICOEVO 修复建议\n\n暂无建议。\n' : '{}\n');
  (io.stdout || process.stdout).write(content.endsWith('\n') ? content : `${content}\n`);
  return content;
}

async function authStart(args, deps = {}, io = {}) {
  if (!args.email) throw new Error('缺少 --email');
  const remote = await requestJson(`${apiBase()}/auth/email/start`, {
    method: 'POST',
    body: { email: args.email },
  }, deps);
  const config = loadConfig(deps);
  config.email = args.email;
  saveConfig(config, deps);
  (io.stdout || process.stdout).write('验证码已发送。\n');
  if (remote.data?.debug_code && (process.env.NODE_ENV === 'development' || process.env.WINAICHECK_DEV || deps.fetchImpl)) {
    (io.stdout || process.stdout).write(`本地调试验证码: ${remote.data.debug_code}\n`);
  }
  return remote;
}

async function authVerify(args, deps = {}, io = {}) {
  if (!args.email || !args.code) throw new Error('缺少 --email 或 --code');
  const remote = await requestJson(`${apiBase()}/auth/email/verify`, {
    method: 'POST',
    body: { email: args.email, code: args.code, deviceId: loadConfig(deps).deviceId },
  }, deps);
  const config = loadConfig(deps);
  config.email = args.email;
  config.authToken = remote.data?.token || remote.data?.authToken || remote.data?.access_token || config.authToken;
  config.shareData = true;
  config.autoSync = true;
  config.paused = false;
  config.confirmedAt = nowIso(deps);
  saveConfig(config, deps);
  (io.stdout || process.stdout).write('已授权自动同步。\n');
  return remote;
}

export async function main(argv = process.argv.slice(2), deps = {}, io = {}) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const out = io.stdout || process.stdout;

  if (!command || command === '--help' || command === 'help') {
    printHelp(io);
    return 0;
  }

  if (command === 'capture') {
    const message = await messageFromCaptureArgs(args);
    if (!message.trim()) throw new Error('没有可记录的错误内容');
    const event = storeEvent(createEvent({ agent: args.agent, message, severity: args.severity }, deps), deps);
    const experience = lookupExperience(message);
    if (experience) appendExperience(event, experience, deps);
    const config = loadConfig(deps);
    if (config.autoSync && config.shareData && !config.paused) await bestEffortSync(deps);
    out.write(`${JSON.stringify({ ok: true, eventId: event.eventId, fingerprint: event.fingerprint }, null, 2)}\n`);
    return 0;
  }

  if (command === 'sync') {
    const result = await syncEvents(deps);
    out.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok || result.skipped ? 0 : 1;
  }

  if (command === 'uploads') {
    await showUploads(args, deps, io);
    return 0;
  }

  if (command === 'summary') {
    showSummary(args, deps, io);
    return 0;
  }

  if (command === 'advice') {
    showAdvice(args, deps, io);
    return 0;
  }

  if (command === 'pause' || command === 'resume') {
    const config = loadConfig(deps);
    config.paused = command === 'pause';
    saveConfig(config, deps);
    out.write(command === 'pause' ? '已暂停自动上传。\n' : '已恢复自动上传。\n');
    return 0;
  }

  if (command === 'install-hook') {
    const result = installHook(args, deps);
    out.write(`已安装 Hook: ${result.agents.map(agent => agent.target).join(', ')}\n`);
    return 0;
  }

  if (command === 'install-local-agent') {
    const result = installLocalAgent(deps);
    out.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    return 0;
  }

  if (command === 'enable') {
    const localAgent = installLocalAgent(deps);
    const hook = installHook(args, deps);
    const config = loadConfig(deps);
    config.shareData = true;
    config.autoSync = true;
    config.paused = false;
    saveConfig(config, deps);
    out.write(`WinAICheck Agent Lite 已启用\n`);
    out.write(`  Agent Runner: ${localAgent.agentJs}\n`);
    out.write(`  Hook: ${hook.agents.map(agent => agent.target).join(', ')}\n`);
    out.write(`  自动同步: 已启用\n`);
    out.write(`\n请重启 PowerShell，或重新加载 PowerShell profile 后生效。\n`);
    return 0;
  }

  if (command === 'uninstall-hook') {
    uninstallHook(args, deps);
    out.write('已卸载 WinAICheck Agent Hook。\n');
    return 0;
  }

  if (command === 'run') {
    return runOriginalAgent(args, deps);
  }

  if (command === 'diagnose') {
    const p = paths(deps);
    const summary = readJson(path.join(p.dailyDir, `${today(deps)}.json`), {
      date: today(deps),
      totalEvents: 0,
      uniqueFingerprints: 0,
      repeatedEvents: 0,
      fixedEvents: 0,
      consecutiveFailures: 0,
      lastFailureFingerprint: null,
      lastEventAt: null,
      topProblems: [],
    });
    const lines = [`# WinAICheck Agent 诊断报告 - ${summary.date}`, ''];
    lines.push(`总事件数: ${summary.totalEvents}`);
    lines.push(`唯一错误: ${summary.uniqueFingerprints}`);
    lines.push(`重复错误: ${summary.repeatedEvents}`);
    lines.push(`连续失败: ${summary.consecutiveFailures || 0}`);
    if ((summary.consecutiveFailures || 0) >= FAILURE_LOOP_THRESHOLD) {
      lines.push('');
      lines.push(`警告: 检测到 Failure Loop，同一错误连续出现 ${summary.consecutiveFailures} 次。`);
    }
    if (summary.lastEventAt) {
      const minsAgo = Math.max(0, Math.round((Date.now() - new Date(summary.lastEventAt).getTime()) / 60000));
      lines.push(`最后事件: ${minsAgo} 分钟前`);
      if (minsAgo > 60) {
        lines.push('静默警告: 超过 1 小时没有新的 Agent 事件。');
      }
    }
    lines.push('', '## Top 问题');
    if (summary.topProblems.length === 0) {
      lines.push('暂无问题记录。');
    } else {
      for (const problem of summary.topProblems.slice(0, 5)) {
        const marker = problem.status === 'looping' ? ' LOOP' : problem.status === 'repeated' ? ' repeated' : '';
        lines.push(`- [${problem.count}次] ${problem.title}${marker}`);
      }
    }
    lines.push('', '运行 `winaicheck agent advice --format markdown` 查看服务端建议。');
    out.write(`${lines.join('\n')}\n`);
    return 0;
  }

  if (command === 'auth') {
    const [subcommand, ...authRest] = rest;
    const authArgs = parseArgs(authRest);
    if (subcommand === 'start') {
      await authStart(authArgs, deps, io);
      return 0;
    }
    if (subcommand === 'verify') {
      await authVerify(authArgs, deps, io);
      return 0;
    }
  }

  throw new Error(`未知 agent 命令: ${command}`);
}

export const _testHelpers = {
  paths,
  parseArgs,
  stripHookBlock,
  buildHookBlock,
  installHook,
  uninstallHook,
  installLocalAgent,
  resolveCommand,
  selectResolvedCommand,
  readJsonl,
  readJson,
  writeJson,
  updateDaily,
  lookupExperience,
};

let isDirectExecution = false;
try {
  isDirectExecution = process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
} catch { /* invalid argv[1] path */ }
if (isDirectExecution) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(`WinAICheck Agent 错误: ${error.message}`);
    process.exitCode = 1;
  });
}
