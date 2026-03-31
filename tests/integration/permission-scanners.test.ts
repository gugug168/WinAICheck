import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, type MockResponse } from './mock-helper';

import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

describe('powershell-policy scanner', () => {
  afterEach(teardownMock);

  test('Restricted → fail', async () => {
    setupMock(new Map([
      ['powershell', { stdout: 'Restricted', exitCode: 0 }],
    ]));
    const scanner = getScannerById('powershell-policy')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Restricted');
  });

  test('RemoteSigned → pass', async () => {
    setupMock(new Map([
      ['powershell', { stdout: 'RemoteSigned', exitCode: 0 }],
    ]));
    const scanner = getScannerById('powershell-policy')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('RemoteSigned');
  });

  test('Bypass → pass', async () => {
    setupMock(new Map([
      ['powershell', { stdout: 'Bypass', exitCode: 0 }],
    ]));
    const scanner = getScannerById('powershell-policy')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });
});

describe('admin-perms scanner', () => {
  afterEach(teardownMock);

  test('非管理员 → warn', async () => {
    setupMock(new Map([
      ['net session', { exitCode: 2 }],
    ]));
    const scanner = getScannerById('admin-perms')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('非管理员');
  });

  test('管理员 → pass', async () => {
    setupMock(new Map([
      ['net session', { stdout: '', exitCode: 0 }],
    ]));
    const scanner = getScannerById('admin-perms')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('管理员');
  });
});

describe('time-sync scanner', () => {
  afterEach(teardownMock);

  test('正常同步 → pass', async () => {
    setupMock(new Map([
      ['w32tm /query /status', {
        stdout: 'Source: VMIC Provider\nLast Successful Sync Time: 2026-03-31 08:00:00\n',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('time-sync')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('非 NTP 源 → warn', async () => {
    setupMock(new Map([
      ['w32tm /query /status', {
        stdout: 'Source: Local CMOS Clock\nLast Successful Sync Time: 2026-03-30 12:00:00\n',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('time-sync')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('不可靠');
  });

  test('查询失败 → warn', async () => {
    setupMock(new Map([
      ['w32tm /query /status', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('time-sync')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
  });
});

describe('firewall-ports scanner', () => {
  afterEach(teardownMock);

  test('端口全部开放 → pass', async () => {
    setupMock(new Map([
      ['netsh advfirewall firewall show rule name=all dir=in', {
        stdout: '22\n443\n7860\n8888\n11434',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('firewall-ports')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('部分端口被封 → warn', async () => {
    // 返回空输出 → 端口不匹配
    setupMock(new Map([
      ['netsh advfirewall', { stdout: 'No rules match', exitCode: 1 }],
    ]));
    const scanner = getScannerById('firewall-ports')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('防火墙');
  });
});
