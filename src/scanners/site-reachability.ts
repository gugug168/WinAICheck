import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 AI 相关网站连通性 */
const scanner: Scanner = {
  id: 'site-reachability',
  name: 'AI 站点连通性检测',
  category: 'network',

  async scan(): Promise<ScanResult> {
    const sites = [
      { url: 'https://huggingface.co', name: 'HuggingFace' },
      { url: 'https://github.com', name: 'GitHub' },
      { url: 'https://api.openai.com', name: 'OpenAI' },
    ];

    const unreachable: string[] = [];
    const reachable: string[] = [];

    for (const site of sites) {
      const { exitCode } = runCommand(
        `curl -Is --max-time 5 ${site.url}`,
        8000,
      );
      if (exitCode === 0) {
        reachable.push(site.name);
      } else {
        unreachable.push(site.name);
      }
    }

    if (unreachable.length === sites.length) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'network',
        message: '所有 AI 站点不可达',
        detail: '请检查网络连接或代理设置',
      };
    }

    if (unreachable.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'network',
        message: `不可达: ${unreachable.join(', ')}`,
        detail: `可达: ${reachable.join(', ')}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '所有 AI 站点可达',
    };
  },
};

registerScanner(scanner);
