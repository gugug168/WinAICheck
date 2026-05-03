import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { aggregateVerdict, tryMethods } from '../scripts/ground-truth/runner';
import { discoverValidators, formatReport, runAllValidators } from '../scripts/ground-truth/runner';
import type { ValidationCheck } from '../scripts/ground-truth/types';

describe('formatReport', () => {
  it('空报告不崩溃', () => {
    const output = formatReport([]);
    expect(output).toContain('审计');
  });

  it('包含正确的验证器信息', () => {
    const checks: ValidationCheck[] = [
      { name: '安装状态', scannerStep: 's1', expectedValue: '已安装', scannerValue: '已安装', verdict: 'correct' },
    ];
    const reports = [{
      scannerId: 'test',
      scannerName: '测试',
      env: { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] },
      checks,
      overallVerdict: 'correct' as const,
      scannerResult: { id: 'test', name: '测试', category: 'toolchain' as const, status: 'pass' as const, message: 'ok' },
    }];
    const output = formatReport(reports);
    expect(output).toContain('测试');
    expect(output).toContain('1 验证器');
    expect(output).toContain('1 正确');
  });

  it('显示有问题的检查点', () => {
    const checks: ValidationCheck[] = [
      { name: '版本号', scannerStep: 's1', expectedValue: '2.45.0', scannerValue: '2.30.0', verdict: 'incorrect' as const },
    ];
    const reports = [{
      scannerId: 'test',
      scannerName: '测试2',
      env: { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] },
      checks,
      overallVerdict: 'incorrect' as const,
      scannerResult: { id: 'test', name: '测试2', category: 'toolchain' as const, status: 'pass' as const, message: 'ok' },
    }];
    const output = formatReport(reports);
    expect(output).toContain('2.45.0');
    expect(output).toContain('2.30.0');
  });

  it('validator 加载失败时显式报错', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'winaicheck-validator-'));
    try {
      writeFileSync(join(tempDir, 'bad.truth.ts'), "throw new Error('boom');\n", 'utf8');
      let error: Error | null = null;
      try {
        await discoverValidators(tempDir);
      } catch (err) {
        error = err as Error;
      }
      expect(error).not.toBeNull();
      expect(error!.message).toContain('验证器加载失败');
      expect(error!.message).toContain('bad.truth.ts');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('validator 运行失败时显式报错', async () => {
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] as string[] };
    const validators = [{
      id: 'boom',
      name: 'Boom Validator',
      validate: async () => {
        throw new Error('validator broke');
      },
    }];

    let error: Error | null = null;
    try {
      await runAllValidators(validators, env);
    } catch (err) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('验证器运行失败');
    expect(error!.message).toContain('boom');
    expect(env.degradedMethods).toContain('validator-run:boom');
  });
});
