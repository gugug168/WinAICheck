// scripts/ground-truth/powershell-policy.truth.ts
import { runCommand, runPS } from '../../src/executor/index';
import { aggregateVerdict, runScannerOrFallback, tryMethods } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

function readPolicyFromReg(cmd: string): string {
  const output = runCommand(cmd, 5000).stdout;
  const match = output.match(/ExecutionPolicy\s+REG_SZ\s+(\S+)/);
  if (!match) throw new Error('policy not found');
  return match[1];
}

export const powershellPolicyValidator: TruthValidator = {
  id: 'powershell-policy',
  name: 'PowerShell 执行策略检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取执行策略，支持 PowerShell → HKLM → HKCU 降级
    const { result: policyResult } = tryMethods<string>([
      {
        name: 'powershell:Get-ExecutionPolicy',
        isAvailable: true,
        execute: () => {
          const output = runPS('Get-ExecutionPolicy', 5000).trim();
          if (!output) throw new Error('empty result');
          return output;
        },
      },
      {
        name: 'reg:hklm-policy',
        isAvailable: true,
        execute: () => readPolicyFromReg('reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell" /v ExecutionPolicy 2>nul'),
      },
      {
        name: 'reg:hkcu-policy',
        isAvailable: true,
        execute: () => readPolicyFromReg('reg query "HKCU\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell" /v ExecutionPolicy 2>nul'),
      },
    ], env);
    const policy = policyResult || 'unknown';

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
    const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('powershell-policy', 'PowerShell 执行策略检测', 'permission');

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
