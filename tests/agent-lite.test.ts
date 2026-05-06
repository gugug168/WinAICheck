import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { main as agentMain, _testHelpers, sanitizeText } from '../bin/agent-lite.js';
import { reportAgentToolEvent } from '../src/agent/local-state';

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'winaicheck-agent-'));
}

function createIo() {
  let output = '';
  return {
    io: {
      stdout: { write: (text: string) => { output += text; return true; } },
      stderr: { write: (text: string) => { output += text; return true; } },
    },
    get output() {
      return output;
    },
  };
}

describe('agent-lite', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('capture 写入脱敏 outbox 和每日问题包', async () => {
    const root = createTempRoot();
    roots.push(root);
    const io = createIo();

    await agentMain([
      'capture',
      '--agent', 'claude-code',
      '--message', 'Error with sk-abc123def456ghi789jkl012mno345 at C:\\Users\\Alice\\repo',
    ], {
      baseDir: root,
      now: () => new Date('2026-04-12T08:00:00.000Z'),
    }, io.io as any);

    const p = _testHelpers.paths({ baseDir: root });
    const events = _testHelpers.readJsonl(p.outbox);
    expect(events.length).toBe(1);
    expect(events[0].agent).toBe('claude-code');
    expect(events[0].sanitizedMessage).toContain('<API_KEY>');
    expect(events[0].sanitizedMessage).toContain('C:\\Users\\<USER>\\repo');

    const daily = _testHelpers.readJson(join(p.dailyDir, '2026-04-12.json'), null);
    expect(daily.totalEvents).toBe(1);
    expect(daily.uniqueFingerprints).toBe(1);
  });

  test('capture 命中本地经验库并记录建议', async () => {
    const root = createTempRoot();
    roots.push(root);

    await agentMain([
      'capture',
      '--agent', 'claude-code',
      '--message', 'ModuleNotFoundError: No module named alembic',
    ], {
      baseDir: root,
      now: () => new Date('2026-04-12T08:30:00.000Z'),
    }, createIo().io as any);

    const p = _testHelpers.paths({ baseDir: root });
    const experience = _testHelpers.readJsonl(p.experience);
    expect(experience.length).toBe(1);
    expect(experience[0].title).toBe('Python 模块缺失');
    expect(experience[0].commands[0]).toContain('pip install');
  });

  test('经验库识别 Claude unknown option 参数错误', () => {
    const experience = _testHelpers.lookupExperience("error: unknown option '--bad-flag'");

    expect(experience?.title).toBe('命令参数错误');
  });

  test('重复 fingerprint 会计入 repeatedEvents', async () => {
    const root = createTempRoot();
    roots.push(root);

    for (let i = 0; i < 2; i++) {
      await agentMain([
        'capture',
        '--agent', 'openclaw',
        '--message', 'TypeError: Cannot read properties of undefined',
      ], {
        baseDir: root,
        now: () => new Date('2026-04-12T09:00:00.000Z'),
      }, createIo().io as any);
    }

    const p = _testHelpers.paths({ baseDir: root });
    const daily = _testHelpers.readJson(join(p.dailyDir, '2026-04-12.json'), null);
    expect(daily.totalEvents).toBe(2);
    expect(daily.uniqueFingerprints).toBe(1);
    expect(daily.repeatedEvents).toBe(1);
    expect(daily.consecutiveFailures).toBe(2);
    expect(daily.topProblems[0].status).toBe('repeated');
  });

  test('diagnose 会展示 failure loop 和 Top 问题', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });

    _testHelpers.writeJson(join(p.dailyDir, '2026-04-12.json'), {
      date: '2026-04-12',
      totalEvents: 5,
      uniqueFingerprints: 1,
      repeatedEvents: 4,
      fixedEvents: 0,
      consecutiveFailures: 5,
      lastFailureFingerprint: 'abc',
      lastEventAt: new Date().toISOString(),
      topProblems: [{ fingerprint: 'abc', title: 'MCP server error: config failed', count: 5, status: 'looping' }],
    });

    const io = createIo();
    await agentMain(['diagnose'], {
      baseDir: root,
      now: () => new Date('2026-04-12T10:00:00.000Z'),
    }, io.io as any);
    expect(io.output).toContain('Failure Loop');
    expect(io.output).toContain('MCP server error');
  });

  test('sync 授权后上传 pending 事件并写 ledger 和 advice', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: true,
      autoSync: true,
      paused: false,
      authToken: 'token-test',
    });

    await agentMain([
      'capture',
      '--agent', 'claude-code',
      '--message', 'MCP config JSON parse error',
    ], {
      baseDir: root,
      now: () => new Date('2026-04-12T10:00:00.000Z'),
      fetchImpl: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.events.length).toBe(1);
        return {
          status: 200,
          text: async () => JSON.stringify({
            advice: {
              summary: '修复 MCP 配置 JSON。',
              confidence: 0.9,
              steps: [{ title: '检查 mcp_settings.json', detail: '删除尾随逗号。', risk: 'low', requiresUserApproval: false }],
              links: [{ title: '社区方案', url: 'https://aicoevo.net/solutions/mcp-json' }],
            },
          }),
        };
      },
    }, createIo().io as any);

    const events = _testHelpers.readJsonl(p.outbox);
    const ledger = _testHelpers.readJsonl(p.ledger);
    expect(events[0].syncStatus).toBe('synced');
    expect(ledger[0].status).toBe('synced');
    expect(readFileSync(p.adviceMd, 'utf-8')).toContain('修复 MCP 配置 JSON');
  });

  test('apiKeyHeaders 只接受 Agent API Key', () => {
    expect(_testHelpers.apiKeyHeaders({ authToken: 'ak_test_123' })).toEqual({
      'X-API-Key': 'ak_test_123',
    });
    expect(_testHelpers.apiKeyHeaders({ authToken: 'jwt-token' })).toBeNull();
    expect(_testHelpers.apiKeyHeaders({})).toBeNull();
  });

  test('bind request 失败会自动上报 repair_loop tool event', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: false,
      autoSync: false,
      paused: false,
    });
    const io = createIo();
    const calls: Array<{ url: string; body: any }> = [];

    const code = await agentMain(['bind'], {
      baseDir: root,
      now: () => new Date('2026-04-12T12:10:00.000Z'),
      currentVersion: '0.3.18',
      openBrowser: () => {},
      fetchImpl: async (url: string, init: RequestInit) => {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        if (url.includes('/api/v1/bind/request?') && url.includes('device_id=device-test')) {
          return {
            status: 500,
            text: async () => JSON.stringify({ detail: 'bind service down' }),
          } as any;
        }
        if (url.endsWith('/api/v1/feedback')) {
          expect(body.category).toBe('repair_loop');
          expect(body.content).toContain('bind request failed');
          expect(body.env_summary.product).toBe('win-aicheck');
          expect(body.env_summary.source).toBe('tool_auto_report');
          expect(body.env_summary.step).toBe('bind');
          expect(body.env_summary.status).toBe('error');
          expect(body.env_summary.event_type).toBe('step_failed');
          expect(body.env_summary.failed_items).toEqual(['bind-request']);
          expect(body.env_summary.failure_signature).toBe('win-aicheck:bind:bind-request:500');
          expect(body.env_summary.tool_version).toBe('0.3.18');
          expect(body.env_summary.device_id).toBe('device-test');
          return {
            status: 200,
            text: async () => JSON.stringify({ status: 'received' }),
          } as any;
        }
        throw new Error(`unexpected url: ${url}`);
      },
    }, io.io as any);

    expect(code).toBe(1);
    expect(io.output).toContain('绑定请求失败 (500)');
    expect(calls.some(call => call.url.endsWith('/api/v1/feedback'))).toBe(true);
  });

  test('syncEvents 失败会自动上报 repair_loop tool event', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: true,
      autoSync: true,
      paused: false,
      authToken: 'ak_test_123',
    });
    _testHelpers.writeJsonl(p.outbox, [
      _testHelpers.createEvent({
        agent: 'claude-code',
        message: 'MCP server timeout',
      }, {
        baseDir: root,
        now: () => new Date('2026-04-12T12:20:00.000Z'),
      }),
    ]);

    const calls: Array<{ url: string; body: any }> = [];
    const result = await _testHelpers.syncEvents({
      baseDir: root,
      currentVersion: '0.3.18',
      now: () => new Date('2026-04-12T12:20:00.000Z'),
      fetchImpl: async (url: string, init: RequestInit) => {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        if (url.endsWith('/api/v1/agent-events/batch')) {
          return {
            status: 503,
            text: async () => JSON.stringify({ detail: 'service unavailable' }),
          } as any;
        }
        if (url.endsWith('/api/v1/feedback')) {
          expect(body.env_summary.step).toBe('sync');
          expect(body.env_summary.event_type).toBe('step_failed');
          expect(body.env_summary.failed_items).toEqual(['agent-events-batch']);
          expect(body.env_summary.failure_signature).toBe('win-aicheck:sync:agent-events-batch:503');
          expect(body.env_summary.message).toContain('service unavailable');
          return {
            status: 200,
            text: async () => JSON.stringify({ status: 'received' }),
          } as any;
        }
        throw new Error(`unexpected url: ${url}`);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(calls.some(call => call.url.endsWith('/api/v1/feedback'))).toBe(true);
  });

  test('executeOwnerRepair 失败会自动上报 repair_loop tool event', async () => {
    const root = createTempRoot();
    roots.push(root);
    const calls: Array<{ url: string; body: any }> = [];

    const result = await _testHelpers.executeOwnerRepair({
      scannerId: 'powershell-policy',
      suggestedProjectDir: 'C:\\repo',
    }, {
      baseDir: root,
      currentVersion: '0.3.18',
      now: () => new Date('2026-04-12T12:30:00.000Z'),
      execImpl: (command: string) => {
        if (command.includes('Get-ExecutionPolicy')) {
          return { exitCode: 0, stdout: 'Restricted', stderr: '' };
        }
        if (command.includes('Set-ExecutionPolicy RemoteSigned')) {
          return { exitCode: 1, stdout: '', stderr: 'Access is denied' };
        }
        if (command.includes('Set-ExecutionPolicy Restricted')) {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      fetchImpl: async (url: string, init: RequestInit) => {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        if (url.endsWith('/api/v1/feedback')) {
          expect(body.env_summary.step).toBe('repair_execute');
          expect(body.env_summary.status).toBe('error');
          expect(body.env_summary.event_type).toBe('repair_failed');
          expect(body.env_summary.failed_items).toEqual(['powershell-policy']);
          expect(body.env_summary.failure_signature).toBe('win-aicheck:repair_execute:powershell-policy:failed');
          expect(body.env_summary.rollback_status).toBe('success');
          expect(body.env_summary.requires_user_confirmation).toBe(false);
          expect(body.content).toContain('owner repair failed');
          return {
            status: 200,
            text: async () => JSON.stringify({ status: 'received' }),
          } as any;
        }
        throw new Error(`unexpected url: ${url}`);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.rollback.result).toBe('success');
    expect(calls.some(call => call.url.endsWith('/api/v1/feedback'))).toBe(true);
  });

  test('bounty-list 在 JWT 授权态下提示先 bind，不发送请求', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: true,
      autoSync: true,
      paused: false,
      authToken: 'jwt-token',
    });

    let called = false;
    const io = createIo();
    const code = await agentMain(['bounty-list'], {
      baseDir: root,
      fetchImpl: async () => {
        called = true;
        throw new Error('should not reach network');
      },
    }, io.io as any);

    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(io.output).toContain('agent bind');
  });

  test('install-hook 和 uninstall-hook 只管理 WinAICheck 代码块', () => {
    const root = createTempRoot();
    roots.push(root);
    const profile = join(root, 'profile.ps1');
    writeFileSync(profile, 'function keep-me { "ok" }\n', 'utf-8');

    _testHelpers.installHook({ target: 'all' }, {
      baseDir: root,
      profilePaths: [profile],
      now: () => new Date('2026-04-12T11:00:00.000Z'),
    });

    const installed = readFileSync(profile, 'utf-8');
    expect(installed).toContain('WinAICheck Agent Hook');
    expect(installed).toContain('.aicoevo\\agent\\winaicheck-agent.cmd');
    expect(installed).toContain('npx winaicheck agent run');
    expect(installed).toContain('function claude');
    expect(installed).toContain('function openclaw');
    expect(installed).toContain('function keep-me');

    _testHelpers.uninstallHook({ target: 'all' }, { baseDir: root, profilePaths: [profile] });
    const uninstalled = readFileSync(profile, 'utf-8');
    expect(uninstalled).not.toContain('WinAICheck Agent Hook');
    expect(uninstalled).toContain('function keep-me');
  });

  test('install-local-agent 写入本地 runner 文件', () => {
    const root = createTempRoot();
    roots.push(root);

    const result = _testHelpers.installLocalAgent({ baseDir: root });

    expect(existsSync(result.agentJs)).toBe(true);
    expect(existsSync(result.agentCmd)).toBe(true);
    expect(readFileSync(result.agentCmd, 'utf-8')).toContain('agent-lite.js');
  });

  test('local-state 嵌入安装器会把 VERSION 写到 base dir 供 tool auto report 读取', () => {
    const root = createTempRoot();
    roots.push(root);
    const prevBaseDir = process.env.WINAICHECK_AGENT_BASE_DIR;
    process.env.WINAICHECK_AGENT_BASE_DIR = root;
    reportAgentToolEvent({
      step: 'launch',
      failedItems: ['version-test'],
      message: 'version test',
      content: 'version test',
    });
    if (prevBaseDir === undefined) delete process.env.WINAICHECK_AGENT_BASE_DIR;
    else process.env.WINAICHECK_AGENT_BASE_DIR = prevBaseDir;
    expect(readFileSync(join(root, 'VERSION'), 'utf-8').trim()).toBe('0.3.18');
  });

  test('resolveCommand 在 Windows 优先选择 .cmd shim', () => {
    const resolved = _testHelpers.selectResolvedCommand([
      'C:\\nvm4w\\nodejs\\claude',
      'C:\\nvm4w\\nodejs\\claude.cmd',
    ], 'claude', 'win32');

    expect(resolved).toBe('C:\\nvm4w\\nodejs\\claude.cmd');
  });

  test('enable claude-code 会安装 settings hook 并启用自动同步配置', async () => {
    const root = createTempRoot();
    roots.push(root);
    const home = join(root, 'home');
    const profile = join(root, 'profile.ps1');

    _testHelpers.installHook({ target: 'claude-code' }, { baseDir: root, profilePaths: [profile] });

    await agentMain(['enable', '--target', 'claude-code'], {
      baseDir: root,
      homeDir: home,
      profilePaths: [profile],
      now: () => new Date('2026-04-12T11:30:00.000Z'),
    }, createIo().io as any);

    const p = _testHelpers.paths({ baseDir: root });
    const config = _testHelpers.readJson(p.config, {});
    expect(config.shareData).toBe(true);
    expect(config.autoSync).toBe(true);
    expect(config.paused).toBe(false);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')).toContain('winaicheck-post-tool.cjs');
    expect(readFileSync(profile, 'utf-8')).not.toContain('function claude');
    expect(readFileSync(profile, 'utf-8')).not.toContain('WinAICheck Agent Hook');
  });

  test('run 会捕获 stdout 中的 Error 块', async () => {
    const root = createTempRoot();
    roots.push(root);
    const script = join(root, 'fake-agent.cmd');
    writeFileSync(script, '@echo off\r\necho normal output\r\necho Error: Exit code 1 from tool\r\nexit /b 0\r\n', 'utf-8');

    const code = await agentMain([
      'run',
      '--agent', 'openclaw',
      '--original', script,
    ], {
      baseDir: root,
      now: () => new Date('2026-04-12T11:45:00.000Z'),
      fetchImpl: async () => ({
        text: async () => '0.0.0',
      } as any),
    }, createIo().io as any);

    expect(code).toBe(0);
    const p = _testHelpers.paths({ baseDir: root });
    const events = _testHelpers.readJsonl(p.outbox);
    expect(events.length).toBe(1);
    expect(events[0].sanitizedMessage).toContain('Error: Exit code 1');
    expect(events[0].severity).toBe('warn');
  });

  test('npm agent 子命令不下载 exe，直接走轻量入口', () => {
    const root = createTempRoot();
    roots.push(root);
    const env = { ...process.env, USERPROFILE: root, HOME: root };
    const output = execFileSync(process.execPath, [
      join(process.cwd(), 'bin', 'winaicheck.js'),
      'agent',
      'capture',
      '--agent',
      'openclaw',
      '--message',
      'build failed at C:\\Users\\Bob\\project',
    ], { encoding: 'utf-8', env });

    expect(output).toContain('"ok": true');
    expect(output).not.toContain('获取最新版本');
    expect(existsSync(join(root, '.aicoevo', 'outbox', 'events.jsonl'))).toBe(true);
  });

  test('agent-lite 在 Node 下可以通过语法检查', () => {
    execFileSync('node', [
      '--check',
      join(process.cwd(), 'bin', 'agent-lite.js'),
    ], { stdio: 'pipe' });
  });

  test('sanitizeText 覆盖常见 Agent 密钥环境变量', () => {
    const output = sanitizeText('OPENAI_API_KEY=sk-abc123def456ghi789jkl012mno345 and admin@example.com');
    expect(output).toContain('<SECRET_ENV>');
    expect(output).toContain('<EMAIL>');
  });

  test('auth start 显示本地调试验证码，auth verify 兼容 access_token', async () => {
    const root = createTempRoot();
    roots.push(root);

    const startIo = createIo();
    await agentMain(['auth', 'start', '--email', 'dev@example.com'], {
      baseDir: root,
      fetchImpl: async () => ({
        status: 200,
        text: async () => JSON.stringify({ status: 'generated', debug_code: '123456' }),
      }),
    }, startIo.io as any);
    expect(startIo.output).toContain('本地调试验证码: 123456');

    await agentMain(['auth', 'verify', '--email', 'dev@example.com', '--code', '123456'], {
      baseDir: root,
      now: () => new Date('2026-04-12T12:00:00.000Z'),
      fetchImpl: async () => ({
        status: 200,
        text: async () => JSON.stringify({ access_token: 'access-token-test' }),
      }),
    }, createIo().io as any);

    const config = _testHelpers.readJson(_testHelpers.paths({ baseDir: root }).config, {});
    expect(config.authToken).toBe('access-token-test');
    expect(config.shareData).toBe(true);
  });
});
