import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lookup as dnsLookup } from 'node:dns/promises';

const DEFAULT_ORIGIN = 'https://aicoevo.net';
const MAX_CAPTURE_CHARS = 8000;
const MAX_UPLOAD_EVENTS = 50;
const FAILURE_LOOP_THRESHOLD = 5;
const HOOK_START = '# >>> WinAICheck Agent Hook >>>';
const HOOK_END = '# <<< WinAICheck Agent Hook <<<';
const DEFAULT_STRATEGY = 'balanced';
const LOOP_HOOK_STALE_MS = 24 * 60 * 60 * 1000;
const SIGNAL_HISTORY_LIMIT = 10;
const SIGNAL_SUPPRESSION_WINDOW = 8;
const SIGNAL_SUPPRESSION_THRESHOLD = 3;
const LOOP_SCHEDULE_MS = {
  hot: 30 * 1000,
  warm: 5 * 60 * 1000,
  cold: 30 * 60 * 1000,
};
const MAX_LOOP_BACKOFF_MS = 60 * 60 * 1000;
const WORKER_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const WORKER_MAX_PARALLEL = 3;
const WORKER_START_TIMEOUT_MS = 5 * 1000;
const WORKER_START_POLL_MS = 100;
const UPDATE_CHECK_TTL_MS = 60 * 60 * 1000;
const UPDATE_AVAILABLE_TTL_MS = 12 * 60 * 60 * 1000;

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

function getHomeForDeps(deps = {}) {
  return deps.homeDir || getHome();
}

function getBaseDir(deps = {}) {
  return deps.baseDir || process.env.WINAICHECK_AGENT_BASE_DIR || path.join(getHome(), '.aicoevo');
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
    signals: path.join(base, 'signals.jsonl'),
    loopState: path.join(base, 'loop-state.json'),
    healthBaseline: path.join(base, 'health-baseline.json'),
    loopLock: path.join(base, 'loop.lock'),
    sessionStartHookJs: path.join(base, 'agent', 'winaicheck-session-start.cjs'),
    postToolHookJs: path.join(base, 'agent', 'winaicheck-post-tool.cjs'),
    workerState: path.join(base, 'worker-state.json'),
    workerLock: path.join(base, 'worker.lock'),
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

function readJsonlLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

function parseJsonlLines(lines) {
  return lines
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function readJsonlSince(file, cursor = 0) {
  const lines = readJsonlLines(file);
  const safeCursor = Math.max(0, Number(cursor) || 0);
  return {
    rows: parseJsonlLines(lines.slice(safeCursor)),
    nextCursor: lines.length,
  };
}

const MAX_LEDGER_ENTRIES = 500;

const STRATEGY_PRESETS = {
  balanced: {
    cadenceScale: 1,
    keywordBias: {},
    allowExplore: true,
    allowedSignalKinds: null,
  },
  harden: {
    cadenceScale: 0.5,
    keywordBias: { network_instability: 1, config_breakage: 1, auth_failure: 1 },
    allowExplore: false,
    allowedSignalKinds: null,
  },
  'repair-only': {
    cadenceScale: 1,
    keywordBias: { tool_missing: 1, config_breakage: 1, auth_failure: 1 },
    allowExplore: false,
    allowedSignalKinds: ['tool_missing', 'config_breakage', 'network_instability', 'auth_failure', 'perf_bottleneck', 'failure_loop', 'env_drift'],
  },
  innovate: {
    cadenceScale: 1,
    keywordBias: { capability_gap: 1, perf_bottleneck: 1 },
    allowExplore: true,
    allowedSignalKinds: null,
  },
};

const SIGNAL_PROFILES = {
  tool_missing: {
    title: '关键命令缺失',
    keywords: { 'command not found': 5, enoent: 5, 'not found': 4, '不是内部或外部命令': 5, missing: 2, 'no such file': 3 },
    threshold: 5,
  },
  config_breakage: {
    title: '配置损坏或不兼容',
    keywords: { config: 2, json: 2, parse: 3, invalid: 3, malformed: 4, mcp: 2, settings: 2, syntaxerror: 4 },
    threshold: 6,
  },
  network_instability: {
    title: '网络或远端连接不稳定',
    keywords: { timeout: 4, timed: 2, etimedout: 5, econnrefused: 5, refused: 3, dns: 3, ssl: 2, certificate: 2, network: 2 },
    threshold: 6,
  },
  auth_failure: {
    title: '认证或权限失败',
    keywords: { unauthorized: 5, forbidden: 5, auth: 3, token: 2, 'api key': 4, bearer: 3, permission: 3, eacces: 4, denied: 3 },
    threshold: 5,
  },
  perf_bottleneck: {
    title: '性能瓶颈或资源压力',
    keywords: { slow: 3, latency: 3, bottleneck: 5, oom: 5, 'out of memory': 5, throttle: 3, retry: 2, hanging: 3 },
    threshold: 6,
  },
  capability_gap: {
    title: '能力缺口或不支持功能',
    keywords: { unsupported: 4, 'not supported': 5, 'not implemented': 5, 'unknown flag': 4, 'unknown option': 4, feature: 2, capability: 3 },
    threshold: 6,
  },
};

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

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function commandHash(value) {
  return value ? shortHash(String(value).trim().toLowerCase()) : null;
}

function nowIso(deps = {}) {
  return deps.now ? deps.now().toISOString() : new Date().toISOString();
}

function sleep(ms, deps = {}) {
  if (deps.sleep) return deps.sleep(ms);
  return new Promise(resolve => setTimeout(resolve, ms));
}

function today(deps = {}) {
  return nowIso(deps).slice(0, 10);
}

function parseVersionMajor(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)|(\d+)\.(\d+)|(\d+)/);
  if (!match) return null;
  return Number(match[1] || match[4] || match[6] || 0);
}

