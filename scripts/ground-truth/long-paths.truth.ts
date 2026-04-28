// scripts/ground-truth/long-paths.truth.ts
import { runReg } from '../../src/executor/index';
import { getScannerById } from '../../src/scanners/registry';
import { scanWithDiagnostic } from '../../src/scanners/diagnostic';
import { aggregateVerdict } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const longPathsValidator: TruthValidator = {
  id: 'long-paths',
  name: '长路径支持检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立读取注册表获取 LongPathsEnabled 值
    let realEnabled = false;
    let regReadOk = false;
    try {
      const output = runReg(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem',
        'LongPathsEnabled',
      );
      regReadOk = true;
      realEnabled = /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(output);
    } catch {
      // 非 admin 或权限不足时无法读取注册表
    }

    // Step 2: 运行扫描器
    const scanner = getScannerById('long-paths');
    const { result: scannerResult, diagnostic: scannerDiag } = scanner
      ? await scanWithDiagnostic(scanner)
      : {
          result: {
            id: 'long-paths',
            name: '长路径支持检测',
            category: 'path' as const,
            status: 'unknown' as const,
            message: 'scanner not found',
          },
          diagnostic: undefined,
        };

    // Step 3: 比对
    if (!regReadOk) {
      // 注册表读取失败（非管理员），标记为跳过
      checks.push({
        name: '注册表值读取',
        scannerStep: 'runReg:HKLM\\...\\FileSystem',
        expectedValue: '(无法独立读取)',
        scannerValue: scannerResult.status,
        verdict: 'skipped',
        note: '非管理员权限，无法独立读取注册表',
      });
    } else {
      const expectedStatus = realEnabled ? 'pass' : 'fail';
      checks.push({
        name: '注册表值读取',
        scannerStep: 'runReg:HKLM\\...\\FileSystem',
        expectedValue: expectedStatus,
        scannerValue: scannerResult.status,
        verdict: expectedStatus === scannerResult.status ? 'correct' : 'incorrect',
      });
    }

    return {
      scannerId: 'long-paths',
      scannerName: '长路径支持检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
