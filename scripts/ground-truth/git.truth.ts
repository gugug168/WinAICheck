// scripts/ground-truth/git.truth.ts
import { runCommand } from '../../src/executor/index';
import { getScannerById } from '../../src/scanners/registry';
import { scanWithDiagnostic } from '../../src/scanners/diagnostic';
import { compareVersions, THRESHOLDS } from '../../src/scanners/thresholds';
import { aggregateVerdict } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const gitValidator: TruthValidator = {
  id: 'git',
  name: 'Git 检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取 Git 是否安装
    const whereResult = runCommand('where git', 5000);
    const isInstalled = whereResult.exitCode === 0;

    // Step 2: 独立获取版本号
    let realVersion = 'unknown';
    if (isInstalled) {
      const versionOutput = runCommand('git --version', 5000);
      const match = versionOutput.stdout.match(/git version (\d+\.\d+\.\d+)/);
      realVersion = match?.[1] || 'unknown';
    }

    // Step 3: 运行扫描器
    const scanner = getScannerById('git');
    const { result: scannerResult, diagnostic: scannerDiag } = scanner
      ? await scanWithDiagnostic(scanner)
      : {
          result: {
            id: 'git',
            name: 'Git 检测',
            category: 'toolchain' as const,
            status: 'unknown' as const,
            message: 'scanner not found',
          },
          diagnostic: undefined,
        };

    // Step 4: 逐步比对
    // 检查点 1: 安装状态
    const expectedInstalled = isInstalled ? '已安装' : '未安装';
    const scannerInstalled = scannerResult.status === 'fail' ? '未安装' : '已安装';
    checks.push({
      name: '安装状态',
      scannerStep: 'runCommand:git --version',
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

      // 检查点 3: 阈值判定
      const expectedStatus =
        compareVersions(realVersion, THRESHOLDS.git.minVersion) < 0
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
      scannerId: 'git',
      scannerName: 'Git 检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
