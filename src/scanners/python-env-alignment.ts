import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { runCommand } from '../executor/index';
import { hasProjectMarker } from './config-utils';

const PYTHON_PROJECT_MARKERS = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.py', 'Pipfile', 'poetry.lock', 'uv.lock'];

function normalizePythonRoot(value: string): string {
  return value
    .replace(/\\Scripts\\python(?:\.exe)?$/i, '')
    .replace(/\\Lib\\site-packages\\pip.*$/i, '')
    .trim()
    .toLowerCase();
}

const scanner: Scanner = {
  id: 'python-env-alignment',
  name: 'Python 环境一致性检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    if (!hasProjectMarker(PYTHON_PROJECT_MARKERS)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '当前目录未检测到 Python 项目，跳过环境一致性检查',
      };
    }

    const python = runCommand('python -c "import sys; print(sys.executable)"', 8000);
    const pip = runCommand('pip --version', 8000);

    if (python.exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'missing',
        message: 'Python 不可用，无法校验项目环境',
      };
    }

    if (pip.exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'missing',
        message: 'pip 不可用，Python 依赖安装可能失败',
        detail: `python: ${python.stdout.trim()}`,
      };
    }

    const pythonPath = python.stdout.split(/\r?\n/)[0].trim();
    const pipPathMatch = pip.stdout.match(/from\s+(.+?)\s+\(python/i);
    const pipPath = pipPathMatch?.[1]?.trim() || '';
    const aligned = pythonPath && pipPath && normalizePythonRoot(pythonPath) === normalizePythonRoot(pipPath);

    if (!aligned) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'conflict',
        message: 'python 与 pip 可能来自不同环境',
        detail: `python: ${pythonPath}\npip: ${pipPath || pip.stdout.trim()}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'python 与 pip 环境一致',
      detail: `python: ${pythonPath}\npip: ${pipPath}`,
    };
  },
};

registerScanner(scanner);
