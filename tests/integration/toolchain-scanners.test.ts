import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, type MockResponse } from './mock-helper';

import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

describe('git scanner', () => {
  afterEach(teardownMock);

  test('未安装 → fail', async () => {
    setupMock(new Map([['git --version', { exitCode: 1 }]]));
    const scanner = getScannerById('git')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('未安装');
  });

  test('版本过旧 (<2.30) → warn', async () => {
    setupMock(new Map([['git --version', { stdout: 'git version 2.20.0', exitCode: 0 }]]));
    const scanner = getScannerById('git')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('过旧');
  });

  test('正常版本 → pass', async () => {
    setupMock(new Map([['git --version', { stdout: 'git version 2.45.0', exitCode: 0 }]]));
    const scanner = getScannerById('git')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('2.45.0');
  });
});

describe('node-version scanner', () => {
  afterEach(teardownMock);

  test('未安装 → fail', async () => {
    setupMock(new Map([['node --version', { exitCode: 1 }]]));
    const scanner = getScannerById('node-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
  });

  test('版本过旧 (v12) → warn', async () => {
    setupMock(new Map([['node --version', { stdout: 'v12.22.0', exitCode: 0 }]]));
    const scanner = getScannerById('node-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('过旧');
  });

  test('正常版本 → pass', async () => {
    setupMock(new Map([['node --version', { stdout: 'v22.0.0', exitCode: 0 }]]));
    const scanner = getScannerById('node-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });
});

describe('python-versions scanner', () => {
  afterEach(teardownMock);

  test('未安装 → fail', async () => {
    setupMock(new Map([
      ['python --version', { exitCode: 1 }],
      ['python3 --version', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('python-versions')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('未安装');
  });

  test('多版本并存 → warn', async () => {
    setupMock(new Map([
      ['python --version', { stdout: 'Python 3.7.9', exitCode: 0 }],
      ['python3 --version', { stdout: 'Python 3.11.5', exitCode: 0 }],
      ['where.exe python', { stdout: 'C:\\Python37\\python.exe', exitCode: 0 }],
      ['where.exe python3', { stdout: 'C:\\Python311\\python3.exe', exitCode: 0 }],
    ]));
    const scanner = getScannerById('python-versions')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('多个');
  });

  test('单版本正常 → pass', async () => {
    setupMock(new Map([
      ['python --version', { stdout: 'Python 3.11.5', exitCode: 0 }],
      ['python3 --version', { exitCode: 1 }],
      ['py -V', { exitCode: 1 }],
      ['where.exe python', { stdout: 'C:\\Python311\\python.exe', exitCode: 0 }],
    ]));
    const scanner = getScannerById('python-versions')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('仅 py 启动器可用 → pass', async () => {
    setupMock(new Map([
      ['python --version', { exitCode: 1 }],
      ['python3 --version', { exitCode: 1 }],
      ['py -V', { stdout: 'Python 3.11.5', exitCode: 0 }],
      ['where.exe py', { stdout: 'C:\\Windows\\py.exe', exitCode: 0 }],
      ['py -0p', { stdout: ' -V:3.11 * C:\\Python311\\python.exe', exitCode: 0 }],
    ]));
    const scanner = getScannerById('python-versions')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('3.11.5');
  });
});

describe('cpp-compiler scanner', () => {
  afterEach(teardownMock);

  test('有 cl.exe → pass', async () => {
    setupMock(new Map([
      ['cl.exe 2>&1', { stdout: 'Microsoft (R) C/C++ Optimizing Compiler Version 19.35.32215', exitCode: 0 }],
    ]));
    const scanner = getScannerById('cpp-compiler')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('MSVC');
  });

  test('有 GCC → pass', async () => {
    setupMock(new Map([
      ['cl.exe 2>&1', { stderr: "cl.exe is not recognized", exitCode: 1 }],
      ['gcc --version', { stdout: 'gcc (GCC) 13.2.0', exitCode: 0 }],
    ]));
    const scanner = getScannerById('cpp-compiler')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('GCC');
  });

  test('无编译器 → fail', async () => {
    setupMock(new Map([
      ['cl.exe 2>&1', { exitCode: 1 }],
      ['gcc --version', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('cpp-compiler')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
  });
});

describe('package-managers scanner', () => {
  afterEach(teardownMock);

  test('全部安装 → pass', async () => {
    setupMock(new Map([
      ['pip --version', { stdout: 'pip 24.0', exitCode: 0 }],
      ['npm --version', { stdout: '10.5.0', exitCode: 0 }],
      ['bun --version', { stdout: '1.1.0', exitCode: 0 }],
      ['pnpm --version', { stdout: '9.0.0', exitCode: 0 }],
      ['yarn --version', { stdout: '4.1.0', exitCode: 0 }],
    ]));
    const scanner = getScannerById('package-managers')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('部分安装 → warn（缺少核心包管理器）', async () => {
    setupMock(new Map([
      ['pip --version', { stdout: 'pip 24.0', exitCode: 0 }],
      ['npm --version', { exitCode: 1 }],
      ['bun --version', { exitCode: 1 }],
      ['pnpm --version', { exitCode: 1 }],
      ['yarn --version', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('package-managers')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('缺少 npm');
  });

  test('全部未安装 → fail', async () => {
    setupMock(new Map([
      ['pip --version', { exitCode: 1 }],
      ['npm --version', { exitCode: 1 }],
      ['bun --version', { exitCode: 1 }],
      ['pnpm --version', { exitCode: 1 }],
      ['yarn --version', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('package-managers')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
  });
});

describe('unix-commands scanner', () => {
  afterEach(teardownMock);

  test('全部可用 → pass', async () => {
    setupMock(new Map([
      ['where.exe ls', { stdout: 'C:\\Git\\usr\\bin\\ls.exe', exitCode: 0 }],
      ['where.exe grep', { stdout: 'C:\\Git\\usr\\bin\\grep.exe', exitCode: 0 }],
      ['where.exe curl', { stdout: 'C:\\Git\\usr\\bin\\curl.exe', exitCode: 0 }],
      ['where.exe ssh', { stdout: 'C:\\Git\\usr\\bin\\ssh.exe', exitCode: 0 }],
      ['where.exe tar', { stdout: 'C:\\Git\\usr\\bin\\tar.exe', exitCode: 0 }],
    ]));
    const scanner = getScannerById('unix-commands')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('缺少 grep → warn', async () => {
    setupMock(new Map([
      ['where.exe ls', { stdout: 'C:\\Git\\usr\\bin\\ls.exe', exitCode: 0 }],
      ['where.exe grep', { exitCode: 1 }],
      ['where.exe curl', { stdout: 'C:\\Git\\usr\\bin\\curl.exe', exitCode: 0 }],
      ['where.exe ssh', { stdout: 'C:\\Git\\usr\\bin\\ssh.exe', exitCode: 0 }],
      ['where.exe tar', { stdout: 'C:\\Git\\usr\\bin\\tar.exe', exitCode: 0 }],
    ]));
    const scanner = getScannerById('unix-commands')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('grep');
  });

  test('全部不可用 → fail', async () => {
    setupMock(new Map([
      ['where.exe ls', { exitCode: 1 }],
      ['where.exe grep', { exitCode: 1 }],
      ['where.exe curl', { exitCode: 1 }],
      ['where.exe ssh', { exitCode: 1 }],
      ['where.exe tar', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('unix-commands')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
  });
});
