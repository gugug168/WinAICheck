import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { findProjectDir, hasProjectMarker } from './config-utils';

const PYTHON_PROJECT_MARKERS = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.py', 'Pipfile', 'poetry.lock', 'uv.lock'];
const VENV_DIRS = ['.venv', 'venv'];

const scanner: Scanner = {
  id: 'python-project-venv',
  name: 'Python 项目虚拟环境检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    const isPythonProject = hasProjectMarker(PYTHON_PROJECT_MARKERS);
    if (!isPythonProject) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '当前目录未检测到 Python 项目',
      };
    }

    const venvDir = findProjectDir(VENV_DIRS);
    if (!venvDir) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: '检测到 Python 项目，但未发现项目级虚拟环境',
        detail: '建议在项目根目录创建 .venv 或 venv，避免污染系统 Python/Anaconda 环境。',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '检测到项目级 Python 虚拟环境',
      detail: `目录: ${venvDir}`,
    };
  },
};

registerScanner(scanner);
