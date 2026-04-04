import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测常用端口防火墙规则 */
const scanner: Scanner = {
  id: 'firewall-ports',
  name: '防火墙端口检测',
  category: 'permission',

  async scan(): Promise<ScanResult> {
    // AI 常用端口
    const ports = [
      { port: 22, name: 'SSH' },
      { port: 443, name: 'HTTPS' },
      { port: 7860, name: 'Gradio/WebUI' },
      { port: 8888, name: 'Jupyter' },
      { port: 11434, name: 'Ollama' },
    ];

    const configured: string[] = [];
    const missing: string[] = [];
    const { stdout, exitCode } = runCommand(
      'netsh advfirewall firewall show rule name=all verbose',
      15000,
    );

    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法读取防火墙规则',
      };
    }

    const blocks = stdout
      .split(/\r?\n(?=(?:Rule Name|规则名称)\s*:)/)
      .map(block => block.trim())
      .filter(Boolean);

    for (const { port, name } of ports) {
      const hasAllowRule = blocks.some(block => {
        const mentionsPort = new RegExp(`\\b${port}\\b`).test(block);
        const allowsInbound = /(Direction|方向)\s*:\s*(In|Inbound|入站)/i.test(block)
          && /(Action|操作)\s*:\s*(Allow|允许)/i.test(block)
          && /(Enabled|已启用)\s*:\s*(Yes|是)/i.test(block);
        const fallbackAllow = mentionsPort && /(Allow|允许)/i.test(block);
        return mentionsPort && (allowsInbound || fallbackAllow);
      });

      if (hasAllowRule) configured.push(`${name}(:${port})`);
      else missing.push(`${name}(:${port})`);
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: missing.length > 0 ? 'warn' : 'pass',
      message: missing.length > 0
        ? `${missing.length} 个 AI 常用端口未发现显式入站放行规则`
        : 'AI 常用端口防火墙配置正常',
      detail: missing.length > 0
        ? `未显式放行: ${missing.join(', ')}\n已显式放行: ${configured.join(', ')}\n\n说明: 这不等同于端口一定被阻止；本地回环访问通常无需单独放行规则。`
        : `已显式放行: ${configured.join(', ')}`,
    };
  },
};

registerScanner(scanner);
