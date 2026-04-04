import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { commandExists } from '../executor/index';
import { collectSecretLeaves, getOpenClawConfigCandidates, looksLikePlaceholderSecret, readJsonCandidate } from './config-utils';

const AUTH_ENV_VARS = ['OPENCLAW_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

const scanner: Scanner = {
  id: 'openclaw-config-health',
  name: 'OpenClaw 配置检测',
  category: 'toolchain',
  affectsScore: false,
  defaultEnabled: false,

  async scan(): Promise<ScanResult> {
    const config = readJsonCandidate(getOpenClawConfigCandidates());
    const installed = commandExists('openclaw');
    const envHints = AUTH_ENV_VARS
      .filter(name => !!process.env[name])
      .map(name => `${name}=${looksLikePlaceholderSecret(process.env[name]) ? '<placeholder>' : '<configured>'}`);

    if (!config) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: installed && envHints.length === 0 ? 'warn' : 'unknown',
        message: installed && envHints.length === 0 ? 'OpenClaw 已安装，但未发现可用配置或认证线索' : '未检测到 OpenClaw 配置',
        detail: envHints.length > 0 ? `环境变量:\n${envHints.join('\n')}` : '检查路径: 项目 .openclaw.json、.openclaw/config.json、用户目录配置。',
      };
    }

    if (config.error) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'OpenClaw 配置文件无法解析',
        detail: `文件: ${config.path}\n错误: ${config.error}`,
      };
    }

    const placeholders = collectSecretLeaves(config.data)
      .filter(item => /key|token|secret/i.test(item.key) && looksLikePlaceholderSecret(item.value));

    if (placeholders.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'OpenClaw 配置包含明显占位密钥',
        detail: `文件: ${config.path}\n占位字段:\n${placeholders.map(item => item.key).join('\n')}`,
      };
    }

    if (envHints.length === 0 && !collectSecretLeaves(config.data).some(item => /key|token|secret/i.test(item.key))) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: installed ? 'warn' : 'unknown',
        message: 'OpenClaw 配置可解析，但未发现认证字段',
        detail: `文件: ${config.path}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'OpenClaw 配置可解析，且检测到认证线索',
      detail: `文件: ${config.path}${envHints.length > 0 ? `\n环境变量:\n${envHints.join('\n')}` : ''}`,
    };
  },
};

registerScanner(scanner);
