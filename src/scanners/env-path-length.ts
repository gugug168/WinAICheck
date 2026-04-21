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
    const MAX_WARN = 4096;
    const MAX_FAIL = 8191;

    const seen = new Map<string, number>();
    for (const entry of entries) {
      const normalized = entry.toLowerCase().replace(/\\$/, '');
      seen.set(normalized, (seen.get(normalized) || 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);

    if (length > MAX_FAIL) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'misconfigured',
        message: `PATH 过长 (${length} 字符，接近系统上限 ${MAX_FAIL})`,
        detail: duplicates.length > 0
          ? `重复项:\n${duplicates.map(([p, c]) => `  ${p} (x${c})`).join('\n')}`
          : `PATH 条目数: ${entries.length}`,
      };
    }

    if (length > MAX_WARN || duplicates.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'misconfigured',
        message: `PATH 偏长或存在冗余 (${length} 字符，${entries.length} 个条目)`,
        detail: duplicates.length > 0
          ? `重复项:\n${duplicates.map(([p, c]) => `  ${p} (x${c})`).join('\n')}`
          : `建议保持在 ${MAX_WARN} 字符以内，避免继续膨胀`,
      };
    }
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `PATH 长度正常 (${length}/${MAX_WARN} 字符，${entries.length} 个条目)`,
    };
  },
};

registerScanner(scanner);
