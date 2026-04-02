import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, type MockResponse } from './mock-helper';

import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

describe('ccswitch scanner', () => {
  afterEach(teardownMock);

  // === 第一层：CLI 检测 ===

  test('CLI 版已安装（有版本号） → pass', async () => {
    setupMock(new Map([
      ['where.exe ccswitch', { stdout: 'C:\\Users\\test\\ccswitch.cmd', exitCode: 0 }],
      ['ccswitch --version', { stdout: '1.2.3', exitCode: 0 }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('1.2.3');
    expect(result.message).toContain('CLI');
  });

  test('CLI 版已安装（版本获取失败） → pass', async () => {
    setupMock(new Map([
      ['where.exe ccswitch', { stdout: 'C:\\Users\\test\\ccswitch.cmd', exitCode: 0 }],
      ['ccswitch --version', { exitCode: 1 }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('CLI');
  });

  // === 第三层：注册表回退（Uninstall 键） ===

  test('注册表 Uninstall 检测到 "CC Switch" → pass', async () => {
    _test.mockExistsSync = () => false;
    setupMock(new Map([
      ['reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"', {
        stdout: 'HKCU\\...\\Uninstall\\CC Switch\\some entry',
        exitCode: 0,
      }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('图形版');
  });

  test('注册表 Uninstall 检测到 "ccswitch" → pass', async () => {
    _test.mockExistsSync = () => false;
    setupMock(new Map([
      ['reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"', {
        stdout: 'HKCU\\...\\Uninstall\\ccswitch_v1.0',
        exitCode: 0,
      }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('图形版');
  });

  test('HKCU Uninstall 失败，HKLM 检测到 "CC-Switch" → pass', async () => {
    _test.mockExistsSync = () => false;
    setupMock(new Map([
      ['reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"', {
        stdout: 'HKLM\\...\\CC-Switch-CLI',
        exitCode: 0,
      }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('图形版');
  });

  // === 第三层：注册表回退（Run 键 — CC Switch GUI 实际写入位置） ===

  test('注册表 Run 键检测到 "CC Switch" → pass', async () => {
    // Uninstall 键全部无结果，Run 键命中
    _test.mockExistsSync = () => false;
    setupMock(new Map([
      ['reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"', {
        stdout: 'CC Switch    REG_SZ    C:\\Users\\Admin\\AppData\\Local\\Programs\\CC Switch\\cc-switch.exe',
        exitCode: 0,
      }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('图形版');
  });

  test('HKCU Run 失败，HKLM Run 检测到 "cc-switch" → pass', async () => {
    _test.mockExistsSync = () => false;
    setupMock(new Map([
      ['reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"', {
        stdout: 'cc-switch    REG_SZ    C:\\Program Files\\CC Switch\\cc-switch.exe',
        exitCode: 0,
      }],
    ]));
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('图形版');
  });

  // === 四层全部失败 ===

  test('完全未安装 → warn', async () => {
    setupMock(new Map());
    _test.mockExistsSync = () => false;
    const result = await getScannerById('ccswitch')!.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('未安装');
    expect(result.detail).toContain('npm install');
    expect(result.detail).toContain('npmmirror');
  });
});
