import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { runCommand } from '../executor/index';

const scanner: Scanner = {
  id: 'git-identity-config',
  name: 'Git 身份配置检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const name = runCommand('git config --global user.name', 5000);
    const email = runCommand('git config --global user.email', 5000);

    const userName = name.stdout.trim();
    const userEmail = email.stdout.trim();

    if (!userName || !userEmail) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'misconfigured',
        message: 'Git 全局身份未完整配置',
        detail: `user.name: ${userName || '(未设置)'}\nuser.email: ${userEmail || '(未设置)'}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Git 全局身份已配置',
      detail: `user.name: ${userName}\nuser.email: ${userEmail}`,
    };
  },
};

registerScanner(scanner);
