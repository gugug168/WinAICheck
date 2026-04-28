// scripts/ground-truth/powershell-policy.truth.ts
import { runPS } from '../../src/executor/index';
import { getScannerById } from '../../src/scanners/registry';
import { scanWithDiagnostic } from '../../src/scanners/diagnostic';
import { aggregateVerdict } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const powershellPolicyValidator: TruthValidator = {
  id: 'powershell-policy',
  name: 'PowerShell 执行策略检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取执行策略
    const psOutput = runPS('Get-ExecutionPolicy', 5000).trim();
    const policy = psOutput || 'unknown';

    // Step 2: 独立判定预期状态
    const failPolicies = ['Restricted', 'AllSigned'];
    const passPolicies = ['RemoteSigned', 'Unrestricted', 'Bypass'];

    let expectedStatus: string;
    if (passPolicies.includes(policy)) {
      expectedStatus = 'pass';
    } else if (failPolicies.includes(policy)) {
      expectedStatus = 'fail';
    } else {
      expectedStatus = 'warn';
    }

    // Step 3: 运行扫描器
    const scanner = getScannerById('powershell-policy');
    const { result: scannerResult, diagnostic: scannerDiag } = scanner
      ? await scanWithDiagnostic(scanner)
      : {
          result: {
            id: 'powershell-policy',
            name: 'PowerShell 执行策略检测',
            category: 'permission' as const,
            status: 'unknown' as const,
            message: 'scanner not found',
          },
          diagnostic: undefined,
        };

    // Step 4: 比对
    // 检查点 1: 执行策略值
    const scannerPolicy = scannerResult.message.match(/执行策略(?:为|正常)?\s*["(]?(\w+)/)?.[1]
      || scannerResult.message.match(/\((\w+)\)/)?.[1]
      || 'unknown';

    checks.push({
      name: '执行策略值',
      scannerStep: 'runPS:Get-ExecutionPolicy',
      expectedValue: policy,
      scannerValue: scannerPolicy,
      verdict: policy.toLowerCase() === scannerPolicy.toLowerCase() ? 'correct' : 'incorrect',
    });

    // 检查点 2: 策略判定
    checks.push({
      name: '策略判定',
      scannerStep: 'compare:policy-status',
      expectedValue: expectedStatus,
      scannerValue: scannerResult.status,
      verdict: expectedStatus === scannerResult.status ? 'correct' : 'incorrect',
    });

    return {
      scannerId: 'powershell-policy',
      scannerName: 'PowerShell 执行策略检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
