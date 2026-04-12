import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AGENT_LITE_SOURCE } from './embedded-agent-lite-source';

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
    agentDir: join(base, 'agent'),
    agentJs: join(base, 'agent', 'agent-lite.js'),
    agentCmd: join(base, 'agent', 'winaicheck-agent.cmd'),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
  writeFileSync(
    paths.agentCmd,
    ['@echo off', 'setlocal', 'node "%~dp0agent-lite.js" %*', 'exit /b %ERRORLEVEL%', ''].join('\r\n'),
    'utf-8',
  );
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
    topProblems: [],
  });
  const advice = readJson<Record<string, any>>(paths.adviceJson, {});

  return {
    enabled: existsSync(paths.agentCmd) && Array.isArray(hooks.agents) && hooks.agents.length > 0,
    localRunnerInstalled: existsSync(paths.agentCmd),
    paused: !!config.paused,
    shareData: !!config.shareData,
    autoSync: !!config.autoSync,
    email: config.email || null,
    agentCmd: paths.agentCmd,
    hooks,
    totals: {
      events: events.length,
      pending: events.filter(event => event.syncStatus !== 'synced').length,
      synced: events.filter(event => event.syncStatus === 'synced').length,
      uploads: ledger.length,
    },
    today: todayPack,
    latestEvents: events.slice(-20).reverse(),
    latestUploads: ledger.slice(-20).reverse(),
    advice,
  };
}

export function enableAgentExperience(target = 'all') {
  const localAgent = installEmbeddedLocalAgent();
  const hook = runAgentCommand(['install-hook', '--target', target]);
  return {
    ok: true,
    localAgent,
    hook,
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
  const output = runAgentCommand(['sync']);
  return {
    ok: true,
    output,
    status: getAgentLocalStatus(),
  };
}
