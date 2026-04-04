import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { getClaudeMcpConfigCandidates, readJsonCandidate, canResolveCommand } from './config-utils';

const scanner: Scanner = {
  id: 'mcp-command-availability',
  name: 'MCP 启动命令检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    const config = readJsonCandidate(getClaudeMcpConfigCandidates());
    if (!config || config.error) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '未找到可用的 MCP 配置，跳过命令检测',
      };
    }

    const servers = config.data?.mcpServers;
    if (!servers || typeof servers !== 'object') {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: 'MCP 配置中未定义 server',
      };
    }

    const missing: string[] = [];
    const available: string[] = [];
    for (const [name, rawConfig] of Object.entries<any>(servers)) {
      const command = typeof rawConfig?.command === 'string' ? rawConfig.command : '';
      if (!command) {
        missing.push(`${name}: 未配置 command`);
        continue;
      }
      if (canResolveCommand(command)) available.push(`${name}: ${command}`);
      else missing.push(`${name}: ${command}`);
    }

    if (missing.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: available.length > 0 ? 'warn' : 'fail',
        message: '部分 MCP server 启动命令不可用',
        detail: `可用:\n${available.join('\n') || '(无)'}\n\n不可用:\n${missing.join('\n')}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `MCP 启动命令可用（${available.length} 个）`,
      detail: available.join('\n'),
    };
  },
};

registerScanner(scanner);