function classifyCoverageStatus(lastSeenAt, staleAfterMs = LOOP_HOOK_STALE_MS, deps = {}) {
  if (!lastSeenAt) return 'missing';
  const ageMs = Date.parse(nowIso(deps)) - Date.parse(lastSeenAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'healthy';
  return ageMs > staleAfterMs ? 'degraded' : 'healthy';
}

function defaultLoopState() {
  return {
    schemaVersion: 1,
    enabled: false,
    strategy: DEFAULT_STRATEGY,
    status: 'stopped',
    pid: null,
    startedAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    nextRunAt: null,
    sleepMs: LOOP_SCHEDULE_MS.cold,
    mode: 'cold',
    consecutiveErrors: 0,
    lastError: null,
    outboxCursor: 0,
    recentAnalyses: [],
    activeSignals: {},
    pendingHealthFailures: {},
    health: {
      baselineCreatedAt: null,
      lastSnapshotAt: null,
      lastSnapshot: null,
      lastDrifts: [],
    },
  };
}

function loadLoopState(deps = {}) {
  const state = readJson(paths(deps).loopState, defaultLoopState());
  const merged = {
    ...defaultLoopState(),
    ...state,
    health: {
      ...defaultLoopState().health,
      ...(state.health || {}),
    },
    recentAnalyses: Array.isArray(state.recentAnalyses) ? state.recentAnalyses.slice(-SIGNAL_HISTORY_LIMIT) : [],
    activeSignals: state.activeSignals && typeof state.activeSignals === 'object' ? state.activeSignals : {},
    pendingHealthFailures: state.pendingHealthFailures && typeof state.pendingHealthFailures === 'object' ? state.pendingHealthFailures : {},
  };
  if (!STRATEGY_PRESETS[merged.strategy]) merged.strategy = DEFAULT_STRATEGY;
  return merged;
}

function saveLoopState(state, deps = {}) {
  writeJson(paths(deps).loopState, {
    ...defaultLoopState(),
    ...state,
    recentAnalyses: Array.isArray(state.recentAnalyses) ? state.recentAnalyses.slice(-SIGNAL_HISTORY_LIMIT) : [],
  });
}

function markHookSeen(agent, hookType, deps = {}) {
  const p = paths(deps);
  const hooks = readJson(p.hooks, {});
  if (!hooks.lastSeen || typeof hooks.lastSeen !== 'object') hooks.lastSeen = {};
  hooks.lastSeen[agent] = {
    hookType,
    lastHookSeenAt: nowIso(deps),
  };
  hooks.lastHookSeenAt = hooks.lastSeen[agent].lastHookSeenAt;
  writeJson(p.hooks, hooks);
  return hooks.lastSeen[agent];
}

function mergeSignalMap(target, signal) {
  const current = target[signal.kind];
  if (!current) {
    target[signal.kind] = {
      ...signal,
      sourceFingerprints: unique(signal.sourceFingerprints),
    };
    return;
  }
  target[signal.kind] = {
    ...current,
    title: signal.title || current.title,
    confidence: Math.max(current.confidence || 0, signal.confidence || 0),
    sourceLayers: unique([...(current.sourceLayers || []), ...(signal.sourceLayers || [])]),
    sourceFingerprints: unique([...(current.sourceFingerprints || []), ...(signal.sourceFingerprints || [])]),
  };
}

function makeSignal(kind, init = {}) {
  return {
    signalId: `sig_${shortHash(kind)}`,
    kind,
    title: init.title || kind,
    confidence: init.confidence || 0.6,
    sourceLayers: unique(init.sourceLayers || []),
    sourceFingerprints: unique(init.sourceFingerprints || []),
    firstSeenAt: init.firstSeenAt || nowIso(),
    lastSeenAt: init.lastSeenAt || nowIso(),
    hitCount: init.hitCount || 1,
    suppressed: !!init.suppressed,
  };
}

function getStrategyPreset(strategy) {
  return STRATEGY_PRESETS[strategy] || STRATEGY_PRESETS[DEFAULT_STRATEGY];
}

function computeAgentDeviceId(baseDeviceId, agentType) {
  if (!baseDeviceId) return `device_${crypto.randomUUID()}`;
  const suffix = agentType === 'claude-code' ? '_cc' : agentType === 'openclaw' ? '_oc' : '';
  if (!suffix) return baseDeviceId;
  if (baseDeviceId.endsWith('_cc') || baseDeviceId.endsWith('_oc')) return baseDeviceId;
  return `${baseDeviceId}${suffix}`;
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
  if (config.workerEnabled === undefined) config.workerEnabled = true;
  if (!config.strategy || !STRATEGY_PRESETS[config.strategy]) config.strategy = DEFAULT_STRATEGY;
  if (!config.analysis || typeof config.analysis !== 'object') config.analysis = {};
  if (config.analysis.layer3Enabled === undefined) config.analysis.layer3Enabled = false;
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

function agentType(config) {
  // Determine agent type from config or detect from environment
  // Default to 'custom' if not set
  return config.agentType || 'custom';
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
  const agentDeviceId = computeAgentDeviceId(config.deviceId, agent);
  const toolContext = input.toolContext || null;
  const resolvedToolName = input.toolName || toolContext?.toolName || null;
  const resolvedExitCode = input.toolExitCode ?? toolContext?.exitCode ?? null;
  const resolvedCommandHash = input.commandHash || commandHash(input.command || toolContext?.command || toolContext?.original || '');

  return {
    schemaVersion: 1,
    eventId: input.eventId || `evt_${crypto.randomUUID()}`,
    clientId: config.clientId,
    deviceId: agentDeviceId,
    source: 'winaicheck-lite',
    agent,
    eventType,
    occurredAt,
    fingerprint,
    sanitizedMessage,
    severity: input.severity || severityFromMessage(sanitizedMessage),
    captureSource: input.captureSource || 'manual',
    hookType: input.hookType || null,
    sessionId: input.sessionId || null,
    toolName: resolvedToolName,
    toolExitCode: resolvedExitCode,
    commandHash: resolvedCommandHash,
    ingestedAt: nowIso(deps),
    localContext: localContext(),
    toolContext,
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

function agentApiBase(version = 'v2') {
  return apiBase().replace(/\/api\/v1$/, `/api/${version}`) + '/agent';
}

async function heartbeatAgentV2(headers, init = {}, deps = {}) {
  return requestJson(`${agentApiBase('v2')}/heartbeat`, {
    method: 'POST',
    headers,
    body: {
      status: 'idle',
      current_tasks: 0,
      max_parallel_tasks: 1,
      ...(init.body || {}),
    },
  }, deps);
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
  if (!config.authToken) return {};
  // API Keys (ak_*) go in X-API-Key header; JWTs use Bearer
  if (config.authToken.startsWith('ak_')) {
    return { 'X-API-Key': config.authToken };
  }
  return { Authorization: `Bearer ${config.authToken}` };
}

function apiKeyHeaders(config) {
  if (!config.authToken || !config.authToken.startsWith('ak_')) {
    return null;
  }
  return { 'X-API-Key': config.authToken };
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

    // 展示同步反馈：匹配结果和悬赏草稿
    if (remote.data) {
      const accepted = remote.data.accepted || 0;
      const advice = remote.data.advice;
      const drafts = remote.data.bountyDrafts;
      if (accepted > 0) {
        const parts = [`[AICOEVO] 已上传 ${accepted} 条事件`];
        if (advice) {
          const conf = typeof advice.confidence === 'number' ? advice.confidence : 0;
          if (conf >= 0.6) {
            parts.push(`匹配到已有方案 (置信度 ${Math.round(conf * 100)}%)`);
          } else if (advice.summary) {
            parts.push(String(advice.summary).split('\n')[0]);
          }
        }
        if (drafts && drafts.length > 0) {
          const d = drafts[0];
          parts.push(`已创建悬赏草稿: ${d.title || d.id}`);
        }
        (deps.stderr || process.stderr).write(parts.join(' | ') + '\n');
      }
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

function ownerVerifyFiles(bountyId, answerId, deps = {}) {
  const p = paths(deps);
  const slug = [bountyId || 'unknown', answerId || 'unknown']
    .map(value => String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-'))
    .join('__');
  const dir = path.join(p.base, 'owner-verify');
  return {
    dir,
    guideMd: path.join(dir, `${slug}.md`),
    snapshotJson: path.join(dir, `${slug}.json`),
  };
}

function ownerVerifyLocalContext(config = {}) {
  return {
    clientId: config.clientId || '',
    deviceId: config.deviceId || '',
    autoSync: config.autoSync !== false,
    paused: !!config.paused,
    shareData: config.shareData !== false,
    host: os.hostname(),
    platform: process.platform,
    nodeVersion: process.version,
  };
}

function writeOwnerVerifyGuide(item, config = {}, deps = {}) {
  const files = ownerVerifyFiles(item.bounty_id, item.answer_id, deps);
  const generatedAt = nowIso(deps);
  const localContext = ownerVerifyLocalContext(config);
  const verifyCommand = `winaicheck agent owner-verify ${item.bounty_id} --answer ${item.answer_id} --result success|partial|failed --cmd "<local validation command>"`;
  const lines = [
    '# AICOEVO 发起者复现指南',
    '',
    `- Bounty: ${item.bounty_id}`,
    `- Answer: ${item.answer_id}`,
    `- 标题: ${item.title || '(无标题)'}`,
    `- 提交时间: ${item.submitted_at || '-'}`,
    `- 截止时间: ${item.deadline_at || '-'}`,
    '',
    '## 方案摘要',
    '',
    item.solution_summary || '暂无方案摘要。',
    '',
    '## 建议操作',
    '',
    '1. 在你自己的本地环境里手动复现原问题。',
    '2. 按方案摘要执行修复或验证命令，确认现象是否消失。',
    '3. 记录你实际执行过的命令和结果，再提交 owner-verify。',
    '',
    '## 提交命令',
    '',
    `\`${verifyCommand}\``,
    '',
    '默认策略为 prompt：命令会再次要求你确认，不会静默替你提交。',
    '',
  ];
  ensureParent(files.guideMd);
  fs.writeFileSync(files.guideMd, `${lines.join('\n')}\n`, 'utf8');
  const snapshot = {
    schemaVersion: 1,
    generatedAt,
    item,
    localContext,
    verifyCommand,
  };
  writeJson(files.snapshotJson, snapshot);
  return {
    ...files,
    guideSha256: sha256(fs.readFileSync(files.guideMd, 'utf8')),
    snapshot,
  };
}

function loadOwnerVerifySnapshot(bountyId, answerId, deps = {}) {
  const files = ownerVerifyFiles(bountyId, answerId, deps);
  const snapshot = readJson(files.snapshotJson, null);
  const guideSha256 = fs.existsSync(files.guideMd) ? sha256(fs.readFileSync(files.guideMd, 'utf8')) : '';
  return { ...files, guideSha256, snapshot };
}

function printHelp(io = {}) {
  const out = io.stdout || process.stdout;
  out.write(`WinAICheck Agent Lite\n\n` +
    `用法:\n` +
    `  winaicheck agent enable --target claude-code|openclaw|all\n` +
    `  winaicheck agent migrate --target claude-code|openclaw|all\n` +
    `  winaicheck agent install-hook --target claude-code|openclaw|all  旧 PowerShell hook\n` +
    `  winaicheck agent uninstall-hook --target claude-code|openclaw|all\n` +
    `  winaicheck agent capture --agent <name> --message <text>\n` +
    `  winaicheck agent capture --agent <name> --log <path>\n` +
    `  winaicheck agent sync\n` +
    `  winaicheck agent uploads --local|--remote\n` +
    `  winaicheck agent pause|resume\n` +
    `  winaicheck agent disable                           — 彻底禁用 Worker 互助循环\n` +
    `  winaicheck agent worker-enable                    — 重新启用 Worker 互助循环\n` +
    `  winaicheck agent worker start|stop|status         — Worker 后台循环控制\n` +
    `  winaicheck agent loop start|stop|status|run-once\n` +
    `  winaicheck agent strategy get|set <balanced|harden|repair-only|innovate>\n` +
    `  winaicheck agent summary --date today\n` +
    `  winaicheck agent auth --email <addr> start|verify\n` +
    `  winaicheck agent bind [--agent claude-code|openclaw]  (自动打开浏览器确认)\n` +
    `  winaicheck agent diagnose\n` +
    `  winaicheck agent check-update\n` +
    `  winaicheck agent auto-update status|on|off|notify\n` +
    `  winaicheck agent advice --format json|markdown\n` +
    `  winaicheck agent bounty-list [--sort reward|created] [--limit N]\n` +
    `  winaicheck agent bounty-recommended [--strategy balanced|quality_first|speed_first] [--limit N]\n` +
    `  winaicheck agent bounty-solve <id>                       — KB 匹配获取答案\n` +
    `  winaicheck agent bounty-claim <id>                       — 认领悬赏\n` +
    `  winaicheck agent bounty-submit <id> --content <text>     — 提交回答\n` +
    `  winaicheck agent bounty-release <id>                     — 释放认领\n` +
    `  winaicheck agent bounty-auto [--interval 300]            — 自动循环: 推荐→KB匹配→提交\n` +
    `  winaicheck agent owner-check                             — 查看待复现确认的方案列表\n` +
    `  winaicheck agent owner-verify <bounty_id> --answer <id> --result success|partial|failed\n` +
    `                                                            — 提交复现验证结果\n`);
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

function targetIncludesClaude(target) {
  return !target || target === 'all' || target === 'claude-code' || target === 'claude';
}

function targetIncludesOpenClaw(target) {
  return !target || target === 'all' || target === 'openclaw';
}

function normalizeUpdateTarget(target) {
  if (!target || target === 'all') return 'all';
  if (target === 'claude' || target === 'claude-code') return 'claude-code';
  if (target === 'openclaw') return 'openclaw';
  throw new Error(`不支持的更新目标: ${target}`);
}

function runtimeUpdateTargetForAgent(agent) {
  const normalized = normalizeAgent(agent);
  return normalized === 'openclaw' ? 'openclaw' : 'claude-code';
}

function updateCachePath(deps = {}) {
  return path.join(paths(deps).base, 'version-cache.json');
}

function loadUpdateCache(deps = {}) {
  return readJson(updateCachePath(deps), {});
}

function saveUpdateCache(cache, deps = {}) {
  writeJson(updateCachePath(deps), cache);
}

function normalizeUpdateMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'off') return 'off';
  if (mode === 'auto' || mode === 'on') return 'auto';
  return 'notify';
}

function localWinAICheckVersion(deps = {}) {
  if (deps.currentVersion) return String(deps.currentVersion).trim();
  try {
    const selfPath = fileURLToPath(import.meta.url);
    const versionFile = path.join(path.dirname(selfPath), '..', 'VERSION');
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf8').trim() || '0.0.0';
    }
  } catch {}
  return '0.0.0';
}

function compareVersions(left, right) {
  const leftParts = String(left || '0.0.0').split('.').map(part => Number(part) || 0);
  const rightParts = String(right || '0.0.0').split('.').map(part => Number(part) || 0);
  const size = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < size; i++) {
    const l = leftParts[i] || 0;
    const r = rightParts[i] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

function isFreshUpdateCache(cache, localVersion, nowMs = Date.now()) {
  if (!cache?.winaicheckLatest || !cache?.winaicheckUpdateCheck) return false;
  const checkedAt = new Date(cache.winaicheckUpdateCheck).getTime();
  if (!Number.isFinite(checkedAt)) return false;
  const ttl = cache.winaicheckHasUpdate ? UPDATE_AVAILABLE_TTL_MS : UPDATE_CHECK_TTL_MS;
  if ((nowMs - checkedAt) >= ttl) return false;
  if (!cache.winaicheckVersion) return true;
  return compareVersions(cache.winaicheckVersion, localVersion) === 0;
}

function buildUpdateResult(cache, localVersion, target, extras = {}) {
  const latest = cache.winaicheckLatest || localVersion;
  const hasUpdate = compareVersions(localVersion, latest) < 0;
  return {
    hasUpdate,
    current: localVersion,
    latest,
    mode: normalizeUpdateMode(cache.winaicheckUpdateMode),
    target: normalizeUpdateTarget(target),
    autoUpdated: false,
    autoUpdateError: null,
    runtimeMessage: '',
    ...extras,
  };
}

function updateRuntimeMessage(result) {
  if (result.mode === 'off') return '';
  if (result.autoUpdated) {
    return `已自动更新 WinAICheck v${result.updatedFrom} → v${result.current}，重启当前会话后生效。`;
  }
  if (result.autoUpdateError) {
    return `发现新版本 v${result.current} → v${result.latest}，自动更新失败（${result.autoUpdateError}），可运行 npx winaicheck@latest agent enable 更新。`;
  }
  if (result.hasUpdate) {
    return `发现新版本 v${result.current} → v${result.latest}，运行 npx winaicheck@latest agent enable 更新，或运行 winaicheck agent auto-update on 开启自动更新。`;
  }
  return '';
}

function runLatestSelfUpdate(target, deps = {}) {
  const execImpl = deps.execFileSyncImpl || execFileSync;
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['--yes', 'winaicheck@latest', 'agent', 'self-update', '--target', normalizeUpdateTarget(target)];
  execImpl(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60 * 1000,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function resolveUpdateState(args = {}, deps = {}) {
  const target = normalizeUpdateTarget(args.target);
  const cache = loadUpdateCache(deps);
  const localVersion = localWinAICheckVersion(deps) || cache.winaicheckVersion || '0.0.0';
  cache.winaicheckVersion = localVersion;
  cache.winaicheckUpdateMode = normalizeUpdateMode(args.mode || cache.winaicheckUpdateMode);

  if (!isFreshUpdateCache(cache, localVersion)) {
    try {
      const fetchImpl = deps.fetchImpl || fetch;
      const response = await fetchImpl(
        'https://raw.githubusercontent.com/gugug168/WinAICheck/main/VERSION',
        { signal: AbortSignal.timeout(5000) },
      );
      const remoteVersion = (await response.text()).trim();
      if (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(remoteVersion)) {
        cache.winaicheckLatest = remoteVersion;
        cache.winaicheckHasUpdate = compareVersions(localVersion, remoteVersion) < 0;
      } else {
        cache.winaicheckLatest = cache.winaicheckLatest || localVersion;
        cache.winaicheckHasUpdate = compareVersions(localVersion, cache.winaicheckLatest) < 0;
      }
      cache.winaicheckUpdateCheck = nowIso(deps);
      saveUpdateCache(cache, deps);
    } catch {
      cache.winaicheckLatest = cache.winaicheckLatest || localVersion;
      cache.winaicheckHasUpdate = compareVersions(localVersion, cache.winaicheckLatest) < 0;
    }
  }

  let result = buildUpdateResult(cache, localVersion, target);
  if (result.mode === 'auto' && result.hasUpdate) {
    try {
      runLatestSelfUpdate(target, deps);
      const nextVersion = cache.winaicheckLatest || result.latest;
      cache.winaicheckVersion = nextVersion;
      cache.winaicheckLatest = nextVersion;
      cache.winaicheckHasUpdate = false;
      cache.winaicheckUpdateCheck = nowIso(deps);
      cache.winaicheckLastAutoUpdate = nowIso(deps);
      saveUpdateCache(cache, deps);
      result = buildUpdateResult(cache, nextVersion, target, {
        autoUpdated: true,
        updatedFrom: localVersion,
      });
    } catch (error) {
      const autoUpdateError = error?.message || String(error);
      cache.winaicheckLastAutoUpdateError = autoUpdateError;
      saveUpdateCache(cache, deps);
      result = buildUpdateResult(cache, localVersion, target, {
        autoUpdateError,
      });
    }
  }

  result.runtimeMessage = updateRuntimeMessage(result);
  return result;
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

function settingsFilePath(deps = {}) {
  return path.join(getHomeForDeps(deps), '.claude', 'settings.json');
}

function removeWinAICheckHookEntries(entries) {
  return (entries || [])
    .map(entry => ({
      ...entry,
      hooks: (entry.hooks || []).filter(hook => !String(hook.command || '').toLowerCase().includes('winaicheck')),
    }))
    .filter(entry => (entry.hooks || []).length > 0);
}

function installSettingsHook(args = {}, deps = {}) {
  const p = paths(deps);
  installLocalAgent(deps);
  const settingsFile = settingsFilePath(deps);
  ensureParent(settingsFile);

  const settings = readJson(settingsFile, {});
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

  const sessionCommand = `node "${p.sessionStartHookJs}"`;
  const postToolCommand = `node "${p.postToolHookJs}"`;

  const hasSession = settings.hooks.SessionStart.some(entry =>
    (entry.hooks || []).some(hook => String(hook.command || '').includes('winaicheck-session-start.cjs'))
  );
  if (!hasSession) {
    settings.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: sessionCommand, timeout: 10 }],
    });
  }

  const hasPostTool = settings.hooks.PostToolUse.some(entry =>
    (entry.hooks || []).some(hook => String(hook.command || '').includes('winaicheck-post-tool.cjs'))
  );
  if (!hasPostTool) {
    settings.hooks.PostToolUse.push({
      matcher: 'Bash|Agent|Task',
      hooks: [{ type: 'command', command: postToolCommand, timeout: 10 }],
    });
  }

  writeJson(settingsFile, settings);
  const hooks = readJson(p.hooks, {});
  writeJson(p.hooks, {
    ...hooks,
    hookType: 'settings',
    settingsFile,
    settingsInstalledAt: nowIso(deps),
    settingsHooks: ['SessionStart', 'PostToolUse'],
  });

  return {
    hookType: 'settings',
    settingsFile,
    hooks: ['SessionStart (版本检查)', 'PostToolUse (错误捕获)'],
  };
}

function uninstallSettingsHook(args = {}, deps = {}) {
  const settingsFile = settingsFilePath(deps);
  const settings = readJson(settingsFile, {});
  if (!settings.hooks) return { settingsFile, removed: false };

  if (Array.isArray(settings.hooks.SessionStart)) {
    settings.hooks.SessionStart = removeWinAICheckHookEntries(settings.hooks.SessionStart);
  }
  if (Array.isArray(settings.hooks.PostToolUse)) {
    settings.hooks.PostToolUse = removeWinAICheckHookEntries(settings.hooks.PostToolUse);
  }

  writeJson(settingsFile, settings);
  return { settingsFile, removed: true };
}

function computeFileHash(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildPostToolHookScript(agentCmd, baseDir) {
  return [
    '#!/usr/bin/env node',
    "const { execFileSync } = require('child_process');",
    "const { createHash } = require('crypto');",
    '',
    'function readStdin() {',
    '  return new Promise(resolve => {',
    "    let payload = '';",
    "    process.stdin.on('data', chunk => { payload += chunk.toString(); });",
    "    process.stdin.on('end', () => resolve(payload));",
    "    process.stdin.on('error', () => resolve(''));",
    '  });',
    '}',
    '',
    'function pickToolName(data) {',
    "  return data.toolName || data.tool_name || data.tool || '';",
    '}',
    '',
    'function pickErrorMessage(data) {',
    '  const output = data.toolOutput || data.tool_output || data.response || {};',
    '  return String(',
    '    data.error ||',
    '    output.stderr ||',
    '    output.error ||',
    '    output.message ||',
    "    ''",
    '  );',
    '}',
    '',
    'function shortHash(value) {',
    "  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);",
    '}',
    '',
    '(async () => {',
    '  try {',
    '    const raw = await readStdin();',
    '    if (!raw.trim()) return;',
    '    const data = JSON.parse(raw);',
    '    const toolName = String(pickToolName(data));',
    "    if (!['bash', 'agent', 'task', 'bashcon'].some(name => toolName.toLowerCase().includes(name))) return;",
    '',
    '    const exitCode = data.exitCode ?? data.exit_code;',
    '    const message = pickErrorMessage(data);',
    '    if (!message.trim() && (exitCode === 0 || exitCode === undefined)) return;',
    '',
    "    const normalized = message.trim() || (toolName + ' exited with code ' + exitCode);",
    '    const noise = [',
    '      /Input must be provided either through stdin or as a prompt argument when using --print/i,',
    '      /^Error: Input must be provided/i,',
    '    ];',
    '    if (noise.some(pattern => pattern.test(normalized))) return;',
    '',
    '    // Build tool context from Claude Code hook input',
    '    const toolInput = data.toolInput || data.tool_input || {};',
    '    const toolCtx = { toolName: toolName };',
    '    if (toolInput.command) toolCtx.command = String(toolInput.command).slice(0, 500);',
    '    if (toolInput.file_path) toolCtx.filePath = String(toolInput.file_path).slice(0, 300);',
    '    if (exitCode !== undefined) toolCtx.exitCode = exitCode;',
    '    const sessionId = data.sessionId || data.session_id || data.conversationId || data.conversation_id || null;',
    '    const cmdHash = toolInput.command ? shortHash(String(toolInput.command)) : null;',
    '',
    `    execFileSync(${JSON.stringify(agentCmd)}, ['capture', '--agent', 'claude-code', '--capture-source', 'hook', '--hook-type', 'settings-post-tool', '--tool-name', toolName || 'Bash', '--tool-exit-code', String(exitCode ?? ''), ...(sessionId ? ['--session-id', String(sessionId)] : []), ...(cmdHash ? ['--command-hash', String(cmdHash)] : []), '--tool-context', JSON.stringify(toolCtx)], {`,
      '      shell: true,',
      '      input: normalized,',
    "      encoding: 'utf8',",
    '      windowsHide: true,',
    '      timeout: 15000,',
    "      stdio: ['pipe', 'ignore', 'ignore'],",
    `      env: { ...process.env, WINAICHECK_AGENT_BASE_DIR: ${JSON.stringify(baseDir)} },`,
    '    });',
    '',
    '    // Check for WinAICheck updates after capture',
    '    try {',
    `      const updateRaw = execFileSync(${JSON.stringify(agentCmd)}, ['check-update', '--target', 'claude-code'], {`,
    '        shell: true,',
    "        encoding: 'utf8',",
    '        windowsHide: true,',
    '        timeout: 8000,',
    "        stdio: ['pipe', 'pipe', 'ignore'],",
    `        env: { ...process.env, WINAICHECK_AGENT_BASE_DIR: ${JSON.stringify(baseDir)} },`,
    '      });',
    '      const update = JSON.parse(updateRaw);',
    '      if (update.runtimeMessage) {',
    `        process.stdout.write("[WinAICheck] " + update.runtimeMessage + "\\n");`,
    '      }',
    '    } catch {}',
    '  } catch {',
    '    process.exit(0);',
    '  }',
    '})();',
    '',
  ].join('\n');
}

function buildSessionStartHookScript(baseDir) {
  const agentCmd = path.join(baseDir, 'agent', 'winaicheck-agent.cmd');
  return [
    '#!/usr/bin/env node',
    "const { execFileSync } = require('child_process');",
    '',
    'try {',
    `  execFileSync(${JSON.stringify(agentCmd)}, ['hook-seen', '--agent', 'claude-code', '--hook-type', 'settings-session-start', '--capture-source', 'hook'], {`,
    "    stdio: 'ignore',",
    '    shell: true,',
    '    windowsHide: true,',
    '    timeout: 5000,',
    `    env: { ...process.env, WINAICHECK_AGENT_BASE_DIR: ${JSON.stringify(baseDir)} },`,
    '  });',
    '} catch {}',
    '',
    'try {',
    `  const updateRaw = execFileSync(${JSON.stringify(agentCmd)}, ['check-update', '--target', 'claude-code'], {`,
    '    shell: true,',
    "    encoding: 'utf8',",
    '    windowsHide: true,',
    '    timeout: 8000,',
    "    stdio: ['ignore', 'pipe', 'ignore'],",
    `    env: { ...process.env, WINAICHECK_AGENT_BASE_DIR: ${JSON.stringify(baseDir)} },`,
    '  });',
    '  const update = JSON.parse(updateRaw);',
    '  if (update.runtimeMessage) {',
    `    process.stdout.write("[WinAICheck] " + update.runtimeMessage + "\\n");`,
    '  }',
    '} catch {}',
    '',
  ].join('\n');
}

function installLocalAgent(deps = {}) {
  const p = paths(deps);
  ensureDir(p.agentDir);
  const selfPath = fileURLToPath(import.meta.url);
  fs.copyFileSync(selfPath, p.agentJs);
  const hash = computeFileHash(p.agentJs);
  writeJson(path.join(p.agentDir, 'agent-lite.hash.json'), { sha256: hash, installedAt: nowIso(deps) });
  fs.writeFileSync(p.sessionStartHookJs, buildSessionStartHookScript(p.base), 'utf8');
  fs.writeFileSync(p.postToolHookJs, buildPostToolHookScript(p.agentCmd, p.base), 'utf8');
  const cmd = [
    '@echo off',
    'setlocal',
    `set "WINAICHECK_AGENT_BASE_DIR=${p.base}"`,
    'node "%~dp0agent-lite.js" %*',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  fs.writeFileSync(p.agentCmd, cmd, 'utf8');

  // Write WinAICheck version to version-cache.json for check-update
  try {
    const localVersion = localWinAICheckVersion(deps);
    const cache = loadUpdateCache(deps);
    cache.winaicheckVersion = localVersion;
    cache.winaicheckUpdateMode = normalizeUpdateMode(cache.winaicheckUpdateMode);
    saveUpdateCache(cache, deps);
  } catch { /* version write is non-critical */ }

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
  const stdoutStream = deps.processStdout || process.stdout;
  const stderrStream = deps.processStderr || process.stderr;
  const spawnImpl = deps.spawnImpl || spawn;
  markHookSeen(normalizeAgent(args.agent), 'powershell-wrapper', deps);
  if (!verifyAgentIntegrity(deps)) {
    stderrStream.write('WinAICheck: Agent runner 完整性校验失败，正在重新安装...\n');
    installLocalAgent(deps);
  }
  const passthrough = args._ || [];
  const stderrChunks = [];
  const stdoutChunks = [];
  const child = spawnImpl(original, passthrough, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && (!/[\\/]/.test(original) || /\.(cmd|bat)$/i.test(original)),
    windowsHide: false,
  });
  child.stdout.on('data', chunk => {
    const buf = Buffer.from(chunk);
    stdoutChunks.push(buf);
    stdoutStream.write(buf);
  });
  child.stderr.on('data', chunk => {
    const buf = Buffer.from(chunk);
    stderrChunks.push(buf);
    stderrStream.write(buf);
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
      captureSource: 'wrapper',
      hookType: 'powershell-wrapper',
      toolName: normalizeAgent(args.agent),
      toolExitCode: exitCode,
      commandHash: commandHash(original),
      toolContext: {
        original,
        command: original,
        exitCode,
      },
    }, deps), deps);
    const experience = lookupExperience(message);
    if (experience) {
      appendExperience(event, experience, deps);
      stderrStream.write('\nWinAICheck 经验库建议:\n');
      stderrStream.write(`  ${experience.title}\n`);
      stderrStream.write(`  ${experience.advice}\n`);
      if (experience.commands.length > 0) {
        stderrStream.write(`  可尝试: ${experience.commands.join(' | ')}\n`);
      }
    }
    const config = loadConfig(deps);
    if (config.autoSync && config.shareData && !config.paused) await bestEffortSync(deps);
    stderrStream.write(`\nWinAICheck: 已记录 Agent 问题 ${event.eventId}\n`);
  }
  try {
    const update = await resolveUpdateState({ target: runtimeUpdateTargetForAgent(args.agent) }, deps);
    if (update.runtimeMessage) {
      stderrStream.write(`\n[WinAICheck] ${update.runtimeMessage}\n`);
    }
  } catch {
    // Update checks must stay best-effort in wrapper mode.
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

function readRecentEventsForAnalysis(deps = {}, limit = 10) {
  return readJsonl(paths(deps).outbox, 200)
    .filter(event => event && event.captureSource !== 'loop' && event.eventType !== 'agent_signal' && event.eventType !== 'env_drift')
    .slice(-limit);
}

function extractLayer1Signals(events) {
  const map = {};
  for (const event of events) {
    const text = `${event.sanitizedMessage || ''}\n${event.toolContext?.command || ''}`.toLowerCase();
    const fingerprints = [event.fingerprint];
    if (/command not found|not found:|enoent|不是内部或外部命令/.test(text)) {
      mergeSignalMap(map, makeSignal('tool_missing', { title: '关键命令缺失', confidence: 0.8, sourceLayers: ['regex'], sourceFingerprints: fingerprints }));
    }
    if (/mcp|config|json|parse|invalid config|malformed/.test(text)) {
      mergeSignalMap(map, makeSignal('config_breakage', { title: '配置损坏或不兼容', confidence: 0.74, sourceLayers: ['regex'], sourceFingerprints: fingerprints }));
    }
    if (/econnrefused|etimedout|timeout|dns|ssl|certificate|network/.test(text)) {
      mergeSignalMap(map, makeSignal('network_instability', { title: '网络或远端连接不稳定', confidence: 0.72, sourceLayers: ['regex'], sourceFingerprints: fingerprints }));
    }
    if (/unauthorized|forbidden|auth|token|api key|permission denied|eacces/.test(text)) {
      mergeSignalMap(map, makeSignal('auth_failure', { title: '认证或权限失败', confidence: 0.76, sourceLayers: ['regex'], sourceFingerprints: fingerprints }));
    }
    if (/slow|latency|bottleneck|oom|out of memory|throttle/.test(text)) {
      mergeSignalMap(map, makeSignal('perf_bottleneck', { title: '性能瓶颈或资源压力', confidence: 0.68, sourceLayers: ['regex'], sourceFingerprints: fingerprints }));
    }
    if (/unsupported|not supported|not implemented|unknown flag|unknown option|feature/.test(text)) {
      mergeSignalMap(map, makeSignal('capability_gap', { title: '能力缺口或不支持功能', confidence: 0.67, sourceLayers: ['regex'], sourceFingerprints: fingerprints }));
    }
  }
  return map;
}

function scoreKeywordSignals(events, strategy) {
  const strategyPreset = getStrategyPreset(strategy);
  const corpus = events.map(event => `${event.sanitizedMessage || ''}\n${event.toolContext?.command || ''}`).join('\n').toLowerCase();
  const map = {};
  for (const [kind, profile] of Object.entries(SIGNAL_PROFILES)) {
    let score = 0;
    for (const [keyword, weight] of Object.entries(profile.keywords)) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = corpus.match(new RegExp(escaped, 'g'));
      if (matches) score += matches.length * weight;
    }
    score += strategyPreset.keywordBias?.[kind] || 0;
    if (score >= profile.threshold) {
      mergeSignalMap(map, makeSignal(kind, {
        title: profile.title,
        confidence: Math.min(0.95, 0.55 + score / 20),
        sourceLayers: ['keyword'],
        sourceFingerprints: unique(events.map(event => event.fingerprint)),
      }));
    }
  }
  return map;
}

function analyzeRecentHistory(recentAnalyses) {
  const recent = (recentAnalyses || []).slice(-SIGNAL_HISTORY_LIMIT);
  const suppressionWindow = recent.slice(-SIGNAL_SUPPRESSION_WINDOW);
  const signalFreq = {};
  for (const analysis of suppressionWindow) {
    for (const key of analysis.signalKeys || []) {
      signalFreq[key] = (signalFreq[key] || 0) + 1;
    }
  }
  const suppressedSignals = new Set(
    Object.entries(signalFreq)
      .filter(([, count]) => count >= SIGNAL_SUPPRESSION_THRESHOLD)
      .map(([key]) => key)
  );

  let consecutiveEmptyCycles = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if ((recent[i].actionableCount || 0) === 0) consecutiveEmptyCycles++;
    else break;
  }

  let emptyCycleCount = 0;
  for (const analysis of recent.slice(-SIGNAL_SUPPRESSION_WINDOW)) {
    if ((analysis.actionableCount || 0) === 0) emptyCycleCount++;
  }

  return {
    signalFreq,
    suppressedSignals,
    consecutiveEmptyCycles,
    emptyCycleCount,
  };
}

async function collectCommandHealth(name, deps = {}) {
  const override = deps.healthProbe?.commands?.[name];
  if (override) {
    return {
      name,
      installed: !!override.installed,
      resolved: override.resolved || null,
      version: override.version || null,
      major: override.major ?? parseVersionMajor(override.version),
    };
  }

  let resolved = null;
  try {
    resolved = resolveCommand(name);
  } catch {}
  const installed = !!resolved && resolved !== name;

  let version = null;
  if (installed || name === 'node' || name === 'git' || name === 'python') {
    try {
      const args = name === 'python' ? ['--version'] : ['--version'];
      version = execFileSync(name, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {}
  }

  return {
    name,
    installed,
    resolved: installed ? resolved : null,
    version,
    major: parseVersionMajor(version),
  };
}

async function collectDiskHealth(deps = {}) {
  if (deps.healthProbe?.disk) return deps.healthProbe.disk;
  if (process.platform !== 'win32') return { ok: true, percentFree: null, freeBytes: null, totalBytes: null };
  try {
    const baseDrive = String(getBaseDir(deps)).slice(0, 2).replace(/\\/g, '');
    const script = `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${baseDrive}'"; if($d){$o=@{free=[double]$d.FreeSpace;total=[double]$d.Size;percent=[math]::Round(($d.FreeSpace/$d.Size)*100,2)};$o|ConvertTo-Json -Compress}`;
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!raw) return { ok: true, percentFree: null, freeBytes: null, totalBytes: null };
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      percentFree: Number(parsed.percent),
      freeBytes: Number(parsed.free),
      totalBytes: Number(parsed.total),
    };
  } catch {
    return { ok: true, percentFree: null, freeBytes: null, totalBytes: null };
  }
}

async function collectHealthSnapshot(deps = {}) {
  const commands = {};
  for (const name of ['claude', 'openclaw', 'git', 'node', 'python']) {
    commands[name] = await collectCommandHealth(name, deps);
  }

  let dnsOk = true;
  if (deps.healthProbe?.dnsOk !== undefined) {
    dnsOk = !!deps.healthProbe.dnsOk;
  } else {
    try {
      await dnsLookup('aicoevo.net');
      dnsOk = true;
    } catch {
      dnsOk = false;
    }
  }

  let siteReachable = true;
  if (deps.healthProbe?.siteReachable !== undefined) {
    siteReachable = !!deps.healthProbe.siteReachable;
  } else {
    try {
      const fetchImpl = deps.fetchImpl || fetch;
      const res = await fetchImpl('https://aicoevo.net', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      siteReachable = !!res && res.status < 500;
    } catch {
      siteReachable = false;
    }
  }

  const p = paths(deps);
  const hooks = readJson(p.hooks, {});
  const disk = await collectDiskHealth(deps);
  return {
    capturedAt: nowIso(deps),
    dnsOk,
    siteReachable,
    commands,
    disk,
    localRunnerPresent: fs.existsSync(p.agentCmd),
    hookFilesPresent: {
      sessionStart: fs.existsSync(p.sessionStartHookJs),
      postTool: fs.existsSync(p.postToolHookJs),
    },
    hookLastSeen: hooks.lastSeen || {},
  };
}

function describeHealthDrifts(baseline, current) {
  const drifts = [];
  for (const name of Object.keys(current.commands || {})) {
    const before = baseline.commands?.[name];
    const after = current.commands?.[name];
    if (before?.installed && !after?.installed) {
      drifts.push({
        key: `env_drift_command_missing_${name}`,
        title: `${name} 已从环境中消失`,
        detail: `${name} 在基线中存在，但当前检测不到。`,
      });
    } else if (before?.major != null && after?.major != null && before.major !== after.major) {
      drifts.push({
        key: `env_drift_version_changed_${name}`,
        title: `${name} 主版本发生变化`,
        detail: `${name} 已从 ${before.major} 变为 ${after.major}。`,
      });
    }
  }
  if (current.disk?.percentFree != null && current.disk.percentFree < 10) {
    drifts.push({
      key: 'env_drift_disk_low',
      title: '系统磁盘可用空间过低',
      detail: `当前可用空间约 ${current.disk.percentFree}%`,
    });
  }
  if (baseline.dnsOk && !current.dnsOk) {
    drifts.push({
      key: 'env_drift_dns_unavailable',
      title: 'DNS 解析出现异常',
      detail: '当前无法解析 aicoevo.net。',
    });
  }
  if (baseline.siteReachable && !current.siteReachable) {
    drifts.push({
      key: 'env_drift_site_unreachable',
      title: 'AICOEVO 站点当前不可达',
      detail: '当前无法连通 https://aicoevo.net。',
    });
  }
  if (baseline.localRunnerPresent && !current.localRunnerPresent) {
    drifts.push({
      key: 'env_drift_runner_missing',
      title: '本地 Agent runner 已丢失',
      detail: 'winaicheck-agent.cmd 不存在。',
    });
  }
  return drifts;
}

function appendSignalSnapshot(signal, deps = {}) {
  appendJsonl(paths(deps).signals, signal);
}

function createDerivedLoopEvent(signal, deps = {}, overrides = {}) {
  return createEvent({
    agent: overrides.agent || 'custom',
    message: `${signal.title}${signal.detail ? `\n${signal.detail}` : ''}`,
    eventType: overrides.eventType || 'agent_signal',
    severity: overrides.severity || 'warn',
    captureSource: 'loop',
    hookType: 'loop',
    toolName: 'winaicheck-loop',
    sessionId: overrides.sessionId || null,
    toolContext: {
      signalKind: signal.kind,
      confidence: signal.confidence,
      sourceLayers: signal.sourceLayers,
      detail: signal.detail || null,
    },
  }, deps);
}

async function runLoopAnalysis(deps = {}) {
  const config = loadConfig(deps);
  const strategy = STRATEGY_PRESETS[config.strategy] ? config.strategy : DEFAULT_STRATEGY;
  const strategyPreset = getStrategyPreset(strategy);
  const p = paths(deps);
  const state = loadLoopState(deps);
  state.strategy = strategy;
  state.lastRunAt = nowIso(deps);

  const { rows: newRows, nextCursor } = readJsonlSince(p.outbox, state.outboxCursor || 0);
  const recentEvents = readRecentEventsForAnalysis(deps, 10);
  const eventsForSignals = recentEvents.length > 0 ? recentEvents : newRows.filter(event => event && event.captureSource !== 'loop');

  const layer1 = extractLayer1Signals(eventsForSignals);
  const layer2 = scoreKeywordSignals(eventsForSignals, strategy);
  const combined = {};
  for (const signal of Object.values(layer1)) mergeSignalMap(combined, signal);
  for (const signal of Object.values(layer2)) mergeSignalMap(combined, signal);

  const previousHistory = Array.isArray(state.recentAnalyses) ? state.recentAnalyses : [];
  const currentKinds = Object.keys(combined);
  const tentativeAnalysis = { at: nowIso(deps), signalKeys: currentKinds, actionableCount: currentKinds.length };
  const history = analyzeRecentHistory([...previousHistory, tentativeAnalysis]);
  const previousSignalKeys = new Set((previousHistory[previousHistory.length - 1]?.signalKeys) || []);
  const derivedSignals = [];

  let actionableSignals = Object.values(combined).map(signal => {
    const suppressed = history.suppressedSignals.has(signal.kind);
    return {
      ...signal,
      suppressed,
      title: signal.title,
      lastSeenAt: nowIso(deps),
    };
  });

  actionableSignals = actionableSignals.filter(signal => {
    if (!strategyPreset.allowedSignalKinds) return true;
    return strategyPreset.allowedSignalKinds.includes(signal.kind);
  });

  if (history.consecutiveEmptyCycles >= 3 && strategyPreset.allowExplore) {
    actionableSignals.push(makeSignal('explore_opportunity', {
      title: '近期没有新问题，建议主动探索潜在机会',
      confidence: 0.62,
      sourceLayers: ['history'],
    }));
  }
  if (history.emptyCycleCount >= 4) {
    actionableSignals.push(makeSignal('stagnation', {
      title: '近期问题发现进入停滞状态',
      confidence: 0.71,
      sourceLayers: ['history'],
    }));
  }

  const currentSnapshot = await collectHealthSnapshot(deps);
  let baseline = readJson(p.healthBaseline, null);
  const confirmedHealthDrifts = [];
  if (!baseline) {
    baseline = currentSnapshot;
    writeJson(p.healthBaseline, baseline);
    state.health.baselineCreatedAt = currentSnapshot.capturedAt;
  } else {
    const driftCandidates = describeHealthDrifts(baseline, currentSnapshot);
    const nextCounters = {};
    for (const drift of driftCandidates) {
      const count = Number(state.pendingHealthFailures?.[drift.key] || 0) + 1;
      nextCounters[drift.key] = count;
      if (count >= 2) confirmedHealthDrifts.push(drift);
    }
    state.pendingHealthFailures = nextCounters;
  }

  for (const drift of confirmedHealthDrifts) {
    actionableSignals.push(makeSignal(drift.key, {
      title: drift.title,
      confidence: 0.84,
      sourceLayers: ['health'],
    }));
  }

  const finalizedAnalysis = {
    at: nowIso(deps),
    signalKeys: actionableSignals.filter(signal => !signal.suppressed).map(signal => signal.kind),
    actionableCount: actionableSignals.filter(signal => !signal.suppressed).length,
  };
  state.recentAnalyses = [...previousHistory, finalizedAnalysis].slice(-SIGNAL_HISTORY_LIMIT);

  for (const signal of actionableSignals) {
    const current = state.activeSignals[signal.kind];
    const hitCount = (current?.hitCount || 0) + 1;
    const enriched = {
      ...current,
      ...signal,
      hitCount,
      firstSeenAt: current?.firstSeenAt || nowIso(deps),
      lastSeenAt: nowIso(deps),
      sourceLayers: unique([...(current?.sourceLayers || []), ...(signal.sourceLayers || [])]),
      sourceFingerprints: unique([...(current?.sourceFingerprints || []), ...(signal.sourceFingerprints || [])]),
    };
    state.activeSignals[signal.kind] = enriched;

    if (!signal.suppressed && !previousSignalKeys.has(signal.kind)) {
      appendSignalSnapshot(enriched, deps);
      const eventType = signal.kind.startsWith('env_drift_') ? 'env_drift' : 'agent_signal';
      const derivedEvent = createDerivedLoopEvent({
        ...enriched,
        detail: confirmedHealthDrifts.find(item => item.key === signal.kind)?.detail || null,
      }, deps, { eventType });
      storeEvent(derivedEvent, deps);
      derivedSignals.push(enriched.kind);
    }
  }

  const activeSignalKeys = new Set(actionableSignals.map(signal => signal.kind));
  for (const kind of Object.keys(state.activeSignals)) {
    if (!activeSignalKeys.has(kind) && !kind.startsWith('env_drift_')) delete state.activeSignals[kind];
  }

  state.health.lastSnapshotAt = currentSnapshot.capturedAt;
  state.health.lastSnapshot = currentSnapshot;
  state.health.lastDrifts = confirmedHealthDrifts;
  state.outboxCursor = nextCursor;
  state.lastCompletedAt = nowIso(deps);
  state.status = 'running';
  state.consecutiveErrors = 0;
  state.lastError = null;
  saveLoopState(state, deps);

  const recentProblemEvent = [...newRows].reverse().find(event => event && event.captureSource !== 'loop');
  const recentAgeMs = recentProblemEvent?.occurredAt ? Date.parse(nowIso(deps)) - Date.parse(recentProblemEvent.occurredAt) : Number.POSITIVE_INFINITY;
  let mode = 'cold';
  if (newRows.length > 0 || finalizedAnalysis.actionableCount > 0 || recentAgeMs <= 10 * 60 * 1000) mode = 'hot';
  else if (recentAgeMs <= 2 * 60 * 60 * 1000) mode = 'warm';
  const sleepMs = Math.max(1000, Math.round(LOOP_SCHEDULE_MS[mode] * strategyPreset.cadenceScale));

  state.mode = mode;
  state.sleepMs = sleepMs;
  state.nextRunAt = new Date(Date.now() + sleepMs).toISOString();
  saveLoopState(state, deps);

  if (config.autoSync && config.shareData && !config.paused) {
    await bestEffortSync(deps);
  }

  return {
    ok: true,
    strategy,
    mode,
    sleepMs,
    derivedSignals,
    confirmedHealthDrifts: confirmedHealthDrifts.map(item => item.key),
    status: state,
  };
}

function acquireLoopLock(deps = {}) {
  const lockPath = paths(deps).loopLock;
  const now = Date.now();
  try {
    ensureParent(lockPath);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: nowIso(deps), expiresAt: new Date(now + MAX_LOOP_BACKOFF_MS).toISOString() }), { flag: 'wx', encoding: 'utf8' });
    return true;
  } catch {
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (!existing?.pid) return false;
      try {
        process.kill(existing.pid, 0);
        return false;
      } catch {
        fs.unlinkSync(lockPath);
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: nowIso(deps), expiresAt: new Date(now + MAX_LOOP_BACKOFF_MS).toISOString() }), { flag: 'wx', encoding: 'utf8' });
        return true;
      }
    } catch {
      return false;
    }
  }
}

