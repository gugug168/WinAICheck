import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AGENT_LITE_SOURCE, AGENT_LITE_HASH } from './embedded-agent-lite-source';
import { VERSION } from '../constants';

function getBaseDir(): string {
  return join(homedir(), '.aicoevo');
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function readJsonl(file: string): any[] {
  try {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getPaths() {
  const base = getBaseDir();
  return {
    base,
    config: join(base, 'config.json'),
    hooks: join(base, 'hooks.json'),
    outbox: join(base, 'outbox', 'events.jsonl'),
    ledger: join(base, 'uploads', 'ledger.jsonl'),
    adviceJson: join(base, 'advice', 'latest.json'),
    adviceMd: join(base, 'advice', 'latest.md'),
    dailyDir: join(base, 'daily'),
    experience: join(base, 'experience.jsonl'),
    signals: join(base, 'signals.jsonl'),
    loopState: join(base, 'loop-state.json'),
    healthBaseline: join(base, 'health-baseline.json'),
    loopLock: join(base, 'loop.lock'),
    agentDir: join(base, 'agent'),
    agentJs: join(base, 'agent', 'agent-lite.js'),
    agentCmd: join(base, 'agent', 'winaicheck-agent.cmd'),
  };
}

function today(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runAgentCommand(args: string[]): string {
  const paths = getPaths();
  if (existsSync(paths.agentCmd)) {
    const command = [quoteCmdArg(paths.agentCmd), ...args.map(quoteCmdArg)].join(' ');
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 30000,
    });
  }

  const localWrapper = join(process.cwd(), 'bin', 'winaicheck.js');
  if (existsSync(localWrapper)) {
    return execFileSync(process.execPath, [localWrapper, 'agent', ...args], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 30000,
    });
  }

  return execFileSync('npx', ['winaicheck', 'agent', ...args], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 60000,
  });
}

