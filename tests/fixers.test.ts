import { describe, expect, test } from 'bun:test';
import { _testHelpers } from '../src/fixers/index';

describe('git-path fixer helpers', () => {
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
});
