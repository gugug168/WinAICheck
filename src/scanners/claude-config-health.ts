import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { commandExists } from '../executor/index';
import { getClaudeMcpConfigCandidates, readJsonCandidate } from './config-utils';

const scanner: Scanner = {
  id: 'claude-config-health',
  name: 'Claude Code 配置检测',
  category: 'toolchain',
  affectsScore: false,
  defaultEnabled: false,

  async scan(): Promise<ScanResult> {
    const config = readJsonCandidate(getClaudeMcpConfigCandidates());
    const installed = commandExists('claude');

    if (!config) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: installed ? 'warn' : 'unknown',
        message: installed ? 'Claude Code 已安装，但未发现本地配置文件' : '未检测到 Claude Code 配置',
        detail: '默认检查 ~/.claude/mcp_settings.json 与项目内 .claude/mcp_settings.json。',
      };
    }

    if (config.error) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Claude Code 配置文件无法解析',
        detail: `文件: ${config.path}\n错误: ${config.error}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Claude Code 配置文件可解析',
      detail: `文件: ${config.path}`,
    };
  },
};

registerScanner(scanner);
