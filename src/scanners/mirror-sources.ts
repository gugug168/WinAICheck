import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Scanner, ScanResult } from './types';
import { registerScanner } from './registry';

/** 检测 pip/npm 镜像源配置 */
const scanner: Scanner = {
  id: 'mirror-sources',
  name: '镜像源配置检测',
  category: 'network',

  async scan(): Promise<ScanResult> {
    const mirrors: string[] = [];
    const noMirror: string[] = [];

    // 检查 pip 镜像
    const pipPaths = [
      join(homedir(), 'pip', 'pip.ini'),
      join(homedir(), 'AppData', 'Roaming', 'pip', 'pip.ini'),
    ];
    const pipFile = pipPaths.find(p => existsSync(p));
    if (pipFile) {
      const content = readFileSync(pipFile, 'utf-8');
      if (/tsinghua|aliyun|douban|tencent|index\.url\s*=/i.test(content)) {
        mirrors.push('pip: 已配置镜像');
      } else {
        noMirror.push('pip: 未配置国内镜像');
      }
    } else {
      noMirror.push('pip: 未找到 pip.ini');
    }

    // 检查 npm 镜像
    const npmrcPath = join(homedir(), '.npmrc');
    if (existsSync(npmrcPath)) {
      const content = readFileSync(npmrcPath, 'utf-8');
      if (/registry/.test(content) && !/registry\.npmjs\.org/.test(content)) {
        mirrors.push('npm: 已配置镜像');
      } else {
        noMirror.push('npm: 使用默认源');
      }
    } else {
      noMirror.push('npm: 未找到 .npmrc');
    }

    if (noMirror.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `${noMirror.length} 个包管理器未配置国内镜像`,
        detail: [...mirrors, ...noMirror].join('\n'),
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '镜像源配置完善',
      detail: mirrors.join('\n'),
    };
  },
};

registerScanner(scanner);
