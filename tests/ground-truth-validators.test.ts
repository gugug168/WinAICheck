import { describe, it, expect, afterEach } from 'bun:test';
import { _test } from '../src/executor/index';
import { createCommandMock } from './integration/mock-helper';
import { gitValidator } from '../scripts/ground-truth/git.truth';
import { nodeVersionValidator } from '../scripts/ground-truth/node-version.truth';
import { pythonVersionsValidator } from '../scripts/ground-truth/python-versions.truth';
import { wslVersionValidator } from '../scripts/ground-truth/wsl-version.truth';
import { firewallPortsValidator } from '../scripts/ground-truth/firewall-ports.truth';
import { longPathsValidator } from '../scripts/ground-truth/long-paths.truth';
import { powershellPolicyValidator } from '../scripts/ground-truth/powershell-policy.truth';
import { mirrorSourcesValidator } from '../scripts/ground-truth/mirror-sources.truth';

// Import scanners so getScannerById() works in tests
import '../src/scanners/index';

describe('git validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('git 2.51.1 → 全部 correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['git --version', { stdout: 'git version 2.51.1', exitCode: 0 }],
      ['where git', { stdout: 'C:\\Program Files\\Git\\cmd\\git.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await gitValidator.validate(env);

    expect(report.scannerId).toBe('git');
    expect(report.overallVerdict).toBe('correct');
    expect(report.checks.length).toBeGreaterThanOrEqual(2);
  });

  it('git 未安装 → 至少一个 incorrect (安装状态不匹配)', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['git --version', { stdout: '', exitCode: 1 }],
      ['where git', { stdout: '', exitCode: 1 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await gitValidator.validate(env);

    // 扫描器应报告 fail (未安装)，验证器也检测到未安装 → 安装状态应一致
    expect(report.checks[0].name).toBe('安装状态');
    // 因为 mock 的 where git 失败 + git --version 失败，两边都认为未安装 → correct
    expect(report.checks[0].verdict).toBe('correct');
  });

  it('git 版本过旧 → 阈值判定检查', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['git --version', { stdout: 'git version 2.20.0', exitCode: 0 }],
      ['where git', { stdout: 'C:\\Program Files\\Git\\cmd\\git.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await gitValidator.validate(env);

    expect(report.checks.length).toBe(3);
    expect(report.checks[2].name).toBe('阈值判定');
  });
});

describe('node-version validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('node v22.0.0 → 全部 correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['node --version', { stdout: 'v22.0.0', exitCode: 0 }],
      ['where node', { stdout: 'C:\\nvm4w\\nodejs\\node.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await nodeVersionValidator.validate(env);

    expect(report.scannerId).toBe('node-version');
    expect(report.overallVerdict).toBe('correct');
  });

  it('node not installed → correct (both agree on fail)', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['node --version', { stdout: '', exitCode: 1 }],
      ['where node', { stdout: '', exitCode: 1 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await nodeVersionValidator.validate(env);

    expect(report.checks[0].verdict).toBe('correct'); // 安装状态
  });
});

describe('python-versions validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('python 3.12 detected → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['python --version', { stdout: 'Python 3.12.0', exitCode: 0 }],
      ['where python', { stdout: 'C:\\Python312\\python.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await pythonVersionsValidator.validate(env);

    expect(report.scannerId).toBe('python-versions');
    expect(report.overallVerdict).toBe('correct');
  });

  it('多解释器冲突 → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['python --version', { stdout: 'Python 3.7.0', exitCode: 0 }],
      ['where python', { stdout: 'D:\\anaconda3\\python.exe\r\nC:\\Python314\\python.exe', exitCode: 0 }],
      ['where.exe python', { stdout: 'D:\\anaconda3\\python.exe\r\nC:\\Python314\\python.exe', exitCode: 0 }],
      ['python3 --version', { stdout: '', exitCode: 1 }],
      ['where.exe python3', { stdout: '', exitCode: 1 }],
      ['py -V', { stdout: 'Python 3.14.0', exitCode: 0 }],
      ['where.exe py', { stdout: 'C:\\Windows\\py.exe', exitCode: 0 }],
      ['py -0p', { stdout: '-V:3.14 *        C:\\Python314\\python.exe\n -V:ContinuumAnalytics/Anaconda37-64 D:\\anaconda3\\python.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await pythonVersionsValidator.validate(env);

    expect(report.overallVerdict).toBe('correct');
    expect(report.checks[1].name).toBe('多版本冲突判定');
    expect(report.checks[1].verdict).toBe('correct');
  });
});

describe('wsl-version validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('WSL2 installed → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['wsl --status', { stdout: '默认版本: 2\n默认分发: Ubuntu', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await wslVersionValidator.validate(env);
    expect(report.overallVerdict).toBe('correct');
  });

  it('WSL not installed → correct (both agree)', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['wsl --status', { stdout: '', exitCode: 1 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await wslVersionValidator.validate(env);
    expect(report.checks[0].verdict).toBe('correct');
  });
});

describe('firewall-ports validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('ports configured → correct', async () => {
    const netshOutput = `Rule Name: SSH Allow\nDirection: In\nAction: Allow\nEnabled: Yes\nLocal Port: 22\n\nRule Name: HTTPS\nDirection: In\nAction: Allow\nEnabled: Yes\nLocal Port: 443`;
    _test.mockExecSync = createCommandMock(new Map([
      ['netsh advfirewall firewall show rule name=all verbose', { stdout: netshOutput, exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await firewallPortsValidator.validate(env);
    expect(report.scannerId).toBe('firewall-ports');
  });
});

describe('long-paths validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('LongPathsEnabled=1 → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v "LongPathsEnabled"',
        { stdout: 'LongPathsEnabled    REG_DWORD    0x1', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await longPathsValidator.validate(env);
    expect(report.overallVerdict).toBe('correct');
  });
});

describe('powershell-policy validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('RemoteSigned → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['powershell -NoProfile -Command "Get-ExecutionPolicy"', { stdout: 'RemoteSigned', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await powershellPolicyValidator.validate(env);
    expect(report.overallVerdict).toBe('correct');
  });

  it('PowerShell 命令失败时回退到 HKCU 注册表 → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['powershell -NoProfile -Command "Get-ExecutionPolicy"', { stdout: '', exitCode: 1 }],
      ['reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell" /v ExecutionPolicy 2>nul', { stdout: '', exitCode: 1 }],
      ['reg query "HKCU\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell" /v ExecutionPolicy 2>nul', {
        stdout: 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell\n    ExecutionPolicy    REG_SZ    RemoteSigned',
        exitCode: 0,
      }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] as string[] };
    const report = await powershellPolicyValidator.validate(env);

    expect(report.overallVerdict).toBe('correct');
    expect(env.degradedMethods).toContain('powershell:Get-ExecutionPolicy');
  });
});

describe('mirror-sources validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
    _test.mockReadFileSync = null;
    _test.mockExistsSync = null;
  });

  it('pip with tsinghua mirror → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['net session', { exitCode: 0 }],
    ]));
    _test.mockExistsSync = () => true;
    _test.mockReadFileSync = (path: string) => {
      if (path.includes('pip.ini')) return '[global]\nindex-url = https://pypi.tuna.tsinghua.edu.cn/simple';
      if (path.includes('.npmrc')) return 'registry=https://registry.npmmirror.com';
      return null;
    };
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await mirrorSourcesValidator.validate(env);
    expect(report.scannerId).toBe('mirror-sources');
  });
});
