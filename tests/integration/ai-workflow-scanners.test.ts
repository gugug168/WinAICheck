import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, withEnv, type MockResponse } from './mock-helper';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

async function withTempHome(fn: (home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'aicoevo-home-'));
  try {
    await withEnv({
      USERPROFILE: home,
      HOME: home,
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
    }, async () => {
      await fn(home);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function withTempCwd(fn: (cwd: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'aicoevo-cwd-'));
  const old = process.cwd();
  try {
    process.chdir(dir);
    await fn(dir);
  } finally {
    process.chdir(old);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ai workflow scanners', () => {
  afterEach(teardownMock);

  test('mcp-config-health: 有效配置 → pass', async () => {
    await withTempHome(async (home) => {
      const claudeDir = join(home, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'mcp_settings.json'), JSON.stringify({
        mcpServers: {
          filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        },
      }));
      const scanner = getScannerById('mcp-config-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });

  test('mcp-config-health: 配置损坏 → fail', async () => {
    await withTempHome(async (home) => {
      const claudeDir = join(home, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'mcp_settings.json'), '{"mcpServers": ');
      const scanner = getScannerById('mcp-config-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('fail');
    });
  });

  test('mcp-command-availability: 部分命令不存在 → warn', async () => {
    setupMock(new Map([
      ['where.exe npx', { stdout: 'C:\\node\\npx.cmd', exitCode: 0 }],
      ['where.exe missingcmd', { exitCode: 1 }],
    ]));
    await withTempHome(async (home) => {
      const claudeDir = join(home, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'mcp_settings.json'), JSON.stringify({
        mcpServers: {
          ok: { command: 'npx' },
          bad: { command: 'missingcmd' },
        },
      }));
      const scanner = getScannerById('mcp-command-availability')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('missingcmd');
    });
  });

  test('python-project-venv: Python 项目无虚拟环境 → warn', async () => {
    await withTempCwd(async (cwd) => {
      writeFileSync(join(cwd, 'pyproject.toml'), '[project]\nname="demo"');
      const scanner = getScannerById('python-project-venv')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
    });
  });

  test('python-project-venv: 存在 .venv → pass', async () => {
    await withTempCwd(async (cwd) => {
      writeFileSync(join(cwd, 'pyproject.toml'), '[project]\nname="demo"');
      mkdirSync(join(cwd, '.venv'), { recursive: true });
      const scanner = getScannerById('python-project-venv')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });

  test('python-env-alignment: python 与 pip 来源不一致 → warn', async () => {
    setupMock(new Map([
      ['python -c "import sys; print(sys.executable)"', { stdout: 'C:\\repo\\.venv\\Scripts\\python.exe', exitCode: 0 }],
      ['pip --version', { stdout: 'pip 24.0 from D:\\Anaconda3\\Lib\\site-packages\\pip (python 3.11)', exitCode: 0 }],
    ]));
    await withTempCwd(async (cwd) => {
      writeFileSync(join(cwd, 'pyproject.toml'), '[project]\nname="demo"');
      const scanner = getScannerById('python-env-alignment')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
    });
  });

  test('node-global-bin-path: prefix 不在 PATH 且 npx 缺失 → warn', async () => {
    setupMock(new Map([
      ['npm config get prefix', { stdout: 'C:\\Users\\demo\\AppData\\Roaming\\npm', exitCode: 0 }],
      ['where.exe npx', { exitCode: 1 }],
    ]));
    await withEnv({ PATH: 'C:\\Windows\\System32' }, async () => {
      const scanner = getScannerById('node-global-bin-path')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
    });
  });

  test('node-global-bin-path: prefix 在 PATH 且 npx 可用 → pass', async () => {
    setupMock(new Map([
      ['npm config get prefix', { stdout: 'C:\\Users\\demo\\AppData\\Roaming\\npm', exitCode: 0 }],
      ['where.exe npx', { stdout: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\npx.cmd', exitCode: 0 }],
    ]));
    await withEnv({ PATH: 'C:\\Windows\\System32;C:\\Users\\demo\\AppData\\Roaming\\npm' }, async () => {
      const scanner = getScannerById('node-global-bin-path')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });

  test('node-manager-conflict: 多个 node 路径 → warn', async () => {
    setupMock(new Map([
      ['where.exe node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\nC:\\Users\\demo\\AppData\\Local\\nvm\\v20\\node.exe', exitCode: 0 }],
    ]));
    const scanner = getScannerById('node-manager-conflict')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
  });

  test('git-identity-config: 缺少 email → warn', async () => {
    setupMock(new Map([
      ['git config --global user.name', { stdout: 'Demo User', exitCode: 0 }],
      ['git config --global user.email', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('git-identity-config')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
  });

  test('git-credential-health: 无 helper 无 SSH key → warn', async () => {
    setupMock(new Map([
      ['git config --global credential.helper', { exitCode: 1 }],
    ]));
    await withTempHome(async () => {
      const scanner = getScannerById('git-credential-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
    });
  });

  test('git-credential-health: 存在 helper → pass', async () => {
    setupMock(new Map([
      ['git config --global credential.helper', { stdout: 'manager-core', exitCode: 0 }],
    ]));
    await withTempHome(async () => {
      const scanner = getScannerById('git-credential-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });

  test('shell-encoding-health: 非 UTF-8 → warn', async () => {
    setupMock(new Map([
      ['chcp', { stdout: 'Active code page: 936', exitCode: 0 }],
    ]));
    const scanner = getScannerById('shell-encoding-health')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
  });

  test('terminal-profile-health: 默认 profile 指向 pwsh → pass', async () => {
    setupMock(new Map([
      ['where.exe wt', { stdout: 'C:\\Windows\\System32\\wt.exe', exitCode: 0 }],
    ]));
    await withTempHome(async (home) => {
      const settingsDir = join(home, 'AppData', 'Local', 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(join(settingsDir, 'settings.json'), `{
        // comment
        "defaultProfile": "{pwsh}",
        "profiles": {
          "list": [
            { "guid": "{pwsh}", "name": "PowerShell", "commandline": "C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" }
          ]
        }
      }`);
      const scanner = getScannerById('terminal-profile-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('pass');
    });
  });

  test('claude-config-health: 已安装但无配置 → warn', async () => {
    setupMock(new Map([
      ['where.exe claude', { stdout: 'C:\\node\\claude.cmd', exitCode: 0 }],
    ]));
    await withTempHome(async () => {
      const scanner = getScannerById('claude-config-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('warn');
    });
  });

  test('openclaw-config-health: 占位密钥 → fail', async () => {
    setupMock(new Map([
      ['where.exe openclaw', { stdout: 'C:\\node\\openclaw.cmd', exitCode: 0 }],
    ]));
    await withTempHome(async (home) => {
      const dir = join(home, '.openclaw');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({
        provider: 'openrouter',
        apiKey: 'your-api-key',
      }));
      const scanner = getScannerById('openclaw-config-health')!;
      const result = await scanner.scan();
      expect(result.status).toBe('fail');
    });
  });

  test('openclaw-config-health: 配置正常且有环境变量 → pass', async () => {
    await withTempHome(async (home) => {
      const dir = join(home, '.openclaw');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      }));
      await withEnv({ OPENROUTER_API_KEY: 'sk-live-valid-key' }, async () => {
        const scanner = getScannerById('openclaw-config-health')!;
        const result = await scanner.scan();
        expect(result.status).toBe('pass');
      });
    });
  });
});
