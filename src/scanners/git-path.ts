import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists } from '../executor/index';
import { registerScanner } from './registry';

/**
 * 检测 Git PATH 完整性
 * 很多用户安装 Git 后只有 Git\cmd 在 PATH，缺少 Git\bin 和 Git\usr\bin
 * 导致 sh、bash、ssh、scp 等命令在部分场景下不可用
 */
const scanner: Scanner = {
  id: 'git-path',
  name: 'Git PATH 完整性检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    // 先找 Git 安装路径
    const { stdout, exitCode } = runCommand('where.exe git', 5000);
    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: '未检测到 Git',
      };
    }

    // 从 git 路径推导安装目录
    const gitPath = stdout.split('\n')[0].trim(); // e.g. C:\Program Files\Git\mingw64\bin\git.exe
    const gitDir = gitPath.replace(/\\mingw64\\bin\\git\.exe$/i, '')
                         .replace(/\\cmd\\git\.exe$/i, '');

    // 检查 PATH 中是否包含这些关键目录
    const requiredDirs = [
      { dir: `${gitDir}\\cmd`, label: 'Git\\cmd', cmds: ['git'] },
      { dir: `${gitDir}\\bin`, label: 'Git\\bin', cmds: ['sh', 'bash'] },
      { dir: `${gitDir}\\usr\\bin`, label: 'Git\\usr\\bin', cmds: ['ssh', 'scp', 'tar', 'awk', 'sed'] },
    ];

    const pathEnv = runCommand('echo %PATH%', 3000).stdout.toUpperCase();
    const missing: string[] = [];
    const present: string[] = [];

    for (const { dir, label } of requiredDirs) {
      if (pathEnv.includes(dir.toUpperCase().replace(/\//g, '\\'))) {
        present.push(label);
      } else {
        missing.push(label);
      }
    }

    if (missing.length === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: 'Git PATH 配置完整',
        detail: `已包含: ${present.join(', ')}`,
      };
    }

    // 检查命令是否实际可用（可能通过其他路径）
    const missingCmds: string[] = [];
    for (const cmd of ['sh', 'bash', 'ssh', 'scp', 'awk', 'sed']) {
      if (!commandExists(cmd)) {
        missingCmds.push(cmd);
      }
    }

    if (missingCmds.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: `Git PATH 不完整，缺少 ${missing.join('、')}，导致 ${missingCmds.join('、')} 不可用`,
        detail: `Git 安装目录: ${gitDir}\n缺少目录: ${missing.join('、')}\n不可用命令: ${missingCmds.join('、')}\n\n建议添加到系统 PATH:\n${missing.map(d => `${gitDir}\\${d === 'Git\\cmd' ? 'cmd' : d.replace('Git\\', '')}`).join('\n')}`,
      };
    }

    // 命令可用但 PATH 不够规范
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'warn',
      message: `Git PATH 不够规范，缺少 ${missing.join('、')}（命令暂时可用但不稳定）`,
      detail: `建议将以下目录加入系统 PATH:\n${missing.map(d => `  ${gitDir}\\${d.replace('Git\\', '')}`).join('\n')}`,
    };
  },
};

registerScanner(scanner);
