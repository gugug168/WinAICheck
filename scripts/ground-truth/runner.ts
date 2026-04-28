// scripts/ground-truth/runner.ts

import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCommand } from '../../src/executor/index';
import type { ValidationCheck, CheckVerdict, ValidatorEnv, ValidationReport, TruthValidator, DegradableMethod } from './types';

/** 整体判定聚合：incorrect > partial > correct > skipped */
export function aggregateVerdict(checks: ValidationCheck[]): CheckVerdict {
  if (checks.length === 0) return 'skipped';
  if (checks.some(c => c.verdict === 'incorrect')) return 'incorrect';
  if (checks.some(c => c.verdict === 'partial')) return 'partial';
  if (checks.every(c => c.verdict === 'skipped')) return 'skipped';
  return 'correct';
}

/** 按优先级尝试多个检测方法，自动降级 */
export function tryMethods<T>(
  methods: DegradableMethod<T>[],
  env: ValidatorEnv,
): { result: T | null; usedMethod: string | null } {
  for (const method of methods) {
    if (!method.isAvailable) {
      env.degradedMethods.push(method.name);
      continue;
    }
    try {
      const result = method.execute();
      return { result, usedMethod: method.name };
    } catch {
      env.degradedMethods.push(method.name);
    }
  }
  return { result: null, usedMethod: null };
}

/** 动态发现所有 .truth.ts 验证器 */
export async function discoverValidators(dir?: string): Promise<TruthValidator[]> {
  // 确保扫描器已注册
  await import('../../src/scanners/index.js');

  const validatorDir = dir ?? dirname(fileURLToPath(import.meta.url));
  let files: string[];
  try {
    files = readdirSync(validatorDir).filter(f => f.endsWith('.truth.ts') || f.endsWith('.truth.js'));
  } catch {
    return [];
  }

  const validators: TruthValidator[] = [];
  for (const file of files) {
    try {
      const mod = await import(join(validatorDir, file));
      const validator: TruthValidator | undefined = mod.default
        || Object.values(mod).find((v: any) => v && typeof (v as any).validate === 'function') as TruthValidator | undefined;
      if (validator) validators.push(validator);
    } catch {
      // skip invalid validators
    }
  }
  return validators;
}

/** 运行所有验证器 */
export async function runAllValidators(
  validators: TruthValidator[],
  env?: ValidatorEnv,
): Promise<ValidationReport[]> {
  const realEnv: ValidatorEnv = env ?? {
    windowsVersion: detectWindowsVersion(),
    isAdmin: detectAdmin(),
    degradedMethods: [],
  };

  const reports: ValidationReport[] = [];
  for (const validator of validators) {
    try {
      const report = await validator.validate(realEnv);
      reports.push(report);
    } catch (err) {
      // 验证器出错不阻塞其他验证器
    }
  }
  return reports;
}

/** 格式化报告为终端表格 */
export function formatReport(reports: ValidationReport[]): string {
  if (reports.length === 0) return 'WinAICheck 扫描器审计 — 无验证器可用\n';

  let output = '\nWinAICheck 扫描器审计\n\n';
  const correct = reports.filter(r => r.overallVerdict === 'correct').length;
  const issues = reports.filter(r => r.overallVerdict !== 'correct').length;
  output += `总计: ${reports.length} 验证器, ${correct} 正确, ${issues} 有问题\n\n`;

  for (const report of reports) {
    const icon = report.overallVerdict === 'correct' ? '✅' : report.overallVerdict === 'incorrect' ? '❌' : '⚠️';
    output += `${icon} ${report.scannerName}: ${report.checks.length} 检查点, 判定 ${report.overallVerdict}\n`;
    for (const check of report.checks) {
      if (check.verdict !== 'correct') {
        output += `   → ${check.name}: 期望 "${check.expectedValue}" 实际 "${check.scannerValue}"\n`;
      }
    }
  }

  return output;
}

function detectWindowsVersion(): string {
  const result = runCommand('ver', 5000);
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] || 'unknown';
}

function detectAdmin(): boolean {
  return runCommand('net session', 5000).exitCode === 0;
}
