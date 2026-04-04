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

  test('中文输出也能识别 → pass', async () => {
    setupMock(new Map([
      ['w32tm /query /status', {
        stdout: '源: time.windows.com\n上次成功同步时间: 2026-03-31 08:00:00\n',
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
      ['netsh advfirewall firewall show rule name=all verbose', {
        stdout: [
          'Rule Name: SSH',
          'Direction: In',
          'Enabled: Yes',
          'Action: Allow',
          'LocalPort: 22',
          '',
          'Rule Name: HTTPS',
          'Direction: In',
          'Enabled: Yes',
          'Action: Allow',
          'LocalPort: 443',
          '',
          'Rule Name: Gradio',
          'Direction: In',
          'Enabled: Yes',
          'Action: Allow',
          'LocalPort: 7860',
          '',
          'Rule Name: Jupyter',
          'Direction: In',
          'Enabled: Yes',
          'Action: Allow',
          'LocalPort: 8888',
          '',
          'Rule Name: Ollama',
          'Direction: In',
          'Enabled: Yes',
          'Action: Allow',
          'LocalPort: 11434',
        ].join('\n'),
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('firewall-ports')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('无显式规则 → warn，但不宣称被阻止', async () => {
    setupMock(new Map([
      ['netsh advfirewall firewall show rule name=all verbose', {
        stdout: 'Rule Name: Some Other Rule\nDirection: Out\nEnabled: Yes\nAction: Allow\nLocalPort: 9000',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('firewall-ports')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('未发现显式入站放行规则');
  });
});
