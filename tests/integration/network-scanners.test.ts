import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, withEnv, type MockResponse } from './mock-helper';

import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

describe('proxy-config scanner', () => {
  afterEach(teardownMock);

  test('无代理 → pass', async () => {
    // 清除代理环境变量（Windows 不区分大小写）
    await withEnv({
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      NO_PROXY: '',
    }, async () => {
      const scanner = getScannerById('proxy-config')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
      expect(result.message).toContain('直连');
    });
  });

  test('有代理但无 NO_PROXY → warn', async () => {
    // Windows 环境变量不区分大小写，只设一组
    await withEnv({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: '',
    }, async () => {
      const scanner = getScannerById('proxy-config')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('NO_PROXY');
    });
  });

  test('有代理且有 NO_PROXY → pass', async () => {
    await withEnv({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost,127.0.0.1',
    }, async () => {
      const scanner = getScannerById('proxy-config')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });
});

describe('ssl-certs scanner', () => {
  afterEach(teardownMock);

  test('SSL 正常 → pass', async () => {
    setupMock(new Map([
      ['curl -Is --max-time 5 https://pypi.org', {
        stdout: 'HTTP/2 200\ncontent-type: text/html',
        exitCode: 0,
      }],
      ['curl -Is --max-time 5 https://registry.npmjs.org', {
        stdout: 'HTTP/1.1 200 OK',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('ssl-certs')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('SSL 错误 → fail', async () => {
    setupMock(new Map([
      ['curl -Is --max-time 5 https://pypi.org', {
        stderr: 'curl: (60) SSL certificate problem',
        exitCode: 1,
      }],
      ['curl -Is --max-time 5 https://registry.npmjs.org', {
        stderr: 'curl: (60) SSL certificate problem',
        exitCode: 1,
      }],
    ]));
    const scanner = getScannerById('ssl-certs')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('SSL');
  });
});

describe('site-reachability scanner', () => {
  afterEach(teardownMock);

  test('全部可达 → pass', async () => {
    setupMock(new Map([
      ['curl -Is --max-time 5 https://huggingface.co', { exitCode: 0 }],
      ['curl -Is --max-time 5 https://github.com', { exitCode: 0 }],
      ['curl -Is --max-time 5 https://api.openai.com', { exitCode: 0 }],
    ]));
    const scanner = getScannerById('site-reachability')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('全部不可达 → fail', async () => {
    setupMock(new Map([
      ['curl -Is --max-time 5 https://huggingface.co', { exitCode: 1 }],
      ['curl -Is --max-time 5 https://github.com', { exitCode: 1 }],
      ['curl -Is --max-time 5 https://api.openai.com', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('site-reachability')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('不可达');
  });

  test('部分不可达 → warn', async () => {
    setupMock(new Map([
      ['curl -Is --max-time 5 https://huggingface.co', { exitCode: 1 }],
      ['curl -Is --max-time 5 https://github.com', { exitCode: 0 }],
      ['curl -Is --max-time 5 https://api.openai.com', { exitCode: 0 }],
    ]));
    const scanner = getScannerById('site-reachability')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('HuggingFace');
  });
});

describe('dns-resolution scanner', () => {
  afterEach(teardownMock);

  test('DNS 解析正常 → pass', async () => {
    setupMock(new Map([
      ['nslookup huggingface.co', {
        stdout: 'Name: huggingface.co\nAddresses: 2606:4700::6810:1f\n 104.18.31.25',
        exitCode: 0,
      }],
      ['nslookup github.com', {
        stdout: 'Name: github.com\nAddress: 20.205.243.166',
        exitCode: 0,
      }],
      ['nslookup pypi.org', {
        stdout: 'Name: pypi.org\nAddress: 151.101.0.223',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('dns-resolution')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('DNS 解析失败 → fail', async () => {
    setupMock(new Map([
      ['nslookup huggingface.co', {
        stdout: 'DNS request timed out.',
        exitCode: 1,
      }],
      ['nslookup github.com', {
        stdout: 'DNS request timed out.',
        exitCode: 1,
      }],
      ['nslookup pypi.org', {
        stdout: 'DNS request timed out.',
        exitCode: 1,
      }],
    ]));
    const scanner = getScannerById('dns-resolution')!;
    const result = await scanner.scan();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('DNS');
  });

  test('部分解析失败 → warn', async () => {
    setupMock(new Map([
      ['nslookup huggingface.co', {
        stdout: 'DNS request timed out.',
        exitCode: 1,
      }],
      ['nslookup github.com', {
        stdout: 'Name: github.com\nAddress: 20.205.243.166',
        exitCode: 0,
      }],
      ['nslookup pypi.org', {
        stdout: 'Name: pypi.org\nAddress: 151.101.0.223',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('dns-resolution')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
  });
});

describe('mirror-sources scanner', () => {
  // mirror-sources 不依赖命令执行，而是读取文件系统
  // 它需要实际文件存在，此处测试其逻辑

  test('scanner 已注册', () => {
    const scanner = getScannerById('mirror-sources')!;
    expect(scanner).toBeDefined();
    expect(scanner.category).toBe('network');
  });
});
