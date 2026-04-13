import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveLocal, type UploadPayload, _testHelpers } from '../src/privacy/uploader';

function createPayload(): UploadPayload {
  return {
    timestamp: new Date('2026-04-07T00:00:00.000Z').toISOString(),
    score: 88,
    results: [
      { id: 'node', name: 'Node.js', category: 'toolchain', status: 'pass', message: 'Node.js 已安装' },
    ],
    systemInfo: {
      os: 'Windows 11',
      cpu: 'Intel(R) Core(TM) i7',
      ramGB: 32,
      gpu: 'NVIDIA GeForce RTX 4060',
      diskFreeGB: 128,
    },
  };
}

function createBlockedCandidate(root: string, name: string): string {
  const blocker = join(root, `${name}.txt`);
  writeFileSync(blocker, 'blocked', 'utf-8');
  return join(blocker, 'WinAICheck', 'reports');
}

describe('uploader.saveLocal', () => {
  const tempRoots: string[] = [];
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    _testHelpers.resetReportDirState();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('默认目录不可写时会自动回退到后续可写目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'winaicheck-uploader-'));
    tempRoots.push(root);

    const blockedCandidate = createBlockedCandidate(root, 'blocked-localappdata');
    const writableCandidate = join(root, 'fallback-reports');
    _testHelpers.setReportDirCandidates([blockedCandidate, writableCandidate]);

    const filepath = saveLocal(createPayload());

    expect(filepath).toStartWith(writableCandidate);
    expect(existsSync(filepath)).toBe(true);

    const saved = JSON.parse(readFileSync(filepath, 'utf-8')) as UploadPayload;
    expect(saved.score).toBe(88);
    expect(saved.results[0]?.id).toBe('node');
  });

  test('所有候选目录都不可写时返回空字符串，不抛异常', () => {
    const root = mkdtempSync(join(tmpdir(), 'winaicheck-uploader-'));
    tempRoots.push(root);

    process.chdir(root);
    writeFileSync(join(root, 'reports'), 'blocked', 'utf-8');

    const blockedA = createBlockedCandidate(root, 'blocked-a');
    const blockedB = createBlockedCandidate(root, 'blocked-b');
    _testHelpers.setReportDirCandidates([blockedA, blockedB]);

    let filepath = '__unset__';
    expect(() => {
      filepath = saveLocal(createPayload());
    }).not.toThrow();
    expect(filepath).toBe('');
  });
});