function releaseLoopLock(deps = {}) {
  try {
    const lockPath = paths(deps).loopLock;
    if (fs.existsSync(lockPath)) {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (!existing?.pid || existing.pid === process.pid) fs.unlinkSync(lockPath);
    }
  } catch {}
}

async function runLoopDaemon(args, deps = {}, io = {}) {
  if (!acquireLoopLock(deps)) {
    (io.stdout || process.stdout).write(`${JSON.stringify({ ok: false, error: 'loop already running' }, null, 2)}\n`);
    return 1;
  }

  const state = loadLoopState(deps);
  state.enabled = true;
  state.status = 'running';
  state.pid = process.pid;
  state.startedAt = state.startedAt || nowIso(deps);
  saveLoopState(state, deps);

  const maxCycles = args.maxCycles ? Number(args.maxCycles) : null;
  let cycles = 0;
  try {
    while (true) {
      const current = loadLoopState(deps);
      if (current.enabled === false || current.stopRequestedAt) break;
      try {
        const result = await runLoopAnalysis(deps);
        cycles += 1;
        if (maxCycles && cycles >= maxCycles) break;
        await sleep(result.sleepMs, deps);
      } catch (error) {
        const failed = loadLoopState(deps);
        failed.status = 'backoff';
        failed.consecutiveErrors = (failed.consecutiveErrors || 0) + 1;
        failed.lastError = error instanceof Error ? error.message : String(error);
        const backoffMs = Math.min(MAX_LOOP_BACKOFF_MS, LOOP_SCHEDULE_MS.warm * Math.max(1, failed.consecutiveErrors));
        failed.sleepMs = backoffMs;
        failed.nextRunAt = new Date(Date.now() + backoffMs).toISOString();
        saveLoopState(failed, deps);
        await sleep(backoffMs, deps);
      }
    }
  } finally {
    const finalState = loadLoopState(deps);
    finalState.status = 'stopped';
    finalState.pid = null;
    finalState.nextRunAt = null;
    finalState.stopRequestedAt = null;
    saveLoopState(finalState, deps);
    releaseLoopLock(deps);
  }
  (io.stdout || process.stdout).write(`${JSON.stringify({ ok: true, status: loadLoopState(deps) }, null, 2)}\n`);
  return 0;
}

