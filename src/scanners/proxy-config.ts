import type { Scanner, ScanResult } from './types';
import { registerScanner } from './registry';

/** 检测代理配置 */
const scanner: Scanner = {
  id: 'proxy-config',
  name: '代理配置检测',
  category: 'network',

  async scan(): Promise<ScanResult> {
    const proxyVars = [
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
      'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    ];
    const found: string[] = [];
    for (const v of proxyVars) {
      const val = process.env[v];
      if (val) found.push(`${v}=${val}`);
    }

    // 2. 检查 Windows 注册表系统代理
    let regProxy = '';
    try {
      const { runReg } = await import('../executor/index');
      const regOut = runReg('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings');
      if (regOut.includes('ProxyEnable') && regOut.includes('0x1')) {
        const match = regOut.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
        if (match) regProxy = match[1].trim();
      }
    } catch {
      // 忽略注册表查询失败
    }

    if (found.length === 0 && !regProxy) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: '未检测到代理配置（直连模式）',
      };
    }

    if (regProxy) found.push(`SystemProxy=${regProxy}`);

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
