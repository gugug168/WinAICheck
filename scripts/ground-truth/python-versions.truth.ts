// scripts/ground-truth/python-versions.truth.ts
import { runCommand } from '../../src/executor/index';
import { aggregateVerdict, runScannerOrFallback } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

interface TruthPythonInstall {
  path: string;
  version: string;
}

function normalizePath(path: string): string {
  return path.trim().toLowerCase().replace(/\//g, '\\');
}

function parsePythonVersion(text: string): string {
  return text.match(/Python (\d+\.\d+\.\d+)/)?.[1] || 'unknown';
}

function parsePyLauncherEntries(stdout: string): TruthPythonInstall[] {
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const path = line.match(/([A-Za-z]:\\.+)$/)?.[1]?.trim();
      if (!path) return null;
      return {
        path,
        version: line.match(/^-V:([0-9]+(?:\.[0-9]+){1,2})/i)?.[1] || 'unknown',
      };
    })
    .filter((entry): entry is TruthPythonInstall => entry !== null);
}

export const pythonVersionsValidator: TruthValidator = {
  id: 'python-versions',
  name: 'Python 版本检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];
    const installs = new Map<string, TruthPythonInstall>();

    // Step 1: 独立获取当前 python 是否可用
    const whereResult = runCommand('where python', 5000);
    const versionOutput = runCommand('python --version', 5000);
    const activeInstalled = versionOutput.exitCode === 0;
    if (activeInstalled) {
      const version = parsePythonVersion(versionOutput.stdout);
      const activePath = whereResult.exitCode === 0
        ? whereResult.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) || 'python'
        : 'python';
      installs.set(normalizePath(activePath || `python:${version}`), { path: activePath, version });
    }

    // Step 2: 独立读取 py 启动器识别到的解释器清单
    const pyWhere = runCommand('where.exe py', 5000);
    if (pyWhere.exitCode === 0) {
      const pyList = runCommand('py -0p', 5000);
      if (pyList.exitCode === 0) {
        for (const entry of parsePyLauncherEntries(pyList.stdout)) {
          const key = normalizePath(entry.path);
          const existing = installs.get(key);
          if (!existing || existing.version === 'unknown') {
            installs.set(key, entry);
          }
        }
      }
    }

    const truthInstalls = [...installs.values()];
    const isInstalled = truthInstalls.length > 0 || activeInstalled;

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

    // 检查点 2: 多版本冲突判定
    if (truthInstalls.length > 1) {
      checks.push({
        name: '多版本冲突判定',
        scannerStep: 'compare:multi-version',
        expectedValue: 'warn',
        scannerValue: scannerResult.status,
        verdict: scannerResult.status === 'warn' ? 'correct' : 'incorrect',
        note: truthInstalls.map(install => `${install.version} (${install.path})`).join('; '),
      });
    } else if (isInstalled) {
      // 检查点 3: 单解释器版本解析与阈值判定
      const realVersion = truthInstalls[0]?.version || parsePythonVersion(versionOutput.stdout);
      const scannerVersion =
        scannerResult.message.match(/(\d+\.\d+\.\d+)/)?.[1] || 'unknown';

      if (realVersion !== 'unknown') {
        checks.push({
          name: '版本号解析',
          scannerStep: 'parse:version',
          expectedValue: realVersion,
          scannerValue: scannerVersion,
          verdict: realVersion === scannerVersion ? 'correct' : 'incorrect',
        });

        const [major, minor] = realVersion.split('.').map(Number);
        const expectedStatus = major < 3 || (major === 3 && minor < 8) ? 'warn' : 'pass';
        checks.push({
          name: '阈值判定',
          scannerStep: 'compare:version-status',
          expectedValue: expectedStatus,
          scannerValue: scannerResult.status,
          verdict: expectedStatus === scannerResult.status ? 'correct' : 'incorrect',
        });
      }
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
