import { afterEach, describe, expect, test } from 'bun:test';
import { _test } from '../src/executor/index';
import { _testHelpers, executeFix, getFixerByScannerId } from '../src/fixers/index';
import { createCommandMock, teardownMock, withEnv } from './integration/mock-helper';
import '../src/scanners/index';

describe('git-path fixer helpers', () => {
  afterEach(teardownMock);

  test('构造的 PowerShell 命令使用标准 Split-Path', () => {
    const command = _testHelpers.buildGitPathFixCommand();
    expect(command).toContain('Split-Path -Parent $gitSource');
    expect(command).toContain('Split-Path -Parent $gitCmdDir');
    expect(command).not.toContain('Split-Parent');
    expect(command).toContain("Select-Object -Unique");
  });

  test('回滚路径会正确转义单引号', () => {
    const escaped = _testHelpers.escapePowerShellSingleQuotedString("C:\\Tools;'quoted'\\bin");
    expect(escaped).toBe("C:\\Tools;''quoted''\\bin");
  });

  test('Python 入口提示文案明确是查看详情而不是自动修复', () => {
    const message = _testHelpers.buildPythonLocatorMessage(['[python --version]\nPython 3.11.5']);
    expect(message).toContain('只用于确认默认版本');
    expect(message).toContain('Python 3.11.5');
  });

  test('python-versions fixer 会返回详细的入口和版本信息', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['python --version', { stdout: 'Python 3.11.5', exitCode: 0 }],
      ['where.exe python', { stdout: 'C:\\Python311\\python.exe', exitCode: 0 }],
      ['py -0p', { stdout: ' -V:3.11 * C:\\Python311\\python.exe', exitCode: 0 }],
      ['pip --version', { stdout: 'pip 24.0 from C:\\Python311\\Lib\\site-packages\\pip (python 3.11)', exitCode: 0 }],
      ['python3 --version', { exitCode: 1 }],
      ['where.exe python3', { exitCode: 1 }],
    ]));

    const fixer = getFixerByScannerId('python-versions')!;
    const result = await fixer.execute(
      { id: 'fix-python-versions', scannerId: 'python-versions', tier: 'yellow', description: '', risk: '' },
      { scannerId: 'python-versions', timestamp: Date.now(), data: {} },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('[python --version]');
    expect(result.message).toContain('Python 3.11.5');
    expect(result.message).toContain('[pip --version]');
  });

  test('env-path-length fixer 会输出重复 PATH 条目报告', async () => {
    const fixer = getFixerByScannerId('env-path-length')!;

    await withEnv(
      { PATH: 'C:\\Tools;C:\\Windows;C:\\Tools;C:\\Git\\cmd' },
      async () => {
        const result = await fixer.execute(
          { id: 'fix-env-path-length', scannerId: 'env-path-length', tier: 'yellow', description: '', risk: '' },
          { scannerId: 'env-path-length', timestamp: Date.now(), data: {} },
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('PATH 偏长或存在冗余');
        expect(result.message).toContain('重复项');
        expect(result.message).toContain('c:\\tools');
      },
    );
  });

  test('需要新终端生效的修复会延迟验证而不是误判失败', async () => {
    const fix = getFixerByScannerId('powershell-version')!.getFix({
      id: 'powershell-version',
      name: 'PowerShell 版本检测',
      category: 'toolchain',
      status: 'warn',
      message: '仅安装了 Windows PowerShell 5.1',
    });

    _test.mockExecSync = createCommandMock(new Map([
      ['where.exe winget', { stdout: 'C:\\Windows\\System32\\winget.exe', exitCode: 0 }],
      ['pwsh --version', { exitCode: 1 }],
      [fix.commands![0], { stdout: 'Installed', exitCode: 0 }],
      ['where.exe wt', { exitCode: 1 }],
    ]));

    const result = await executeFix(fix);

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.message).toContain('当前进程内无法准确验证');
    expect(result.message).toContain('需要重新打开终端窗口才能生效');
  });
});
