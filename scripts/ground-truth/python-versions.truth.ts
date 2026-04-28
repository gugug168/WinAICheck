// scripts/ground-truth/python-versions.truth.ts
import { runCommand } from '../../src/executor/index';
import { aggregateVerdict, runScannerOrFallback } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const pythonVersionsValidator: TruthValidator = {
  id: 'python-versions',
  name: 'Python 版本检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取 Python 是否安装
    const whereResult = runCommand('where python', 5000);
    const isInstalled = whereResult.exitCode === 0;

    // Step 2: 独立获取版本号
    let realVersion = 'unknown';
    if (isInstalled) {
      const versionOutput = runCommand('python --version', 5000);
      const match = versionOutput.stdout.match(/Python (\d+\.\d+\.\d+)/);
      realVersion = match?.[1] || 'unknown';
    }

    // Step 3: 运行扫描器
    const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('python-versions', 'Python 版本检测', 'toolchain');

    // Step 4: 逐步比对
    // 检查点 1: 安装状态
    const expectedInstalled = isInstalled ? '已安装' : '未安装';
    const scannerInstalled = scannerResult.status === 'fail' ? '未安装' : '已安装';
    checks.push({
      name: '安装状态',
      scannerStep: 'runCommand:python --version',
      expectedValue: expectedInstalled,
      scannerValue: scannerInstalled,
      verdict: expectedInstalled === scannerInstalled ? 'correct' : 'incorrect',
    });

    // 检查点 2: 版本号解析（仅在已安装时）
    if (isInstalled && realVersion !== 'unknown') {
      const scannerVersion =
        scannerResult.message.match(/(\d+\.\d+\.\d+)/)?.[1] || 'unknown';
      checks.push({
        name: '版本号解析',
        scannerStep: 'parse:version',
        expectedValue: realVersion,
        scannerValue: scannerVersion,
        verdict: realVersion === scannerVersion ? 'correct' : 'incorrect',
      });
    }

    return {
      scannerId: 'python-versions',
      scannerName: 'Python 版本检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
