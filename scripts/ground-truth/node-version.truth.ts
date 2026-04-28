// scripts/ground-truth/node-version.truth.ts
import { runCommand } from '../../src/executor/index';
import { THRESHOLDS } from '../../src/scanners/thresholds';
import { aggregateVerdict, runScannerOrFallback } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const nodeVersionValidator: TruthValidator = {
  id: 'node-version',
  name: 'Node.js 版本检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取 Node.js 是否安装
    const whereResult = runCommand('where node', 5000);
    const isInstalled = whereResult.exitCode === 0;

    // Step 2: 独立获取版本号
    let realVersion = 'unknown';
    if (isInstalled) {
      const versionOutput = runCommand('node --version', 5000);
      const match = versionOutput.stdout.match(/v(\d+\.\d+\.\d+)/);
      realVersion = match?.[1] || 'unknown';
    }

    // Step 3: 运行扫描器
    const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('node-version', 'Node.js 版本检测', 'toolchain');

    // Step 4: 逐步比对
    // 检查点 1: 安装状态
    const expectedInstalled = isInstalled ? '已安装' : '未安装';
    const scannerInstalled = scannerResult.status === 'fail' ? '未安装' : '已安装';
    checks.push({
      name: '安装状态',
      scannerStep: 'runCommand:node --version',
      expectedValue: expectedInstalled,
      scannerValue: scannerInstalled,
      verdict: expectedInstalled === scannerInstalled ? 'correct' : 'incorrect',
    });

    // 检查点 2: 版本号解析（仅在已安装时）
    if (isInstalled && realVersion !== 'unknown') {
      const scannerVersion =
        scannerResult.message.match(/v?(\d+\.\d+\.\d+)/)?.[1] || 'unknown';
      checks.push({
        name: '版本号解析',
        scannerStep: 'parse:version',
        expectedValue: realVersion,
        scannerValue: scannerVersion,
        verdict: realVersion === scannerVersion ? 'correct' : 'incorrect',
      });

      // 检查点 3: 阈值判定
      const [majorStr] = realVersion.split('.');
      const major = Number(majorStr);
      const expectedStatus =
        isNaN(major) || major < THRESHOLDS.node.minMajor
          ? 'warn'
          : 'pass';
      checks.push({
        name: '阈值判定',
        scannerStep: 'compare:threshold',
        expectedValue: expectedStatus,
        scannerValue: scannerResult.status,
        verdict: expectedStatus === scannerResult.status ? 'correct' : 'incorrect',
      });
    }

    return {
      scannerId: 'node-version',
      scannerName: 'Node.js 版本检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
