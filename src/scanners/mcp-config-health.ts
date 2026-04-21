import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { commandExists } from '../executor/index';
import { getClaudeMcpConfigCandidates, readJsonCandidate } from './config-utils';

const scanner: Scanner = {
  id: 'mcp-config-health',
  name: 'MCP 配置健康检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    const config = readJsonCandidate(getClaudeMcpConfigCandidates());
    const claudeInstalled = commandExists('claude');

    if (!config) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: claudeInstalled ? 'warn' : 'unknown',
        message: claudeInstalled ? '未发现 Claude Code MCP 配置文件' : '未检测到 MCP 配置',
        detail: '建议检查 ~/.claude/mcp_settings.json 或项目内 .claude/mcp_settings.json',
      };
    }

    if (config.error) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'misconfigured',
        message: 'MCP 配置文件无法解析',
        detail: `文件: ${config.path}\n错误: ${config.error}`,
      };
    }

    const servers = config.data?.mcpServers;
    const count = servers && typeof servers === 'object' ? Object.keys(servers).length : 0;
    if (count === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'MCP 配置存在，但未定义任何 server',
        detail: `文件: ${config.path}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `MCP 配置正常（${count} 个 server）`,
      detail: `文件: ${config.path}`,
    };
  },
};

registerScanner(scanner);
