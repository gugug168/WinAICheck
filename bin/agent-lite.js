import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ORIGIN = 'http://aicoevo.net';
const MAX_CAPTURE_CHARS = 8000;
const MAX_UPLOAD_EVENTS = 50;
const HOOK_START = '# >>> WinAICheck Agent Hook >>>';
const HOOK_END = '# <<< WinAICheck Agent Hook <<<';

const SENSITIVE_PATTERNS = [
  { regex: /(?:sk-|api[_-]?key[_-]?)([a-zA-Z0-9_-]{20,})/gi, replacement: '<API_KEY>' },
  { regex: /Bearer\s+[a-zA-Z0-9._-]+/gi, replacement: 'Bearer <TOKEN>' },
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

function writeJson(file, data) {
  ensureParent(file);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function appendJsonl(file, data) {
  ensureParent(file);
  fs.appendFileSync(file, `${JSON.stringify(data)}\n`, 'utf8');
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function writeJsonl(file, rows) {
  ensureParent(file);
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
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
  const config = readJson(p.config, {});
  if (!config.clientId) config.clientId = `client_${crypto.randomUUID()}`;
  if (!config.deviceId) config.deviceId = `device_${crypto.randomUUID()}`;
  if (config.shareData === undefined) config.shareData = false;
  if (config.autoSync === undefined) config.autoSync = false;
  if (config.paused === undefined) config.paused = false;
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

function updateDaily(event, deps = {}) {
  const p = paths(deps);
  const date = event.occurredAt.slice(0, 10);
  const file = path.join(p.dailyDir, `${date}.json`);
  const pack = readJson(file, {
    date,
    totalEvents: 0,
    uniqueFingerprints: 0,
    repeatedEvents: 0,
    fixedEvents: 0,
    topProblems: [],
  });

  pack.totalEvents += 1;
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
  pack.uniqueFingerprints = pack.topProblems.length;
  pack.topProblems.sort((a, b) => b.count - a.count);
  writeJson(file, pack);
  return pack;
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

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function messageFromCaptureArgs(args) {
  if (args.message) return String(args.message);
  if (args.log) return fs.readFileSync(String(args.log), 'utf8');
  return readStdin();
}

function apiBase() {
  const origin = (process.env.AICOEVO_API_BASE || process.env.AICOEVO_BASE_URL || process.env.AICOEVO_WEB_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
  return origin.endsWith('/api/v1') ? origin : `${origin}/api/v1`;
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
  return {
    status: response.status,
    data: text ? JSON.parse(text) : {},
  };
}

function authHeaders(config) {
  return config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {};
}

async function syncEvents(deps = {}) {
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
      appendJsonl(p.ledger, {
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
    appendJsonl(p.ledger, {
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
  if (normalized.steps.length) {
    lines.push('## 建议步骤', '');
    normalized.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.title}`);
      if (step.detail) lines.push(`   ${step.detail}`);
      if (step.command) lines.push(`   命令: \`${step.command}\``);
    });
    lines.push('');
  }
  if (normalized.links.length) {
    lines.push('## 参考链接', '');
    for (const link of normalized.links) lines.push(`- [${link.title}](${link.url})`);
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
    `  winaicheck agent uninstall-hook --target claude-code|openclaw|all\n` +
    `  winaicheck agent capture --agent <name> --message <text>\n` +
    `  winaicheck agent capture --agent <name> --log <path>\n` +
    `  winaicheck agent sync\n` +
    `  winaicheck agent uploads --local|--remote\n` +
    `  winaicheck agent pause|resume\n` +
    `  winaicheck agent advice --format json|markdown\n`);
}

function resolveCommand(command) {
  try {
    const exe = process.platform === 'win32' ? 'where.exe' : 'command';
    const args = process.platform === 'win32' ? [command] : ['-v', command];
    const stdout = execFileSync(exe, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || command;
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
  const start = text.indexOf(HOOK_START);
  const end = text.indexOf(HOOK_END);
  if (start === -1 || end === -1 || end < start) return text;
  return `${text.slice(0, start).trimEnd()}\n${text.slice(end + HOOK_END.length).trimStart()}`.trim() + '\n';
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

function installLocalAgent(deps = {}) {
  const p = paths(deps);
  ensureDir(p.agentDir);
  const selfPath = fileURLToPath(import.meta.url);
  fs.copyFileSync(selfPath, p.agentJs);
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

async function runOriginalAgent(args, deps = {}) {
  const original = args.original;
  if (!original) throw new Error('缺少 --original');
  const passthrough = args._ || [];
  const stderrChunks = [];
  const child = spawn(original, passthrough, {
    stdio: ['inherit', 'inherit', 'pipe'],
    shell: process.platform === 'win32' && (!/[\\/]/.test(original) || /\.(cmd|bat)$/i.test(original)),
    windowsHide: false,
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
  if (exitCode !== 0 || stderrText.trim()) {
    const event = storeEvent(createEvent({
      agent: args.agent,
      message: stderrText.trim() || `${normalizeAgent(args.agent)} exited with code ${exitCode}`,
      severity: exitCode === 0 ? 'warn' : 'error',
    }, deps), deps);
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
  if (remote.data?.debug_code) {
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

  if (command === 'uninstall-hook') {
    uninstallHook(args, deps);
    out.write('已卸载 WinAICheck Agent Hook。\n');
    return 0;
  }

  if (command === 'run') {
    return runOriginalAgent(args, deps);
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
  readJsonl,
  readJson,
  writeJson,
  updateDaily,
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(`WinAICheck Agent 错误: ${error.message}`);
    process.exitCode = 1;
  });
}
