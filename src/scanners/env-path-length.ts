import type { Scanner, ScanResult } from './types';
import { registerScanner } from './registry';

/** 检查 PATH 环境变量长度 */
const scanner: Scanner = {
  id: 'env-path-length',
  name: 'PATH 长度检测',
  category: 'path',

  async scan(): Promise<ScanResult> {
    const pathVar = process.env.PATH || '';
    const length = pathVar.length;
    const entries = pathVar.split(';').filter(Boolean);
    const MAX_SAFE = 2048;

    if (length > MAX_SAFE) {
      // 检查重复项
      const seen = new Map<string, number>();
      for (const entry of entries) {
        const normalized = entry.toLowerCase().replace(/\\$/, '');
        seen.set(normalized, (seen.get(normalized) || 0) + 1);
      }
      const duplicates = [...seen.entries()].filter(([, count]) => count > 1);

      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: `PATH 过长 (${length} 字符，安全上限 ${MAX_SAFE})，含 ${entries.length} 个条目`,
        detail: duplicates.length > 0
          ? `重复项:\n${duplicates.map(([p, c]) => `  ${p} (x${c})`).join('\n')}`
          : undefined,
      };
    }
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `PATH 长度正常 (${length}/${MAX_SAFE} 字符，${entries.length} 个条目)`,
    };
  },
};

registerScanner(scanner);