function loopStatus(deps = {}) {
  const state = loadLoopState(deps);
  return {
    ...state,
    lockPresent: fs.existsSync(paths(deps).loopLock),
  };
}

// ── Worker state management ──

function defaultWorkerState() {
  return {
    schemaVersion: 1,
    enabled: false,
    status: 'stopped',
    pid: null,
    startedAt: null,
    lastCycleAt: null,
    lastCycleResult: null,
    nextCycleAt: null,
    totalCycles: 0,
    totalSolved: 0,
    totalSkipped: 0,
    consecutiveErrors: 0,
    lastError: null,
  };
}

function loadWorkerState(deps = {}) {
  return readJson(paths(deps).workerState, defaultWorkerState());
}

function saveWorkerState(state, deps = {}) {
  writeJson(paths(deps).workerState, state);
}

function acquireWorkerLock(deps = {}) {
  const lockPath = paths(deps).workerLock;
  try {
    const existing = readJson(lockPath, {});
    if (existing.pid && existing.pid !== process.pid) {
      try { process.kill(existing.pid, 0); return false; } catch {
        fs.unlinkSync(lockPath);
      }
    }
    if (existing.pid === process.pid) return true;
  } catch {}
  writeJson(lockPath, { pid: process.pid, startedAt: nowIso(deps) });
  return true;
}

