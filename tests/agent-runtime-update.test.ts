import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as agentMain, _testHelpers } from '../bin/agent-lite.js';

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'winaicheck-update-'));
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

function parseLastJson(output: string) {
  return JSON.parse(output.trim());
}

describe('agent runtime update', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('auto-update status 默认是 notify', async () => {
    const root = createTempRoot();
    roots.push(root);
    const io = createIo();

    const code = await agentMain(['auto-update', 'status'], { baseDir: root }, io.io as any);

    expect(code).toBe(0);
    expect(parseLastJson(io.output)).toEqual({ ok: true, mode: 'notify' });
  });

  test('auto-update 模式可以切换并持久化', async () => {
    const root = createTempRoot();
    roots.push(root);

    await agentMain(['auto-update', 'on'], { baseDir: root }, createIo().io as any);
    await agentMain(['auto-update', 'off'], { baseDir: root }, createIo().io as any);
    const statusIo = createIo();
    await agentMain(['auto-update', 'status'], { baseDir: root }, statusIo.io as any);

    expect(parseLastJson(statusIo.output)).toEqual({ ok: true, mode: 'off' });
    const cache = _testHelpers.readJson(join(root, 'version-cache.json'), null);
    expect(cache.winaicheckUpdateMode).toBe('off');
  });

  test('check-update 在 notify 模式下返回运行时提醒', async () => {
    const root = createTempRoot();
    roots.push(root);
    const io = createIo();

    const code = await agentMain(['check-update', '--target', 'claude-code'], {
      baseDir: root,
      currentVersion: '0.3.13',
      fetchImpl: async () => ({
        text: async () => '0.3.99',
      }),
    }, io.io as any);

    expect(code).toBe(0);
    expect(parseLastJson(io.output)).toMatchObject({
      hasUpdate: true,
      current: '0.3.13',
      latest: '0.3.99',
      mode: 'notify',
      target: 'claude-code',
    });
    expect(parseLastJson(io.output).runtimeMessage).toContain('开启自动更新');
  });

  test('check-update 在 auto 模式下会调用 self-update', async () => {
    const root = createTempRoot();
    roots.push(root);
    let command = '';
    let args: string[] = [];

    await agentMain(['auto-update', 'on'], { baseDir: root, currentVersion: '0.3.13' }, createIo().io as any);
    const io = createIo();
    const code = await agentMain(['check-update', '--target', 'openclaw'], {
      baseDir: root,
      currentVersion: '0.3.13',
      fetchImpl: async () => ({
        text: async () => '0.3.99',
      }),
      execFileSyncImpl: (cmd: string, cmdArgs: string[]) => {
        command = cmd;
        args = cmdArgs;
        return '';
      },
    }, io.io as any);

    expect(code).toBe(0);
    expect(command).toContain('npx');
    expect(args).toEqual(['--yes', 'winaicheck@latest', 'agent', 'self-update', '--target', 'openclaw']);
    expect(parseLastJson(io.output)).toMatchObject({
      hasUpdate: false,
      autoUpdated: true,
      updatedFrom: '0.3.13',
      current: '0.3.99',
      latest: '0.3.99',
      mode: 'auto',
      target: 'openclaw',
    });
    const cache = _testHelpers.readJson(join(root, 'version-cache.json'), null);
    expect(cache.winaicheckVersion).toBe('0.3.99');
    expect(cache.winaicheckHasUpdate).toBe(false);
  });

  test('installLocalAgent 写出的 Claude hooks 会执行可见更新检查', () => {
    const root = createTempRoot();
    roots.push(root);

    _testHelpers.installLocalAgent({ baseDir: root, currentVersion: '0.3.13' });
    const hookPaths = _testHelpers.paths({ baseDir: root });
    const sessionStart = readFileSync(hookPaths.sessionStartHookJs, 'utf8');
    const postTool = readFileSync(hookPaths.postToolHookJs, 'utf8');

    expect(sessionStart).toContain("'check-update', '--target', 'claude-code'");
    expect(sessionStart).not.toContain('detached: true');
    expect(postTool).toContain('update.runtimeMessage');
  });

  test('openclaw wrapper 在成功运行后也会输出更新提醒', async () => {
    const root = createTempRoot();
    roots.push(root);
    _testHelpers.installLocalAgent({ baseDir: root, currentVersion: '0.3.13' });

    let stderr = '';
    const stderrStream = { write: (text: string | Buffer) => { stderr += String(text); return true; } };
    const stdoutStream = { write: () => true };

    const code = await agentMain(['run', '--agent', 'openclaw', '--original', 'openclaw', '--'], {
      baseDir: root,
      currentVersion: '0.3.13',
      fetchImpl: async () => ({
        text: async () => '0.3.99',
      }),
      processStdout: stdoutStream,
      processStderr: stderrStream,
      spawnImpl: () => {
        const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => child.emit('close', 0));
        return child;
      },
    });

    expect(code).toBe(0);
    expect(stderr).toContain('[WinAICheck] 发现新版本 v0.3.13 → v0.3.99');
  });
});
