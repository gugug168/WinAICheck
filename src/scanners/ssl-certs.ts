import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 SSL 证书是否正常 */
const scanner: Scanner = {
  id: 'ssl-certs',
  name: 'SSL 证书检测',
  category: 'network',

  async scan(): Promise<ScanResult> {
    const sites = [
      { url: 'https://pypi.org', name: 'PyPI' },
      { url: 'https://registry.npmjs.org', name: 'npm' },
    ];

    const failed: string[] = [];
    const ok: string[] = [];

    for (const site of sites) {
      const { stdout, exitCode } = runCommand(
        `curl -Is --max-time 5 ${site.url}`,
        8000,
      );
      if (exitCode === 0 && /HTTP\/\d.*\s(200|301|302)/.test(stdout)) {
        ok.push(site.name);
      } else {
        failed.push(site.name);
      }
    }

    if (failed.length === sites.length) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: '所有站点 SSL 连接失败',
        detail: '可能是网络代理或证书问题',
        error_type: 'network',
      };
    }

    if (failed.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `部分站点 SSL 连接失败: ${failed.join(', ')}`,
        error_type: 'network',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'SSL 证书验证正常',
    };
  },
};

registerScanner(scanner);
