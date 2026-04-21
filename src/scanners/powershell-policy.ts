import type { Scanner, ScanResult } from './types';
import { runCommand, runPS } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 PowerShell 执行策略 */
const scanner: Scanner = {
  id: 'powershell-policy',
  name: 'PowerShell 执行策略检测',
  category: 'permission',

  async scan(): Promise<ScanResult> {
    // 方法1: 直接用 PowerShell 命令
    let policy = runPS('Get-ExecutionPolicy', 5000).trim();

    // 方法2: 如果方法1失败，尝试通过注册表查询
    if (!policy || policy.includes('错误') || policy.includes('Error') || policy.includes('Exception')) {
      const regOutput = runCommand(
        'reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell" /v ExecutionPolicy 2>nul',
        5000,
      ).stdout;
      const match = regOutput.match(/ExecutionPolicy\s+REG_SZ\s+(\S+)/);
      if (match) policy = match[1];
    }

    // 方法3: 查询当前用户的执行策略
    if (!policy) {
      const regOutput = runCommand(
        'reg query "HKCU\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell" /v ExecutionPolicy 2>nul',
        5000,
      ).stdout;
      const match = regOutput.match(/ExecutionPolicy\s+REG_SZ\s+(\S+)/);
      if (match) policy = match[1];
    }

    if (!policy) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法获取 PowerShell 执行策略',
      };
    }

    const restricted = ['Restricted', 'AllSigned'];
    const ok = ['RemoteSigned', 'Unrestricted', 'Bypass'];

    if (restricted.includes(policy)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: `PowerShell 执行策略为 "${policy}"，将阻止脚本运行`,
        detail: '建议执行: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser',
        error_type: 'misconfigured',
      };
    }

    if (ok.includes(policy)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `PowerShell 执行策略正常 (${policy})`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'warn',
      message: `PowerShell 执行策略: ${policy}`,
    };
  },
};

registerScanner(scanner);