function releaseWorkerLock(deps = {}) {
  try {
    const lockPath = paths(deps).workerLock;
    const existing = readJson(lockPath, {});
    if (!existing?.pid || existing.pid === process.pid) fs.unlinkSync(lockPath);
  } catch {}
}

function isProcessAlive(pid, deps = {}) {
  if (!pid) return false;
  if (typeof deps.isProcessAliveImpl === 'function') {
    try {
      return !!deps.isProcessAliveImpl(pid);
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function activeWorkerLockPid(deps = {}) {
  try {
    const existing = readJson(paths(deps).workerLock, {});
    return isProcessAlive(existing.pid, deps) ? existing.pid : null;
  } catch {
    return null;
  }
}

function buildWorkerSpawnOptions(deps = {}) {
  return {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      WINAICHECK_AGENT_BASE_DIR: getBaseDir(deps),
    },
  };
}

function spawnWorkerViaCmd(local, deps = {}, spawnImpl = spawn) {
  return spawnImpl(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `"${local.agentCmd}" worker daemon`],
    buildWorkerSpawnOptions(deps),
  );
}

function spawnWorkerViaNode(local, deps = {}, spawnImpl = spawn) {
  return spawnImpl(
    process.execPath,
    [local.agentJs, 'worker', 'daemon'],
    buildWorkerSpawnOptions(deps),
  );
}

async function waitForWorkerReady(deps = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs || deps.workerStartTimeoutMs || WORKER_START_TIMEOUT_MS);
  const pollMs = Number(options.pollMs || deps.workerStartPollMs || WORKER_START_POLL_MS);
  const deadline = Date.now() + Math.max(1, timeoutMs);

  while (Date.now() <= deadline) {
    const state = loadWorkerState(deps);
    if (state.status === 'running' && isProcessAlive(state.pid, deps)) {
      return { ok: true, worker: state };
    }
    await sleep(Math.max(1, pollMs), deps);
  }

  return { ok: false, worker: loadWorkerState(deps) };
}

function markWorkerStartFailure(message, deps = {}) {
  releaseWorkerLock(deps);
  const failed = loadWorkerState(deps);
  failed.enabled = true;
  failed.status = 'stopped';
  failed.pid = null;
  failed.nextCycleAt = null;
  failed.lastCycleAt = null;
  failed.lastCycleResult = null;
  failed.consecutiveErrors = (failed.consecutiveErrors || 0) + 1;
  failed.lastError = message;
  saveWorkerState(failed, deps);
  return failed;
}

async function startWorkerDaemon(deps = {}) {
  const config = loadConfig(deps);
  if (!config.workerEnabled) {
    return { ok: true, skipped: true, reason: 'worker disabled' };
  }
  if (!apiKeyHeaders(config)) {
    return { ok: true, skipped: true, reason: 'missing auth token' };
  }

  const local = installLocalAgent(deps);
  const wState = loadWorkerState(deps);
  if (isProcessAlive(wState.pid, deps)) {
    return { ok: true, alreadyRunning: true, pid: wState.pid };
  }

  wState.enabled = true;
  wState.status = 'starting';
  wState.startedAt = wState.startedAt || nowIso(deps);
  wState.stopRequestedAt = null;
  wState.pid = null;
  wState.lastError = null;
  saveWorkerState(wState, deps);

  const spawnImpl = deps.spawnImpl || spawn;
  const launchers = [
    { mode: 'cmd', spawnChild: () => spawnWorkerViaCmd(local, deps, spawnImpl) },
    { mode: 'node', spawnChild: () => spawnWorkerViaNode(local, deps, spawnImpl) },
  ];
  const launchedChildren = [];

  for (const launcher of launchers) {
    const child = launcher.spawnChild();
    child.unref?.();
    launchedChildren.push({ mode: launcher.mode, pid: child.pid });
    const ready = await waitForWorkerReady(deps);
    if (ready.ok) {
      return {
        ok: true,
        started: true,
        pid: ready.worker.pid || child.pid,
        launchPid: child.pid,
        launchMode: launcher.mode,
        worker: ready.worker,
      };
    }
  }

  const currentState = loadWorkerState(deps);
  const activeLockPid = activeWorkerLockPid(deps);
  const pendingLaunch = launchedChildren.find(child => isProcessAlive(child.pid, deps));
  if (activeLockPid || pendingLaunch) {
    return {
      ok: true,
      started: true,
      pending: true,
      pid: currentState.pid || activeLockPid || pendingLaunch?.pid || null,
      launchPid: launchedChildren[launchedChildren.length - 1]?.pid || null,
      launchMode: launchedChildren[launchedChildren.length - 1]?.mode || null,
      warning: 'Worker 正在启动，请稍后运行 `winaicheck agent worker status` 确认状态。',
      worker: currentState,
    };
  }

  const message = 'Worker daemon 未能进入 running 状态，请运行 `winaicheck agent worker daemon` 查看前台日志。';
  const failed = markWorkerStartFailure(message, deps);
  return { ok: false, started: false, error: message, worker: failed };
}

