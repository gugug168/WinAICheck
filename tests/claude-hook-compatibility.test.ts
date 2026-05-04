import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import '../src/scanners/claude-hook-compatibility';
import { getScannerById } from '../src/scanners/registry';

const scanner = () => getScannerById('claude-hook-compatibility')!;

describe('claude-hook-compatibility scanner', () => {
  let tempDir = '';
  let originalCwd = '';
  let originalUserProfile: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'winaicheck-claude-hooks-'));
    originalCwd = process.cwd();
    originalUserProfile = process.env.USERPROFILE;
    originalHome = process.env.HOME;
    process.env.USERPROFILE = join(tempDir, 'home');
    process.env.HOME = join(tempDir, 'home');
    mkdirSync(join(process.env.USERPROFILE, '.claude'), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('识别 PowerShell -Command 内嵌 $env 赋值导致的 Windows hook 风险', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true });
    writeFileSync(join(tempDir, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write|Edit|MultiEdit',
            hooks: [
              {
                type: 'command',
                command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:AUTO_LOOP_URL=\'http://aicoevo.net\'; $env:OPENAI_API_KEY=\'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890\'; & scripts/post-edit-verify.ps1 -OutputDir .tmp/auto-loop"',
              },
            ],
          },
        ],
      },
    }));

    const result = await scanner().scan();

    expect(result.status).toBe('warn');
    expect(result.error_type).toBe('misconfigured');
    expect(result.message).toContain('Claude Code hook');
    expect(result.detail).toContain('settings.json');
    expect(result.detail).toContain('PostToolUse');
    expect(result.detail).toContain('Write|Edit|MultiEdit');
    expect(result.detail).toContain('-File');
    expect(result.detail).toContain('-WebsiteUrl');
    expect(result.detail).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result.detail).not.toContain('OPENAI_API_KEY');
  });

  test('允许使用 -File 和显式参数的 Claude hook 命令', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true });
    writeFileSync(join(tempDir, '.claude', 'hooks.example.json'), JSON.stringify({
      hooks: [
        {
          matcher: {
            event: 'PostToolUse',
            tool: 'Write|Edit|MultiEdit',
          },
          hooks: [
            {
              type: 'command',
              command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/post-edit-verify.ps1 -OutputDir .tmp/auto-loop -WebsiteUrl http://aicoevo.net',
            },
          ],
        },
      ],
    }));

    const result = await scanner().scan();

    expect(result.status).toBe('pass');
    expect(result.message).toContain('未发现');
    expect(result.detail).toContain('hooks.example.json');
  });

  test('同时扫描用户级 Claude settings.json', async () => {
    writeFileSync(join(process.env.USERPROFILE!, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write',
            hooks: [
              {
                type: 'command',
                command: 'pwsh -NoProfile -Command "$env:AUTO_LOOP_URL=\'http://aicoevo.net\'; ./scripts/post-edit-verify.ps1"',
              },
            ],
          },
        ],
      },
    }));

    const result = await scanner().scan();

    expect(result.status).toBe('warn');
    expect(result.detail).toContain(join(process.env.USERPROFILE!, '.claude', 'settings.json'));
    expect(result.detail).toContain('pwsh');
  });
});
