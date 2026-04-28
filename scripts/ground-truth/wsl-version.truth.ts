// scripts/ground-truth/wsl-version.truth.ts
import { runCommand } from '../../src/executor/index';
import { aggregateVerdict, runScannerOrFallback } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const wslVersionValidator: TruthValidator = {
  id: 'wsl-version',
  name: 'WSL 版本检测',
  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立检查 WSL 安装状态
    const statusResult = runCommand('wsl --status', 8000);
    const isInstalled = statusResult.exitCode === 0;

    // Step 2: 独立解析 WSL 版本
    let realWslVersion = 'unknown';
    if (isInstalled) {
      const isWsl2 = /默认版本:\s*2|default version:\s*2/i.test(statusResult.stdout);
      realWslVersion = isWsl2 ? 'WSL2' : 'WSL1';
    }

    // Step 3: 运行扫描器
    const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('wsl-version', 'WSL 版本检测', 'gpu');

    // 检查点 1: 安装状态
    const expectedInstalled = isInstalled ? '已安装' : '未安装';
    const scannerInstalled =
      scannerResult.status === 'warn' && scannerResult.message.includes('未安装')
        ? '未安装'
        : '已安装';
    checks.push({
      name: '安装状态',
      scannerStep: 'runCommand:wsl --status',
      expectedValue: expectedInstalled,
      scannerValue: scannerInstalled,
      verdict: expectedInstalled === scannerInstalled ? 'correct' : 'incorrect',
    });

    // 检查点 2: 版本判定（仅已安装时）
    if (isInstalled) {
      const expectedStatus = realWslVersion === 'WSL2' ? 'pass' : 'warn';
      checks.push({
        name: '版本判定',
        scannerStep: 'parse:version',
        expectedValue: expectedStatus,
        scannerValue: scannerResult.status,
        verdict: expectedStatus === scannerResult.status ? 'correct' : 'incorrect',
      });
    }

    return {
      scannerId: 'wsl-version',
      scannerName: 'WSL 版本检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