async function runWorkerDaemon(args, deps = {}, io = {}) {
  if (!acquireWorkerLock(deps)) {
    (io.stdout || process.stdout).write(`${JSON.stringify({ ok: false, error: 'worker already running' }, null, 2)}\n`);
    return 1;
  }

  const config = loadConfig(deps);
  const apiKey = apiKeyHeaders(config);
  if (!apiKey) {
    releaseWorkerLock(deps);
    (io.stdout || process.stdout).write('Worker 需要 Agent API Key，请先运行 winaicheck agent bind\n');
    return 1;
  }

  const rawInterval = Number(args.workerInterval || args.interval || WORKER_DEFAULT_INTERVAL_MS);
  const interval = (isNaN(rawInterval) || rawInterval <= 0) ? WORKER_DEFAULT_INTERVAL_MS : rawInterval;
  const maxPerCycle = Number(args.maxParallelTasks || args.limit || WORKER_MAX_PARALLEL);
  const _fetch = deps.fetchImpl || fetch;
  const headers = { ...apiKey, 'Content-Type': 'application/json' };
  const out = io.stdout || process.stdout;

  const state = loadWorkerState(deps);
  state.enabled = true;
  state.status = 'running';
  state.pid = process.pid;
  state.startedAt = state.startedAt || nowIso(deps);
  state.stopRequestedAt = null;
  state.lastError = null;
  state.consecutiveErrors = 0;
  saveWorkerState(state, deps);

  out.write(`[Worker] 启动 (间隔 ${Math.round(interval / 1000)}s, 每轮最多 ${maxPerCycle})\n`);

  try {
    while (true) {
      const currentConfig = loadConfig(deps);
      const currentState = loadWorkerState(deps);

      if (!currentConfig.workerEnabled || currentState.enabled === false) {
        out.write('[Worker] 已禁用，退出\n');
        break;
      }

      if (currentConfig.paused) {
        out.write('[Worker] 已暂停，等待恢复...\n');
        const pauseCheckInterval = Math.min(interval, 10 * 1000);
        await new Promise(r => setTimeout(r, pauseCheckInterval));
        continue;
      }

      try {
        const heartbeat = await heartbeatAgentV2(headers, {
          body: { max_parallel_tasks: maxPerCycle, worker_status: 'active' },
        }, deps);
        const recData = heartbeat.data || {};
        const items = (recData.recommended_bounties || []).slice(0, maxPerCycle);

        let solved = 0;
        let skipped = 0;

        if (items.length === 0) {
          // silent, no output for empty cycles to reduce noise
        } else {
          out.write(`[Worker] 发现 ${items.length} 个推荐任务\n`);
          for (const item of items) {
            if (!/^[a-zA-Z0-9_-]+$/.test(item.id)) { skipped++; continue; }
            // KB auto-solve only — never execute local fix commands
            const solveRes = await _fetch(`${agentApiBase('v1')}/bounties/${item.id}/auto-solve`, {
              method: 'POST', headers,
            });
            let solveData;
            try { solveData = await solveRes.json(); } catch { out.write(`[Worker] auto-solve 返回非 JSON 响应，跳过 ${item.id}\n`); skipped++; continue; }
            if (!solveData.answer || typeof solveData.answer !== 'string') { skipped++; continue; }

            if (!solveData.matched) {
              skipped++;
              continue;
            }

            const submitRes = await _fetch(`${agentApiBase('v2')}/bounties/${item.id}/claim-and-submit`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                ...(item.recommended_env_id ? { env_id: item.recommended_env_id } : {}),
                content: solveData.answer,
                source: 'kb_auto',
                confidence: solveData.confidence || 0.8,
                execution_mode: 'agent',
              }),
            });

            if (submitRes.ok) {
              solved++;
            }
          }
        }

        const updatedState = loadWorkerState(deps);
        updatedState.lastCycleAt = nowIso(deps);
        updatedState.lastCycleResult = { solved, skipped, total: items.length };
        updatedState.totalCycles = (updatedState.totalCycles || 0) + 1;
        updatedState.totalSolved = (updatedState.totalSolved || 0) + solved;
        updatedState.totalSkipped = (updatedState.totalSkipped || 0) + skipped;
        updatedState.consecutiveErrors = 0;
        updatedState.lastError = null;
        updatedState.nextCycleAt = new Date(Date.now() + interval).toISOString();
        saveWorkerState(updatedState, deps);
      } catch (e) {
        const failed = loadWorkerState(deps);
        failed.consecutiveErrors = (failed.consecutiveErrors || 0) + 1;
        failed.totalCycles = (failed.totalCycles || 0) + 1;
        failed.lastError = e instanceof Error ? e.message : String(e);
        const backoff = Math.min(interval * Math.pow(2, failed.consecutiveErrors - 1), 60 * 60 * 1000);
        failed.nextCycleAt = new Date(Date.now() + backoff).toISOString();
        saveWorkerState(failed, deps);
        out.write(`[Worker] 循环错误: ${failed.lastError}\n`);
      }

      const st = loadWorkerState(deps);
      const sleepMs = st.consecutiveErrors > 0
        ? Math.min(interval * Math.pow(2, st.consecutiveErrors - 1), 60 * 60 * 1000)
        : interval;
      await new Promise(r => setTimeout(r, sleepMs));
    }
  } finally {
    const finalState = loadWorkerState(deps);
    finalState.status = 'stopped';
    finalState.pid = null;
    finalState.nextCycleAt = null;
    saveWorkerState(finalState, deps);
    releaseWorkerLock(deps);
  }
  return 0;
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
    let toolContext = null;
    if (args.toolContext) {
      try { toolContext = JSON.parse(args.toolContext); } catch {}
    }
    if (args.hookType) {
      markHookSeen(normalizeAgent(args.agent), String(args.hookType), deps);
    }
    const rawExitCode = args.toolExitCode;
    const parsedExitCode = rawExitCode === undefined || rawExitCode === '' ? null : Number(rawExitCode);
    const event = storeEvent(createEvent({
      agent: args.agent,
      message,
      severity: args.severity,
      captureSource: args.captureSource || (args.hookType ? 'hook' : 'manual'),
      hookType: args.hookType || null,
      sessionId: args.sessionId || null,
      toolName: args.toolName || toolContext?.toolName || null,
      toolExitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : null,
      commandHash: args.commandHash || null,
      toolContext,
    }, deps), deps);
    const experience = lookupExperience(message);
    if (experience) appendExperience(event, experience, deps);
    const config = loadConfig(deps);
    if (config.autoSync && config.shareData && !config.paused) await bestEffortSync(deps);
    out.write(`${JSON.stringify({ ok: true, eventId: event.eventId, fingerprint: event.fingerprint }, null, 2)}\n`);
    return 0;
  }

  if (command === 'hook-seen') {
    const agent = normalizeAgent(args.agent);
    const seen = markHookSeen(agent, String(args.hookType || 'hook'), deps);
    out.write(`${JSON.stringify({ ok: true, agent, ...seen }, null, 2)}\n`);
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
    out.write(command === 'pause' ? '已暂停自动上传和 Worker 互助循环。\n' : '已恢复自动上传和 Worker 互助循环。\n');
    return 0;
  }

  if (command === 'disable') {
    const config = loadConfig(deps);
    config.workerEnabled = false;
    saveConfig(config, deps);
    const wState = loadWorkerState(deps);
    if (wState.pid) {
      try { process.kill(wState.pid); } catch {}
    }
    wState.enabled = false;
    wState.status = 'stopped';
    wState.pid = null;
    wState.nextCycleAt = null;
    saveWorkerState(wState, deps);
    releaseWorkerLock(deps);
    out.write('已彻底禁用 Worker 互助循环。使用 worker-enable 可重新开启。\n');
    return 0;
  }

  if (command === 'worker-enable') {
    const config = loadConfig(deps);
    config.workerEnabled = true;
    saveConfig(config, deps);
    out.write('Worker 互助循环已重新启用。运行 worker start 启动后台循环。\n');
    return 0;
  }

  if (command === 'strategy') {
    const [subcommand] = rest;
    const config = loadConfig(deps);
    if (!subcommand || subcommand === 'get') {
      out.write(`${JSON.stringify({ ok: true, strategy: config.strategy || DEFAULT_STRATEGY }, null, 2)}\n`);
      return 0;
    }
    if (subcommand === 'set') {
      const strategy = String(args._[1] || args.value || '').trim();
      if (!STRATEGY_PRESETS[strategy]) {
        throw new Error(`不支持的策略: ${strategy}`);
      }
      config.strategy = strategy;
      saveConfig(config, deps);
      const state = loadLoopState(deps);
      state.strategy = strategy;
      saveLoopState(state, deps);
      out.write(`${JSON.stringify({ ok: true, strategy }, null, 2)}\n`);
      return 0;
    }
  }

  if (command === 'loop') {
    const [subcommand] = rest;
    if (subcommand === 'status') {
      out.write(`${JSON.stringify({ ok: true, loop: loopStatus(deps) }, null, 2)}\n`);
      return 0;
    }
    if (subcommand === 'run-once') {
      const state = loadLoopState(deps);
      state.enabled = true;
      state.status = 'running';
      state.pid = process.pid;
      saveLoopState(state, deps);
      const result = await runLoopAnalysis(deps);
      out.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (subcommand === 'daemon') {
      return runLoopDaemon(args, deps, io);
    }
    if (subcommand === 'start') {
      const local = installLocalAgent(deps);
      const state = loadLoopState(deps);
      if (state.pid) {
        try {
          process.kill(state.pid, 0);
          out.write(`${JSON.stringify({ ok: true, alreadyRunning: true, loop: loopStatus(deps) }, null, 2)}\n`);
          return 0;
        } catch {}
      }
      state.enabled = true;
      state.status = 'starting';
      state.startedAt = state.startedAt || nowIso(deps);
      saveLoopState(state, deps);
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${local.agentCmd}" loop daemon`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      out.write(`${JSON.stringify({ ok: true, started: true, pid: child.pid, loop: loopStatus(deps) }, null, 2)}\n`);
      return 0;
    }
    if (subcommand === 'stop') {
      const state = loadLoopState(deps);
      state.enabled = false;
      state.stopRequestedAt = nowIso(deps);
      saveLoopState(state, deps);
      if (state.pid) {
        try { process.kill(state.pid); } catch {}
      }
      releaseLoopLock(deps);
      const next = loadLoopState(deps);
      next.status = 'stopped';
      next.pid = null;
      next.nextRunAt = null;
      saveLoopState(next, deps);
      out.write(`${JSON.stringify({ ok: true, stopped: true, loop: loopStatus(deps) }, null, 2)}\n`);
      return 0;
    }
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
    const target = String(args.target || 'all');
    const localAgent = installLocalAgent(deps);
    const installed = [];

    if (targetIncludesClaude(target)) {
      const settingsHook = installSettingsHook(args, deps);
      installed.push(settingsHook.hooks.join(', '));
    }

    if (targetIncludesOpenClaw(target)) {
      const hook = installHook({ target: 'openclaw' }, deps);
      installed.push(`PowerShell Hook: ${hook.agents.map(agent => agent.target).join(', ')}`);
    }

    const config = loadConfig(deps);
    config.shareData = true;
    config.autoSync = true;
    config.paused = false;
    if (config.workerEnabled === undefined) config.workerEnabled = true;
    saveConfig(config, deps);
    out.write(`WinAICheck Agent Lite 已启用\n`);
    out.write(`  Agent Runner: ${localAgent.agentJs}\n`);
    out.write(`  Hook: ${installed.join(' | ')}\n`);
    out.write(`  自动同步: 已启用\n`);
    if (config.workerEnabled) {
      try {
        const workerStart = await startWorkerDaemon(deps);
        if (workerStart.pending) {
          out.write(`  Worker 互助循环: 启动中，请稍后运行 worker status 确认\n`);
        } else if (workerStart.started) {
          out.write(`  Worker 互助循环: 已启动 (pid ${workerStart.pid})\n`);
        } else if (workerStart.alreadyRunning) {
          out.write(`  Worker 互助循环: 已运行中\n`);
        } else if (workerStart.reason === 'missing auth token') {
          out.write(`  Worker 互助循环: 等待绑定完成后自动启动\n`);
        } else if (workerStart.error) {
          out.write(`  Worker 互助循环: 启动失败 (${workerStart.error})\n`);
        } else {
          out.write(`  Worker 互助循环: 已禁用\n`);
        }
      } catch (e) {
        out.write(`  Worker 互助循环: 启动失败 (${e.message})\n`);
      }
    } else {
      out.write(`  Worker 互助循环: 已禁用\n`);
    }
    out.write(`\nClaude Code 请重启会话；OpenClaw 请重启 PowerShell 或重新加载 profile。\n`);
    return 0;
  }

  if (command === 'uninstall-hook') {
    const target = String(args.target || 'all');
    if (targetIncludesClaude(target)) uninstallSettingsHook(args, deps);
    uninstallHook(args, deps);
    out.write('已卸载 WinAICheck Agent Hook。\n');
    return 0;
  }

  if (command === 'migrate') {
    const target = String(args.target || 'all');
    const removedLegacy = uninstallHook({ target: 'all' }, deps);
    const installed = [];

    if (targetIncludesClaude(target)) {
      const settingsHook = installSettingsHook(args, deps);
      installed.push(settingsHook.hooks.join(', '));
    }
    if (targetIncludesOpenClaw(target)) {
      const openclawHook = installHook({ target: 'openclaw' }, deps);
      installed.push(`PowerShell Hook: ${openclawHook.agents.map(agent => agent.target).join(', ')}`);
    }

    const p = paths(deps);
    const hooks = readJson(p.hooks, {});
    writeJson(p.hooks, {
      ...hooks,
      hookType: 'settings',
      migratedAt: nowIso(deps),
      legacyProfiles: removedLegacy.profiles,
    });

    out.write(`WinAICheck Agent Hook 已迁移\n`);
    out.write(`  新 Hook: ${installed.join(' | ')}\n`);
    out.write(`  已清理旧 PowerShell profile: ${removedLegacy.profiles.join(', ')}\n`);
    out.write(`\nClaude Code 请重启会话；OpenClaw 请重启 PowerShell 或重新加载 profile。\n`);
    return 0;
  }

  if (command === 'self-update') {
    const target = normalizeUpdateTarget(args.target);
    const localAgent = installLocalAgent(deps);
    const refreshed = [];
    if (targetIncludesClaude(target)) {
      const settingsHook = installSettingsHook({ target: 'claude-code' }, deps);
      refreshed.push(settingsHook.hooks.join(', '));
    }
    if (targetIncludesOpenClaw(target)) {
      const hook = installHook({ target: 'openclaw' }, deps);
      refreshed.push(`PowerShell Hook: ${hook.agents.map(agent => agent.target).join(', ')}`);
    }
    const cache = loadUpdateCache(deps);
    const version = localWinAICheckVersion(deps);
    cache.winaicheckVersion = version;
    cache.winaicheckLatest = version;
    cache.winaicheckHasUpdate = false;
    cache.winaicheckUpdateCheck = nowIso(deps);
    cache.winaicheckLastSelfUpdate = nowIso(deps);
    cache.winaicheckUpdateMode = normalizeUpdateMode(cache.winaicheckUpdateMode);
    saveUpdateCache(cache, deps);
    out.write(`${JSON.stringify({
      ok: true,
      target,
      version,
      agentJs: localAgent.agentJs,
      hooks: refreshed,
    }, null, 2)}\n`);
    return 0;
  }

  if (command === 'auto-update') {
    const [subcommand = 'status'] = rest;
    const cache = loadUpdateCache(deps);
    if (subcommand === 'status') {
      const mode = normalizeUpdateMode(cache.winaicheckUpdateMode);
      out.write(`${JSON.stringify({ ok: true, mode }, null, 2)}\n`);
      return 0;
    }
    const nextMode = subcommand === 'on'
      ? 'auto'
      : subcommand === 'off'
        ? 'off'
        : subcommand === 'notify'
          ? 'notify'
          : null;
    if (!nextMode) {
      out.write('用法: winaicheck agent auto-update status|on|off|notify\n');
      return 1;
    }
    cache.winaicheckUpdateMode = nextMode;
    cache.winaicheckVersion = cache.winaicheckVersion || localWinAICheckVersion(deps);
    saveUpdateCache(cache, deps);
    out.write(`${JSON.stringify({ ok: true, mode: nextMode }, null, 2)}\n`);
    return 0;
  }

  if (command === 'run') {
    return runOriginalAgent(args, deps);
  }

  if (command === 'check-update') {
    const result = await resolveUpdateState({ target: args.target || 'all', mode: args.mode }, deps);
    out.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
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

  if (command === 'bind') {
    const config = loadConfig(deps);
    const out = io.stdout || process.stdout;
    const errOut = io.stderr || process.stderr;

    // 兼容旧流程：如果用户提供了 --code，走旧的 6 位码交换
    const bindCode = String(args.code || '').trim();
    if (bindCode && /^\d{6}$/.test(bindCode)) {
      out.write(`正在绑定设备...\n`);
      const result = await requestJson(`${apiBase()}/bind/${bindCode}`, {
        method: 'POST',
      }, deps);

      if (result.status !== 200) {
        errOut.write(`绑定失败 (${result.status}): ${(result.data || {}).detail || '验证码无效或已过期'}\n`);
        return 1;
      }

      const { api_key } = result.data;
      config.authToken = api_key;
      config.shareData = true;
      config.autoSync = true;
      config.paused = false;
      config.confirmedAt = nowIso(deps);
      saveConfig(config, deps);

      out.write(`\n绑定成功!\n  自动同步: 已启用\n\n`);
      if (config.workerEnabled) {
        try {
          const workerStart = await startWorkerDaemon(deps);
          if (workerStart.pending) out.write(`  Worker 互助循环: 启动中，请稍后运行 worker status 确认\n\n`);
          else if (workerStart.started) out.write(`  Worker 互助循环: 已启动 (pid ${workerStart.pid})\n\n`);
          else if (workerStart.error) out.write(`  Worker 互助循环: 启动失败 (${workerStart.error})\n\n`);
        } catch (e) {
          out.write(`  Worker 互助循环: 启动失败 (${e.message})\n\n`);
        }
      }
      return 0;
    }

    // 新流程：OAuth 设备流（自动打开浏览器）
    const agentName = String(args.agent || 'unknown').trim();
    const deviceInfo = `${os.hostname()}/${process.platform}`;

    out.write(`正在发起设备绑定...\n`);

    // Step 1: 创建绑定请求
    const reqResult = await requestJson(
      `${apiBase()}/bind/request?agent_type=${encodeURIComponent(agentName)}&device_info=${encodeURIComponent(deviceInfo)}&device_id=${encodeURIComponent(config.deviceId)}`,
      { method: 'POST' },
      deps,
    );

    if (reqResult.status !== 200) {
      errOut.write(`绑定请求失败 (${reqResult.status}): ${(reqResult.data || {}).detail || '未知错误'}\n`);
      return 1;
    }

    const { request_token, confirm_url, expires_in } = reqResult.data;
    out.write(`\n请在浏览器中确认绑定:\n`);
    out.write(`  ${confirm_url}\n\n`);

    // Step 2: 尝试自动打开浏览器
    try {
      const startCmd = process.platform === 'win32' ? 'start' : 'open';
      execFileSync(startCmd, [confirm_url], { timeout: 5000, windowsHide: true });
      out.write(`已自动打开浏览器。\n\n`);
    } catch {
      out.write(`请手动复制上方链接到浏览器中打开。\n\n`);
    }

    // Step 3: 轮询等待确认
    out.write(`等待确认中`);
    const maxPolls = Math.min(Math.floor(expires_in / 3), 200);
    for (let i = 0; i < maxPolls; i++) {
      await sleep(3000, deps);
      out.write('.');

      const pollResult = await requestJson(
        `${apiBase()}/bind/poll?request_token=${encodeURIComponent(request_token)}`,
        { method: 'GET' },
        deps,
      );

      if (pollResult.status !== 200) {
        // 可能已过期
        errOut.write(`\n绑定请求已过期，请重新运行 bind 命令。\n`);
        return 1;
      }

      const { status, api_key } = pollResult.data;

      if (status === 'confirmed' && api_key) {
        out.write(`\n\n`);
        config.authToken = api_key;
        config.shareData = true;
        config.autoSync = true;
        config.paused = false;
        config.confirmedAt = nowIso(deps);
        saveConfig(config, deps);

        out.write(`绑定成功!\n`);
        out.write(`  自动同步: 已启用\n\n`);
        if (config.workerEnabled) {
          try {
            const workerStart = await startWorkerDaemon(deps);
            if (workerStart.pending) out.write(`  Worker 互助循环: 启动中，请稍后运行 worker status 确认\n\n`);
            else if (workerStart.started) out.write(`  Worker 互助循环: 已启动 (pid ${workerStart.pid})\n\n`);
            else if (workerStart.error) out.write(`  Worker 互助循环: 启动失败 (${workerStart.error})\n\n`);
          } catch (e) {
            out.write(`  Worker 互助循环: 启动失败 (${e.message})\n\n`);
          }
        }
        out.write(`现在 Claude Code 中的错误会自动记录并同步到 aicoevo.net。\n`);
        return 0;
      }

      if (status === 'expired') {
        out.write(`\n\n`);
        errOut.write(`绑定请求已过期，请重新运行 bind 命令。\n`);
        return 1;
      }
    }

    out.write(`\n\n绑定超时，请重新运行 bind 命令。\n`);
    return 1;
  }

  // ── Bounty commands: list, recommended ──
  if (command === 'bounty-list') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const page = args.page || '1';
    const pageSize = args.limit || '10';
    const sortBy = args.sort || 'reward';
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await _fetch(`${agentApiBase('v1')}/bounties?page=${page}&page_size=${pageSize}&sort_by=${sortBy}`, {
        headers,
      });
      const data = await res.json();
      out.write(`${JSON.stringify(data, null, 2)}\n`);
    } catch (e) { out.write(`获取悬赏列表失败: ${e.message}\n`); return 1; }
    return 0;
  }

  // ── Worker commands ──
  if (command === 'worker') {
    const [subcommand] = rest;
    if (subcommand === 'status') {
      const config = loadConfig(deps);
      const wState = loadWorkerState(deps);
      out.write(`${JSON.stringify({
        ok: true,
        workerEnabled: config.workerEnabled,
        paused: config.paused,
        worker: wState,
        lockPresent: fs.existsSync(paths(deps).workerLock),
      }, null, 2)}\n`);
      return 0;
    }
    if (subcommand === 'start') {
      const config = loadConfig(deps);
      if (!config.workerEnabled) {
        out.write('Worker 已被禁用。使用 worker-enable 重新启用。\n');
        return 1;
      }
      const result = await startWorkerDaemon(deps);
      const payload = {
        ...result,
        worker: result.worker || loadWorkerState(deps),
      };
      out.write(`${JSON.stringify(payload, null, 2)}\n`);
      return result.ok === false ? 1 : 0;
    }
    if (subcommand === 'stop') {
      const wState = loadWorkerState(deps);
      wState.enabled = false;
      wState.stopRequestedAt = nowIso(deps);
      saveWorkerState(wState, deps);
      if (wState.pid) {
        try { process.kill(wState.pid); } catch {}
      }
      releaseWorkerLock(deps);
      const next = loadWorkerState(deps);
      next.status = 'stopped';
      next.pid = null;
      next.nextCycleAt = null;
      saveWorkerState(next, deps);
      out.write(`${JSON.stringify({ ok: true, stopped: true, worker: loadWorkerState(deps) }, null, 2)}\n`);
      return 0;
    }
    if (subcommand === 'daemon') {
      return runWorkerDaemon(args, deps, io);
    }
    out.write('用法: worker start|stop|status|daemon\n');
    return 1;
  }

  if (command === 'bounty-recommended') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const strategy = args.strategy || 'balanced';
    const limit = args.limit || '10';
    try {
      const result = await heartbeatAgentV2(headers, {
        body: { max_parallel_tasks: Number(args.maxParallelTasks || 1) },
      }, deps);
      const data = result.data || {};
      out.write(`${JSON.stringify({
        items: (data.recommended_bounties || []).slice(0, Number(limit)),
        total: Array.isArray(data.recommended_bounties) ? data.recommended_bounties.length : 0,
        strategy,
      }, null, 2)}\n`);
    } catch (e) { out.write(`获取推荐悬赏失败: ${e.message}\n`); return 1; }
    return 0;
  }

  // ── Bounty: solve (KB 匹配获取答案) ──
  if (command === 'bounty-solve') {
    const config = loadConfig(deps);
    const auth = apiKeyHeaders(config);
    if (!auth) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const id = args._[0];
    if (!id) { out.write('用法: winaicheck agent bounty-solve <id>\n'); return 1; }
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await _fetch(`${agentApiBase('v1')}/bounties/${id}/auto-solve`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) { out.write(`KB 匹配失败: ${data.detail || JSON.stringify(data)}\n`); return 1; }
      out.write(`${JSON.stringify(data, null, 2)}\n`);
    } catch (e) { out.write(`KB 匹配失败: ${e.message}\n`); return 1; }
    return 0;
  }

  // ── Bounty: claim (认领悬赏) ──
  if (command === 'bounty-claim') {
    const config = loadConfig(deps);
    const auth = apiKeyHeaders(config);
    if (!auth) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const id = args._[0];
    if (!id) { out.write('用法: winaicheck agent bounty-claim <id>\n'); return 1; }
    const envId = String(args.env || '').trim();
    const _fetch = deps.fetchImpl || fetch;
    try {
      const heartbeat = await heartbeatAgentV2(auth, {
        body: { available_env_ids: envId ? [envId] : [] },
      }, deps);
      if (heartbeat.status >= 400) { out.write(`心跳失败: ${JSON.stringify(heartbeat.data)}\n`); return 1; }
      const res = await _fetch(`${agentApiBase('v2')}/bounties/${id}/claim`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(envId ? { env_id: envId } : {}),
      });
      const data = await res.json();
      if (!res.ok) { out.write(`认领失败: ${data.detail || JSON.stringify(data)}\n`); return 1; }
      out.write(`✓ 认领成功 ${data.bounty_id} (lease ${data.lease_id})\n`);
      out.write(`  截止: ${data.claimed_until}\n`);
      if (data.slot_limit) out.write(`  并行槽位: ${data.slot_limit}\n`);
    } catch (e) { out.write(`认领失败: ${e.message}\n`); return 1; }
    return 0;
  }

  // ── Bounty: submit (提交回答) ──
  if (command === 'bounty-submit') {
    const config = loadConfig(deps);
    const auth = apiKeyHeaders(config);
    if (!auth) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const id = args._[0];
    const content = args.content;
    if (!id || !content) { out.write('用法: winaicheck agent bounty-submit <id> --content <text>\n'); return 1; }
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await _fetch(`${agentApiBase('v2')}/bounties/${id}/submit`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          source: args.source || 'manual',
          confidence: Number(args.confidence || 0),
          execution_mode: args.executionMode || 'agent',
        }),
      });
      const data = await res.json();
      if (!res.ok) { out.write(`提交失败: ${data.detail || JSON.stringify(data)}\n`); return 1; }
      out.write(`✓ 回答已提交 ${data.id}\n`);
    } catch (e) { out.write(`提交失败: ${e.message}\n`); return 1; }
    return 0;
  }

  // ── Bounty: release (释放认领) ──
  if (command === 'bounty-release') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const id = args._[0];
    if (!id) { out.write('用法: winaicheck agent bounty-release <id>\n'); return 1; }
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await _fetch(`${agentApiBase('v2')}/bounties/${id}/claim`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) { out.write(`释放失败: ${data.detail || JSON.stringify(data)}\n`); return 1; }
      out.write(`✓ 认领已释放 ${data.bounty_id}\n`);
    } catch (e) { out.write(`释放失败: ${e.message}\n`); return 1; }
    return 0;
  }

  // ── Bounty: auto (自动循环: 推荐 → KB匹配 → claim+submit) ──
  if (command === 'bounty-auto') {
    const config = loadConfig(deps);
    const apiKey = apiKeyHeaders(config);
    if (!apiKey) { out.write('悬赏命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const interval = parseInt(args.interval || '300', 10);
    const maxPerCycle = parseInt(args.limit || '3', 10);
    const _fetch = deps.fetchImpl || fetch;
    const headers = { ...apiKey, 'Content-Type': 'application/json' };
    const strategy = args.strategy || 'balanced';

    out.write(`bounty-auto 启动 (间隔 ${interval}s, 每轮最多 ${maxPerCycle})\n`);

    let cycle = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      cycle++;
      try {
        // 1. 心跳
        const heartbeat = await heartbeatAgentV2(headers, {
          body: { max_parallel_tasks: maxPerCycle },
        }, deps);
        const recData = heartbeat.data || {};
        const items = (recData.recommended_bounties || []).slice(0, maxPerCycle);

        if (items.length === 0) {
          out.write(`[${cycle}] 无推荐悬赏\n`);
        } else {
          out.write(`[${cycle}] 发现 ${items.length} 个推荐悬赏\n`);
          let solved = 0;

          for (const item of items) {
            // 3. KB 匹配
            const solveRes = await _fetch(`${agentApiBase('v1')}/bounties/${item.id}/auto-solve`, {
              method: 'POST', headers,
            });
            const solveData = await solveRes.json();

            if (!solveData.matched) {
              out.write(`  [${item.id}] KB 无匹配，跳过\n`);
              continue;
            }

            // 4. Delayed claim + submit
            const submitRes = await _fetch(`${agentApiBase('v2')}/bounties/${item.id}/claim-and-submit`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                ...(item.recommended_env_id ? { env_id: item.recommended_env_id } : {}),
                content: solveData.answer,
                source: 'kb_auto',
                confidence: solveData.confidence || 0.8,
                execution_mode: 'agent',
              }),
            });

            if (submitRes.ok) {
              const submitData = await submitRes.json();
              out.write(`  ✓ [${item.id}] 已提交 KB 匹配回答 (${submitData.id})\n`);
              solved++;
            } else {
              const errData = await submitRes.json().catch(() => ({}));
              out.write(`  ✗ [${item.id}] 提交失败: ${errData.detail || '未知错误'}\n`);
            }
          }

          out.write(`[${cycle}] 本轮解决 ${solved}/${items.length}\n`);
        }
      } catch (e) {
        out.write(`[${cycle}] 循环错误: ${e.message}\n`);
      }

      // 等待下一轮
      out.write(`等待 ${interval}s...\n`);
      await new Promise(r => setTimeout(r, interval * 1000));
    }
  }

  // ── TASK-100: 发起者复现循环 ──

  if (command === 'owner-check') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await requestJson(`${agentApiBase('v2')}/status`, { headers }, { fetchImpl: _fetch });
      if (res.status !== 200) { out.write(`获取状态失败: ${res.status}\n`); return 1; }
      const data = res.data;
      const pending = data.pending_owner_verifications || [];
      if (pending.length === 0) {
        out.write('没有待复现确认的方案。\n');
        return 0;
      }
      out.write(`待复现确认 (${pending.length}):\n\n`);
      for (const item of pending) {
        const guide = writeOwnerVerifyGuide(item, config, deps);
        out.write(`## ${item.title || '(无标题)'}\n`);
        out.write(`  Bounty:   ${item.bounty_id}\n`);
        out.write(`  Answer:   ${item.answer_id}\n`);
        out.write(`  方案摘要: ${item.solution_summary}\n`);
        out.write(`  提交时间: ${item.submitted_at}\n`);
        out.write(`  截止时间: ${item.deadline_at}\n\n`);
        out.write(`  指南:     ${guide.guideMd}\n`);
        out.write(`  快照:     ${guide.snapshotJson}\n\n`);
        out.write(`  → winaicheck agent owner-verify ${item.bounty_id} --answer ${item.answer_id} --result success|partial|failed\n\n`);
      }
    } catch (e) { out.write(`获取待复现列表失败: ${e.message}\n`); return 1; }
    return 0;
  }

  if (command === 'owner-verify') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const _fetch = deps.fetchImpl || fetch;
    const bountyId = args._[0];
    const answerId = String(args.answer || '');
    const resultValue = String(args.result || '');
    if (!bountyId || !answerId || !/^(success|partial|failed)$/.test(resultValue)) {
      out.write('用法: winaicheck agent owner-verify <bounty_id> --answer <id> --result success|partial|failed\n');
      out.write('       [--notes <text>] [--cmd <cmd1,cmd2>]\n');
      return 1;
    }
    const notes = String(args.notes || '');
    const commandsRun = args.cmd ? String(args.cmd).split(',').map(s => s.trim()).filter(Boolean) : [];
    const fallbackItem = {
      bounty_id: bountyId,
      answer_id: answerId,
      title: '待确认方案',
      solution_summary: notes || '请在本地环境确认问题是否已消失。',
      submitted_at: '',
      deadline_at: '',
    };
    let guideRecord = loadOwnerVerifySnapshot(bountyId, answerId, deps);
    if (!guideRecord.snapshot) {
      guideRecord = writeOwnerVerifyGuide(fallbackItem, config, deps);
    }

    // prompt 策略: 默认必须提示用户确认
    const skipPrompt = args.yes === true || args.yes === 'true';
    if (!skipPrompt) {
      out.write(`\n即将提交复现验证:\n`);
      out.write(`  Bounty: ${bountyId}\n`);
      out.write(`  Answer: ${answerId}\n`);
      out.write(`  Result: ${resultValue}\n`);
      out.write(`\n请确认您已在本地环境验证该方案。输入 yes 继续: `);
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const confirm = await new Promise(resolve => rl.question('', ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
      if (confirm !== 'yes' && confirm !== 'y') {
        out.write('已取消。\n');
        return 0;
      }
    }

    try {
      const submittedAt = nowIso(deps);
      const afterContext = {
        submitted_at: submittedAt,
        confirmation_mode: skipPrompt ? 'flag_yes' : 'interactive_prompt',
        result: resultValue,
        notes,
        commands_run: commandsRun,
        local_context: ownerVerifyLocalContext(config),
      };
      const res = await requestJson(`${agentApiBase('v2')}/bounties/${bountyId}/owner-verify`, {
        method: 'POST',
        headers,
        body: {
          answer_id: answerId,
          result: resultValue,
          notes,
          commands_run: commandsRun,
          proof_payload: {
            summary: `Owner verification for ${bountyId}/${answerId}`,
            steps: [
              `读取本地指南: ${guideRecord.guideMd}`,
              commandsRun.length
                ? `本地执行验证命令: ${commandsRun.join(' ; ')}`
                : '按本地指南手动确认问题是否消失。',
              `用户确认结果: ${resultValue}`,
            ],
            before_context: guideRecord.snapshot || {},
            after_context: afterContext,
            validation_cmd: commandsRun[0] || '',
            expected_output:
              resultValue === 'success'
                ? '问题已消失或行为符合预期'
                : resultValue === 'partial'
                  ? '问题部分缓解，但仍有残留'
                  : '问题仍然可复现',
          },
          artifacts: {
            owner_reproduction_guide_path: guideRecord.guideMd,
            owner_reproduction_snapshot_path: guideRecord.snapshotJson,
            owner_reproduction_guide_sha256: guideRecord.guideSha256,
            owner_reproduction_snapshot_generated_at: guideRecord.snapshot?.generatedAt || '',
          },
        },
      }, { fetchImpl: _fetch });
      if (res.status !== 200) {
        out.write(`提交失败 (${res.status}): ${JSON.stringify(res.data)}\n`);
        return 1;
      }
      const data = res.data;
      out.write(`复现验证已提交:\n`);
      out.write(`  状态: ${data.review_status || 'unknown'}\n`);
      out.write(`  Owner 分数: ${data.owner_score ?? '-'}\n`);
      out.write(`  社区分数: ${data.community_score ?? '-'}\n`);
      out.write(`  总分: ${data.total_score ?? '-'} / ${data.threshold ?? 70}\n`);
    } catch (e) { out.write(`提交复现验证失败: ${e.message}\n`); return 1; }
    return 0;
  }

  if (command === 'review-list') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('评审命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await _fetch(`${agentApiBase('v2')}/reviews/recommended`, { headers });
      const data = await res.json();
      out.write(`${JSON.stringify(data, null, 2)}\n`);
    } catch (e) { out.write(`获取评审任务失败: ${e.message}\n`); return 1; }
    return 0;
  }

  if (command === 'review-submit') {
    const config = loadConfig(deps);
    const headers = apiKeyHeaders(config);
    if (!headers) { out.write('评审命令需要 Agent API Key，请先运行 winaicheck agent bind\n'); return 1; }
    const leaseId = args._[0];
    const resultValue = String(args.result || '');
    if (!leaseId || !/^(success|partial|failed)$/.test(resultValue)) {
      out.write('用法: winaicheck agent review-submit <lease_id> --result success|partial|failed\n');
      return 1;
    }
    const _fetch = deps.fetchImpl || fetch;
    try {
      const res = await _fetch(`${agentApiBase('v2')}/reviews/${leaseId}/submit`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: resultValue,
          method: args.method || 'semantic',
          notes: args.notes || '',
          confidence: Number(args.confidence || 0),
          review_score: Number(args.reviewScore || 0),
          review_summary: args.summary || '',
          execution_mode: args.executionMode || 'agent',
        }),
      });
      const data = await res.json();
      if (!res.ok) { out.write(`提交评审失败: ${data.detail || JSON.stringify(data)}\n`); return 1; }
      out.write(`✓ 评审已提交 ${leaseId}\n`);
    } catch (e) { out.write(`提交评审失败: ${e.message}\n`); return 1; }
    return 0;
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
  installSettingsHook,
  uninstallSettingsHook,
  settingsFilePath,
  installLocalAgent,
  resolveCommand,
  selectResolvedCommand,
  readJsonl,
  readJson,
  writeJson,
  readJsonlSince,
  updateDaily,
  loadLoopState,
  saveLoopState,
  runLoopAnalysis,
  collectHealthSnapshot,
  describeHealthDrifts,
  loopStatus,
  markHookSeen,
  lookupExperience,
  apiKeyHeaders,
  agentApiBase,
  loadWorkerState,
  saveWorkerState,
  defaultWorkerState,
  loadConfig,
  saveConfig,
  heartbeatAgentV2,
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