function installEmbeddedLocalAgent() {
  const paths = getPaths();
  mkdirSync(paths.agentDir, { recursive: true });
  writeFileSync(paths.agentJs, AGENT_LITE_SOURCE, 'utf-8');
  if (AGENT_LITE_HASH) {
    writeFileSync(
      join(paths.agentDir, 'agent-lite.hash.json'),
      JSON.stringify({ sha256: AGENT_LITE_HASH, source: 'embedded', installedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf-8',
    );
  }
  writeFileSync(
    paths.agentCmd,
    ['@echo off', 'setlocal', 'node "%~dp0agent-lite.js" %*', 'exit /b %ERRORLEVEL%', ''].join('\r\n'),
    'utf-8',
  );

  // Write WinAICheck version to version-cache.json so check-update knows local version
  const cacheFile = join(paths.base, 'version-cache.json');
  const cache = readJson<Record<string, any>>(cacheFile, {});
  cache.winaicheckVersion = VERSION;
  mkdirSync(paths.base, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + '\n', 'utf-8');

  return {
    agentDir: paths.agentDir,
    agentJs: paths.agentJs,
    agentCmd: paths.agentCmd,
  };
}

export function getAgentLocalStatus() {
  const paths = getPaths();
  const config = readJson<Record<string, any>>(paths.config, {});
  const hooks = readJson<Record<string, any>>(paths.hooks, {});
  const events = readJsonl(paths.outbox);
  const ledger = readJsonl(paths.ledger);
  const todayPack = readJson(join(paths.dailyDir, `${today()}.json`), {
    date: today(),
    totalEvents: 0,
    uniqueFingerprints: 0,
    repeatedEvents: 0,
    fixedEvents: 0,
    consecutiveFailures: 0,
    lastFailureFingerprint: null,
    lastEventAt: null,
    topProblems: [],
  });
  const advice = readJson<Record<string, any>>(paths.adviceJson, {});
  const experience = readJsonl(paths.experience);
  const signals = readJsonl(paths.signals);
  const loop = readJson<Record<string, any>>(paths.loopState, {
    enabled: false,
    status: 'stopped',
    strategy: 'balanced',
    mode: 'cold',
    sleepMs: 0,
    nextRunAt: null,
  });
  const healthBaseline = readJson<Record<string, any> | null>(paths.healthBaseline, null);
  const now = Date.now();
  const claudeSeenAt = hooks?.lastSeen?.['claude-code']?.lastHookSeenAt || null;
  const openclawSeenAt = hooks?.lastSeen?.openclaw?.lastHookSeenAt || null;
  const coverage = {
    claudeCode: {
      lastHookSeenAt: claudeSeenAt,
      hookType: hooks?.lastSeen?.['claude-code']?.hookType || null,
      status: claudeSeenAt && now - new Date(claudeSeenAt).getTime() <= 24 * 60 * 60 * 1000 ? 'healthy' : claudeSeenAt ? 'degraded' : 'missing',
    },
    openclaw: {
      lastHookSeenAt: openclawSeenAt,
      hookType: hooks?.lastSeen?.openclaw?.hookType || null,
      status: openclawSeenAt && now - new Date(openclawSeenAt).getTime() <= 24 * 60 * 60 * 1000 ? 'healthy' : openclawSeenAt ? 'degraded' : 'missing',
    },
  };

  return {
    enabled: existsSync(paths.agentCmd) && (
      hooks.hookType === 'settings' ||
      (Array.isArray(hooks.agents) && hooks.agents.length > 0)
    ),
    localRunnerInstalled: existsSync(paths.agentCmd),
    paused: !!config.paused,
    shareData: !!config.shareData,
    autoSync: !!config.autoSync,
    email: config.email || null,
    agentCmd: paths.agentCmd,
    hookType: hooks.hookType || (Array.isArray(hooks.agents) && hooks.agents.length > 0 ? 'powershell' : 'none'),
    hooks,
    totals: {
      events: events.length,
      pending: events.filter(event => event.syncStatus !== 'synced').length,
      synced: events.filter(event => event.syncStatus === 'synced').length,
      uploads: ledger.length,
    },
    strategy: config.strategy || 'balanced',
    coverage,
    loop: {
      enabled: !!loop.enabled,
      status: loop.status || 'stopped',
      strategy: loop.strategy || config.strategy || 'balanced',
      mode: loop.mode || 'cold',
      sleepMs: loop.sleepMs || 0,
      nextRunAt: loop.nextRunAt || null,
      lastRunAt: loop.lastRunAt || null,
      lastCompletedAt: loop.lastCompletedAt || null,
      lastError: loop.lastError || null,
      pid: loop.pid || null,
      lockPresent: existsSync(paths.loopLock),
    },
    health: {
      baseline: healthBaseline,
      lastSnapshot: loop?.health?.lastSnapshot || null,
      lastSnapshotAt: loop?.health?.lastSnapshotAt || null,
      lastDrifts: Array.isArray(loop?.health?.lastDrifts) ? loop.health.lastDrifts : [],
    },
    today: todayPack,
    latestEvents: events.slice(-20).reverse(),
    latestUploads: ledger.slice(-20).reverse(),
    latestExperience: experience.slice(-20).reverse(),
    latestSignals: signals.slice(-20).reverse(),
    advice,
  };
}

export function enableAgentExperience(target = 'all') {
  const localAgent = installEmbeddedLocalAgent();
  let hookOutput = '';
  let hookOk = false;
  try {
    hookOutput = runAgentCommand(['enable', '--target', target]);
    hookOk = true;
  } catch {
    hookOk = false;
  }
  return {
    ok: hookOk,
    localAgent,
    hook: hookOutput,
    status: getAgentLocalStatus(),
  };
}

export function pauseAgentUploads(paused: boolean) {
  const output = runAgentCommand([paused ? 'pause' : 'resume']);
  return {
    ok: true,
    output,
    status: getAgentLocalStatus(),
  };
}

export function syncAgentEvents() {
  try {
    const output = runAgentCommand(['sync']);
    const parsed = JSON.parse(output);
    return {
      ok: parsed.ok !== false && !parsed.error,
      output,
      status: getAgentLocalStatus(),
    };
  } catch {
    return {
      ok: false,
      output: '',
      status: getAgentLocalStatus(),
    };
  }
}

export function startAgentLoop() {
  try {
    const output = runAgentCommand(['loop', 'start']);
    const parsed = JSON.parse(output);
    return {
      ok: parsed.ok !== false,
      output,
      status: getAgentLocalStatus(),
    };
  } catch (error: any) {
    return {
      ok: false,
      output: error?.message || '',
      status: getAgentLocalStatus(),
    };
  }
}

export function stopAgentLoop() {
  try {
    const output = runAgentCommand(['loop', 'stop']);
    const parsed = JSON.parse(output);
    return {
      ok: parsed.ok !== false,
      output,
      status: getAgentLocalStatus(),
    };
  } catch (error: any) {
    return {
      ok: false,
      output: error?.message || '',
      status: getAgentLocalStatus(),
    };
  }
}

export function runAgentLoopOnce() {
  try {
    const output = runAgentCommand(['loop', 'run-once']);
    const parsed = JSON.parse(output);
    return {
      ok: parsed.ok !== false,
      output,
      status: getAgentLocalStatus(),
    };
  } catch (error: any) {
    return {
      ok: false,
      output: error?.message || '',
      status: getAgentLocalStatus(),
    };
  }
}

export function setAgentStrategy(strategy: string) {
  try {
    const output = runAgentCommand(['strategy', 'set', strategy]);
    const parsed = JSON.parse(output);
    return {
      ok: parsed.ok !== false,
      output,
      status: getAgentLocalStatus(),
    };
  } catch (error: any) {
    return {
      ok: false,
      output: error?.message || '',
      status: getAgentLocalStatus(),
    };
  }
}
