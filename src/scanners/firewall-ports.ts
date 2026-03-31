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

    const blocked: string[] = [];
    const open: string[] = [];

    for (const { port, name } of ports) {
      const { stdout, exitCode } = runCommand(
        `netsh advfirewall firewall show rule name=all dir=in | findstr "${port}"`,
        8000,
      );
      // 简单检查：如果能找到规则就认为有配置
      if (exitCode === 0 && stdout.includes(String(port))) {
        open.push(`${name}(:${port})`);
      } else {
        blocked.push(`${name}(:${port})`);
      }
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: blocked.length > 0 ? 'warn' : 'pass',
      message: blocked.length > 0
        ? `${blocked.length} 个 AI 常用端口可能被防火墙阻止`
        : 'AI 常用端口防火墙配置正常',
      detail: blocked.length > 0
        ? `可能受阻: ${blocked.join(', ')}\n已开放: ${open.join(', ')}`
        : `已开放: ${open.join(', ')}`,
    };
  },
};

registerScanner(scanner);
