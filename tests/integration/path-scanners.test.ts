import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, withEnv, type MockResponse } from './mock-helper';

// 确保所有 scanner 已注册
import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

describe('path-chinese scanner', () => {
  afterEach(teardownMock);

  test('中文用户路径 → fail', async () => {
    await withEnv({ USERPROFILE: 'C:\\Users\\张三', HOME: 'C:\\Users\\张三' }, async () => {
      const scanner = getScannerById('path-chinese')!;
      const result = await scanner.scan();
      expect(result.status).toBe('fail');
      expect(result.message).toContain('非 ASCII');
    });
  });

  test('正常英文路径 → pass', async () => {
    await withEnv({ USERPROFILE: 'C:\\Users\\admin', HOME: 'C:\\Users\\admin' }, async () => {
      const scanner = getScannerById('path-chinese')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });
});

describe('long-paths scanner', () => {
  afterEach(teardownMock);

  test('未启用长路径 → fail', async () => {
    setupMock(new Map([
      ['reg query', { stdout: '    LongPathsEnabled    REG_DWORD    0x0', exitCode: 0 }],
    ]));
    const scanner = getScannerById('long-paths')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('未启用');
  });

  test('已启用长路径 → pass', async () => {
    setupMock(new Map([
      ['reg query', { stdout: '    LongPathsEnabled    REG_DWORD    0x1', exitCode: 0 }],
    ]));
    const scanner = getScannerById('long-paths')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });
});

describe('env-path-length scanner', () => {
  afterEach(teardownMock);

  test('偏长但未超系统上限 → warn', async () => {
    const longPath = `${'C:\\VeryLongPathSegment;'.repeat(220)}C:\\Tools;C:\\Tools`;
    await withEnv({ PATH: longPath }, async () => {
      const scanner = getScannerById('env-path-length')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('偏长');
    });
  });

  test('正常 PATH → pass', async () => {
    await withEnv({ PATH: 'C:\\Windows;C:\\Windows\\System32;C:\\node' }, async () => {
      const scanner = getScannerById('env-path-length')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });
});

describe('temp-space scanner', () => {
  afterEach(teardownMock);

  test('磁盘空间不足 → fail', async () => {
    // 100MB = 104857600 bytes
    setupMock(new Map([
      ['powershell', { stdout: '104857600', exitCode: 0 }],
    ]));
    await withEnv({ TEMP: 'C:\\Temp', TMP: 'C:\\Temp' }, async () => {
      const scanner = getScannerById('temp-space')!;
      const result = await scanner.scan();
      expect(result.status).toBe('fail');
      expect(result.message).toContain('不足');
    });
  });

  test('空间充足 → pass', async () => {
    // 50GB = 53687091200 bytes
    setupMock(new Map([
      ['powershell', { stdout: '53687091200', exitCode: 0 }],
    ]));
    await withEnv({ TEMP: 'C:\\Temp', TMP: 'C:\\Temp' }, async () => {
      const scanner = getScannerById('temp-space')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
      expect(result.message).toContain('充足');
    });
  });
});
