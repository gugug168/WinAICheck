import type { Scanner, ScanResult } from './types';
import { registerScanner } from './registry';

/** 检测代理配置 */
const scanner: Scanner = {
  id: 'proxy-config',
  name: '代理配置检测',
  category: 'network',

  async scan(): Promise<ScanResult> {
    const proxyVars = [
      'HTTP_PROXY', 'HTTPS_PROXY', 'FTP_PROXY',
      'http_proxy', 'https_proxy', 'ftp_proxy',
      'ALL_PROXY', 'all_proxy',
      'NO_PROXY', 'no_proxy',
    ];

    const found: string[] = [];
    for (const v of proxyVars) {
      const val = process.env[v];
      if (val) {
        found.push(`${v}=${val}`);
      }
    }

    if (found.length === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: '未检测到代理配置（直连模式）',
      };
    }

    // 检查是否配置了 NO_PROXY
    const hasNoProxy = process.env.NO_PROXY || process.env.no_proxy;

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: hasNoProxy ? 'pass' : 'warn',
      message: `检测到 ${found.length} 个代理环境变量${!hasNoProxy ? '（缺少 NO_PROXY）' : ''}`,
      detail: found.join('\n'),
      ...(hasNoProxy ? {} : { error_type: 'misconfigured' }),
    };
  },
};

registerScanner(scanner);
