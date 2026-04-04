import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, withEnv, type MockResponse } from './mock-helper';
import { calculateScore } from '../../src/scoring/calculator';
import type { ScanResult } from '../../src/scanners/types';

import '../../src/scanners/index';
import { getScanners, getScannerById } from '../../src/scanners/registry';

const MOCK_ONLY_SCANNER_EXCLUDES = new Set([
  'mirror-sources',
  'mcp-config-health',
  'mcp-command-availability',
  'python-project-venv',
  'python-env-alignment',
  'git-credential-health',
  'terminal-profile-health',
  'claude-config-health',
  'openclaw-config-health',
]);

/**
 * 创建"全通过"环境的 mock 响应
 */
function allPassResponses(): Map<string, MockResponse> {
  return new Map([
    // path-spaces: 无空格
    ['where.exe git', { stdout: 'C:\\Git\\cmd\\git.exe', exitCode: 0 }],
    ['where.exe node', { stdout: 'C:\\node\\node.exe', exitCode: 0 }],
    ['where.exe python', { stdout: 'C:\\Python311\\python.exe', exitCode: 0 }],
    // long-paths: 已启用
    ['reg query', { stdout: '    LongPathsEnabled    REG_DWORD    0x1', exitCode: 0 }],
    // temp-space: 空间充足 (100GB)
    ['powershell -NoProfile -Command "(Get-PSDrive -Name \'C\' -ErrorAction SilentlyContinue).Free"', { stdout: '107374182400', exitCode: 0 }],
    // git
    ['git --version', { stdout: 'git version 2.45.0', exitCode: 0 }],
    ['git config --global user.name', { stdout: 'Test User', exitCode: 0 }],
    ['git config --global user.email', { stdout: 'test@example.com', exitCode: 0 }],
    ['git config --global credential.helper', { stdout: 'manager-core', exitCode: 0 }],
    ['echo %PATH%', {
      stdout: 'C:\\Git\\cmd;C:\\Git\\bin;C:\\Git\\usr\\bin;C:\\Windows;C:\\Windows\\System32;C:\\node',
      exitCode: 0,
    }],
    // node
    ['node --version', { stdout: 'v22.0.0', exitCode: 0 }],
    ['npm config get prefix', { stdout: 'C:\\node', exitCode: 0 }],
    // python
    ['python --version', { stdout: 'Python 3.11.5', exitCode: 0 }],
    ['python3 --version', { exitCode: 1 }],
    ['where.exe python', { stdout: 'C:\\Python311\\python.exe', exitCode: 0 }],
    // cpp
    ['cl.exe 2>&1', { stdout: 'Microsoft (R) C/C++ 19.35', exitCode: 0 }],
    // package-managers
    ['pip --version', { stdout: 'pip 24.0', exitCode: 0 }],
    ['npm --version', { stdout: '10.5.0', exitCode: 0 }],
    ['bun --version', { stdout: '1.1.0', exitCode: 0 }],
    ['pnpm --version', { stdout: '9.0.0', exitCode: 0 }],
    ['yarn --version', { stdout: '4.1.0', exitCode: 0 }],
    ['where.exe npx', { stdout: 'C:\\node\\npx.cmd', exitCode: 0 }],
    // unix-commands
    ['where.exe ls', { stdout: 'C:\\Git\\usr\\bin\\ls.exe', exitCode: 0 }],
    ['where.exe grep', { stdout: 'C:\\Git\\usr\\bin\\grep.exe', exitCode: 0 }],
    ['where.exe curl', { stdout: 'C:\\Git\\usr\\bin\\curl.exe', exitCode: 0 }],
    ['where.exe ssh', { stdout: 'C:\\Git\\usr\\bin\\ssh.exe', exitCode: 0 }],
    ['where.exe tar', { stdout: 'C:\\Git\\usr\\bin\\tar.exe', exitCode: 0 }],
    // gpu
    ['nvidia-smi --query-gpu=name,driver_version --format=csv,noheader', {
      stdout: 'NVIDIA GeForce RTX 4090, 535.104', exitCode: 0,
    }],
    ['nvidia-smi --query-gpu=driver_version --format=csv,noheader', {
      stdout: '535.104', exitCode: 0,
    }],
    // cuda
    ['nvcc --version', { stdout: 'Cuda compilation tools, release 12.1, V12.1.105', exitCode: 0 }],
    // virtualization
    ['systeminfo', { stdout: 'Virtualization Enabled In Firmware: Yes', exitCode: 0 }],
    ['powershell -Command "(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty VirtualizationFirmwareEnabled)"', { stdout: 'True', exitCode: 0 }],
    // wsl
    ['wsl --status', { stdout: '默认版本: 2\n默认分发: Ubuntu', exitCode: 0 }],
    // vram
    ['nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', {
      stdout: '4096, 16384', exitCode: 0,
    }],
    ['nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv,noheader', {
      stdout: '', exitCode: 0,
    }],
    // powershell-policy
    ['powershell -NoProfile -Command "Get-ExecutionPolicy"', { stdout: 'RemoteSigned', exitCode: 0 }],
    ['powershell -Command "$PSVersionTable.PSVersion.ToString()"', { stdout: '5.1.22621.2506', exitCode: 0 }],
    ['pwsh -Command "$PSVersionTable.PSVersion.ToString()"', { stdout: '7.4.2', exitCode: 0 }],
    ['where.exe pwsh', { stdout: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', exitCode: 0 }],
    // admin
    ['net session', { stdout: '', exitCode: 0 }],
    // time-sync
    ['w32tm /query /status', {
      stdout: 'Source: time.windows.com,0x9\nLast Successful Sync Time: 2026-03-31 12:34:56', exitCode: 0,
    }],
    // firewall
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
    // ssl
    ['curl -Is --max-time 5 https://pypi.org', { stdout: 'HTTP/2 200', exitCode: 0 }],
    ['curl -Is --max-time 5 https://registry.npmjs.org', { stdout: 'HTTP/2 200', exitCode: 0 }],
    // site-reachability
    ['curl -Is --max-time 5 https://huggingface.co', { exitCode: 0 }],
    ['curl -Is --max-time 5 https://github.com', { exitCode: 0 }],
    ['curl -Is --max-time 5 https://api.openai.com', { exitCode: 0 }],
    // dns
    ['nslookup huggingface.co', {
      stdout: 'Server: dns.example\nAddress: 192.168.1.1\n\nNon-authoritative answer:\nName: huggingface.co\nAddress: 1.2.3.4',
      exitCode: 0,
    }],
    ['nslookup github.com', {
      stdout: 'Server: dns.example\nAddress: 192.168.1.1\n\nNon-authoritative answer:\nName: github.com\nAddress: 5.6.7.8',
      exitCode: 0,
    }],
    ['nslookup pypi.org', {
      stdout: 'Server: dns.example\nAddress: 192.168.1.1\n\nNon-authoritative answer:\nName: pypi.org\nAddress: 9.10.11.12',
      exitCode: 0,
    }],
    // uv-package-manager
    ['where.exe uv', { stdout: 'C:\\Python311\\Scripts\\uv.exe', exitCode: 0 }],
    ['uv --version', { stdout: 'uv 0.4.0', exitCode: 0 }],
    // claude-cli
    ['where.exe claude', { stdout: 'C:\\node\\claude.cmd', exitCode: 0 }],
    ['claude --version', { stdout: 'Claude Code v1.0.0', exitCode: 0 }],
    // openclaw
    ['where.exe openclaw', { stdout: 'C:\\node\\openclaw.cmd', exitCode: 0 }],
    ['openclaw --version', { stdout: 'OpenClaw v0.1.0', exitCode: 0 }],
    // ccswitch
    ['where.exe ccswitch', { stdout: 'C:\\node\\ccswitch.cmd', exitCode: 0 }],
    ['ccswitch --version', { stdout: 'CCSwitch v0.1.0', exitCode: 0 }],
    // shell
    ['chcp', { stdout: 'Active code page: 65001', exitCode: 0 }],
  ]);
}

describe('scoring e2e', () => {
  afterEach(teardownMock);

  test('计算器基础验证', () => {
    const results: ScanResult[] = [
      { id: 't1', name: 'Test 1', category: 'path', status: 'pass', message: 'ok' },
      { id: 't2', name: 'Test 2', category: 'path', status: 'pass', message: 'ok' },
      { id: 't3', name: 'Test 3', category: 'toolchain', status: 'pass', message: 'ok' },
    ];
    const score = calculateScore(results);
    expect(score.score).toBe(100);
    expect(score.grade).toBe('excellent');
  });

  test('全失败 → 低分', () => {
    const results: ScanResult[] = [
      { id: 't1', name: 'Test 1', category: 'path', status: 'fail', message: 'bad' },
      { id: 't2', name: 'Test 2', category: 'path', status: 'fail', message: 'bad' },
      { id: 't3', name: 'Test 3', category: 'toolchain', status: 'fail', message: 'bad' },
    ];
    const score = calculateScore(results);
    expect(score.score).toBe(0);
    expect(score.grade).toBe('poor');
  });

  test('混合场景 → 中间分', () => {
    const results: ScanResult[] = [
      { id: 't1', name: 'Test 1', category: 'path', status: 'pass', message: 'ok' },
      { id: 't2', name: 'Test 2', category: 'path', status: 'fail', message: 'bad' },
      { id: 't3', name: 'Test 3', category: 'toolchain', status: 'pass', message: 'ok' },
    ];
    const score = calculateScore(results);
    // path: 1/2 pass, weight 1.5 → weighted 0.75
    // toolchain: 1/1 pass, weight 1.0 → weighted 1.0
    // total weighted pass: 1.75, total weighted all: 2.5
    // score: 1.75/2.5 * 100 = 70
    expect(score.score).toBe(70);
    expect(score.grade).toBe('good');
  });

  test('unknown 不计分母', () => {
    const results: ScanResult[] = [
      { id: 't1', name: 'Test 1', category: 'path', status: 'pass', message: 'ok' },
      { id: 't2', name: 'Test 2', category: 'path', status: 'unknown', message: 'skip' },
    ];
    const score = calculateScore(results);
    // only 1 scorable, 1 pass → 100
    expect(score.score).toBe(100);
  });

  test('可选工具未安装不显著拉低总分', () => {
    const results: ScanResult[] = [
      { id: 'path-chinese', name: 'Path', category: 'path', status: 'pass', message: 'ok' },
      { id: 'git', name: 'Git', category: 'toolchain', status: 'pass', message: 'ok' },
      { id: 'openclaw', name: 'OpenClaw', category: 'toolchain', status: 'warn', message: 'optional' },
      { id: 'ccswitch', name: 'CCSwitch', category: 'toolchain', status: 'warn', message: 'optional' },
    ];
    const score = calculateScore(results);
    expect(score.score).toBe(100);
  });

  test('所有 scanner 已注册', () => {
    const scanners = getScanners();
    expect(scanners.length).toBeGreaterThanOrEqual(20);
  });

  test('默认扫描列表不包含 AI 客户端安装与本地配置检查', () => {
    const scanners = getScanners();
    const ids = scanners.map(scanner => scanner.id);

    expect(ids).not.toContain('claude-cli');
    expect(ids).not.toContain('openclaw');
    expect(ids).not.toContain('ccswitch');
    expect(ids).not.toContain('claude-config-health');
    expect(ids).not.toContain('openclaw-config-health');

    expect(getScannerById('claude-cli')).toBeDefined();
    expect(getScannerById('openclaw')).toBeDefined();
    expect(getScannerById('ccswitch')).toBeDefined();
    expect(getScannerById('claude-config-health')).toBeDefined();
    expect(getScannerById('openclaw-config-health')).toBeDefined();
  });

  test('全通过 mock 环境下核心命令式 scanner 返回 pass', async () => {
    const responses = allPassResponses();
    _test.mockExecSync = createCommandMock(responses);

    await withEnv({
      USERPROFILE: 'C:\\Users\\admin',
      HOME: 'C:\\Users\\admin',
      PATH: 'C:\\Windows;C:\\Windows\\System32;C:\\node',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      // 清除代理
      HTTP_PROXY: '', HTTPS_PROXY: '', FTP_PROXY: '',
      http_proxy: '', https_proxy: '', ftp_proxy: '',
      ALL_PROXY: '', all_proxy: '', NO_PROXY: '', no_proxy: '',
    }, async () => {
      const scanners = getScanners();
      const results: ScanResult[] = [];

      for (const scanner of scanners) {
        const result = await scanner.scan();
        results.push(result);
      }

      // 仅验证可由命令 mock 稳定满足的核心 scanner。
      // 依赖真实配置文件、项目目录或用户主目录状态的 scanner 由各自集成测试覆盖。
      const commandScanners = results.filter(
        r => !MOCK_ONLY_SCANNER_EXCLUDES.has(r.id),
      );
      const passCount = commandScanners.filter(r => r.status === 'pass').length;
      expect(passCount).toBe(commandScanners.length);
    });
  });
});
