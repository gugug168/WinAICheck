import { existsSync } from 'fs';
import { join } from 'path';
import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { runCommand } from '../executor/index';
import { getHomeDir } from './config-utils';

const scanner: Scanner = {
  id: 'git-credential-health',
  name: 'Git 凭据链路检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    const helper = runCommand('git config --global credential.helper', 5000).stdout.trim();
    const home = getHomeDir();
    const sshDir = join(home, '.ssh');
    const keyCandidates = ['id_ed25519', 'id_rsa', 'id_ecdsa']
      .map(name => join(sshDir, name))
      .filter(existsSync);

    if (!helper && keyCandidates.length === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: '未检测到 Git 凭据助手或 SSH Key',
        detail: '可使用 HTTPS credential helper，或在 ~/.ssh 中配置 id_ed25519 / id_rsa。',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Git 凭据链路存在',
      detail: `credential.helper: ${helper || '(未配置)'}\nSSH Keys: ${keyCandidates.length > 0 ? keyCandidates.join(', ') : '(未检测到)'}`,
    };
  },
};

registerScanner(scanner);
