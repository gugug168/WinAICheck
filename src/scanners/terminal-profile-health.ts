import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { commandExists } from '../executor/index';
import { getWindowsTerminalSettingsCandidates, readJsonCandidate } from './config-utils';

const scanner: Scanner = {
  id: 'terminal-profile-health',
  name: 'Windows Terminal 默认配置检测',
  category: 'permission',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    if (!commandExists('wt')) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '未检测到 Windows Terminal，跳过默认终端配置检查',
      };
    }

    const settings = readJsonCandidate(getWindowsTerminalSettingsCandidates());
    if (!settings) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '未找到 Windows Terminal 配置文件',
      };
    }

    if (settings.error) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Windows Terminal 配置无法解析',
        detail: `文件: ${settings.path}\n错误: ${settings.error}`,
      };
    }

    const defaultProfile = settings.data?.defaultProfile;
    const profiles = settings.data?.profiles?.list;
    const profile = Array.isArray(profiles) ? profiles.find((item: any) => item.guid === defaultProfile) : null;
    const commandline = typeof profile?.commandline === 'string' ? profile.commandline : '';
    const name = typeof profile?.name === 'string' ? profile.name : '';
    const usesPwsh = /pwsh/i.test(commandline) || /PowerShell/i.test(name);

    if (!profile) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'Windows Terminal 默认 profile 无法匹配到有效配置',
        detail: `文件: ${settings.path}`,
      };
    }

    if (!usesPwsh) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'Windows Terminal 默认 profile 不是 PowerShell 7',
        detail: `默认 profile: ${name || defaultProfile}\ncommandline: ${commandline || '(未配置)'}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Windows Terminal 默认 profile 已指向 PowerShell 7',
      detail: `默认 profile: ${name || defaultProfile}`,
    };
  },
};

registerScanner(scanner);
