import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 DNS 解析 */
const scanner: Scanner = {
  id: 'dns-resolution',
  name: 'DNS 解析检测',
  category: 'network',

  async scan(): Promise<ScanResult> {
    const domains = [
      { domain: 'huggingface.co', name: 'HuggingFace' },
      { domain: 'github.com', name: 'GitHub' },
      { domain: 'pypi.org', name: 'PyPI' },
    ];

    const failed: string[] = [];
    const ok: string[] = [];

    for (const { domain, name } of domains) {
      const { stdout, exitCode } = runCommand(
        `nslookup ${domain}`,
        8000,
      );
      const failureHints = /Non-existent domain|can't find|timed out|server failed|NXDOMAIN/i;
      const blocks = stdout
        .split(/\r?\n\r?\n+/)
        .map(block => block.trim())
        .filter(Boolean);
      const answerSection = blocks.slice(1).join('\n\n');
      const hasAnswer = !!answerSection && /(?:\b\d{1,3}(?:\.\d{1,3}){3}\b|[a-f0-9:]{2,}:[a-f0-9:]{2,})/i.test(answerSection);

      if (exitCode === 0 && !failureHints.test(stdout) && hasAnswer) {
        ok.push(name);
      } else {
        failed.push(name);
      }
    }

    if (failed.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: failed.length === domains.length ? 'fail' : 'warn',
        message: `DNS 解析失败: ${failed.join(', ')}`,
        detail: failed.length < domains.length ? `正常: ${ok.join(', ')}` : '请检查 DNS 设置',
        error_type: 'network',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'DNS 解析正常',
    };
  },
};

registerScanner(scanner);
