// scripts/ground-truth/mirror-sources.truth.ts
import { existsSync as realExistsSync, readFileSync as realReadFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { _test } from '../../src/executor/index';
import { THRESHOLDS } from '../../src/scanners/thresholds';
import { aggregateVerdict, runScannerOrFallback } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

/** Mock-aware existsSync: uses _test.mockExistsSync if set, falls back to real */
function checkedExistsSync(path: string): boolean {
  if (_test.mockExistsSync) {
    return _test.mockExistsSync(path);
  }
  return realExistsSync(path);
}

/** Mock-aware readFileSync: uses _test.mockReadFileSync if set, falls back to real */
function checkedReadFileSync(path: string): string | null {
  if (_test.mockReadFileSync) {
    const result = _test.mockReadFileSync(path);
    if (result !== null) return result;
    // mockReadFileSync returns null for paths it doesn't handle → fall back
  }
  try {
    return realReadFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

export const mirrorSourcesValidator: TruthValidator = {
  id: 'mirror-sources',
  name: '镜像源配置检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立读取 pip 配置
    const pipPaths = [
      join(homedir(), 'pip', 'pip.ini'),
      join(homedir(), 'AppData', 'Roaming', 'pip', 'pip.ini'),
    ];
    const pipFile = pipPaths.find(p => checkedExistsSync(p));
    let pipExpectedStatus: string;
    let pipExpectedDetail: string;

    if (pipFile) {
      const content = checkedReadFileSync(pipFile) || '';
      if (THRESHOLDS.mirror_sources.pipMirrorPattern.test(content)) {
        pipExpectedStatus = 'mirror';
        pipExpectedDetail = 'pip: 已配置镜像';
      } else {
        pipExpectedStatus = 'no_mirror';
        pipExpectedDetail = 'pip: 未配置国内镜像';
      }
    } else {
      pipExpectedStatus = 'no_file';
      pipExpectedDetail = 'pip: 未找到 pip.ini';
    }

    // Step 2: 独立读取 npm 配置
    const npmrcPath = join(homedir(), '.npmrc');
    let npmExpectedStatus: string;
    let npmExpectedDetail: string;

    if (checkedExistsSync(npmrcPath)) {
      const content = checkedReadFileSync(npmrcPath) || '';
      if (/registry/.test(content) && !THRESHOLDS.mirror_sources.npmDefaultPattern.test(content)) {
        npmExpectedStatus = 'mirror';
        npmExpectedDetail = 'npm: 已配置镜像';
      } else {
        npmExpectedStatus = 'no_mirror';
        npmExpectedDetail = 'npm: 使用默认源';
      }
    } else {
      npmExpectedStatus = 'no_file';
      npmExpectedDetail = 'npm: 未找到 .npmrc';
    }

    // Step 3: 运行扫描器
    const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('mirror-sources', '镜像源配置检测', 'network');

    // Step 4: 比对
    // 检查点 1: pip 镜像配置
    const scannerDetail = scannerResult.detail || '';
    const scannerPipOk = scannerDetail.includes('pip: 已配置镜像');
    const truthPipOk = pipExpectedStatus === 'mirror';

    checks.push({
      name: 'pip 镜像配置',
      scannerStep: 'file:pip.ini',
      expectedValue: pipExpectedDetail,
      scannerValue: scannerPipOk ? 'pip: 已配置镜像' : (scannerDetail.includes('pip') ? scannerDetail.split('\n').find(l => l.includes('pip')) || 'pip: 检测结果' : 'pip: 未提及'),
      verdict: truthPipOk === scannerPipOk ? 'correct' : 'incorrect',
    });

    // 检查点 2: npm 镜像配置
    const scannerNpmOk = scannerDetail.includes('npm: 已配置镜像');
    const truthNpmOk = npmExpectedStatus === 'mirror';

    checks.push({
      name: 'npm 镜像配置',
      scannerStep: 'file:.npmrc',
      expectedValue: npmExpectedDetail,
      scannerValue: scannerNpmOk ? 'npm: 已配置镜像' : (scannerDetail.includes('npm') ? scannerDetail.split('\n').find(l => l.includes('npm')) || 'npm: 检测结果' : 'npm: 未提及'),
      verdict: truthNpmOk === scannerNpmOk ? 'correct' : 'incorrect',
    });

    return {
      scannerId: 'mirror-sources',
      scannerName: '镜像源配置检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
