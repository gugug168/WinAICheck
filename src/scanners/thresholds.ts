/**
 * 集中式扫描器阈值配置
 *
 * 所有版本门槛、正则模式等常量统一在此维护，
 * 避免各 scanner 文件硬编码导致不一致。
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  /** Git 最低版本 */
  git: {
    minVersion: '2.30',
  },

  /** GPU 驱动最低主版本号（NVIDIA） */
  gpu_driver: {
    minDriverMajor: 525,
  },

  /** Node.js 最低主版本号 */
  node: {
    minMajor: 18,
  },

  /** 镜像源检测正则 */
  mirror_sources: {
    /** pip 国内镜像关键词匹配 */
    pipMirrorPattern:
      /tsinghua|aliyun|douban|tencent|huawei|index\.url\s*=/i,
    /** npm 默认（官方）源匹配 */
    npmDefaultPattern: /registry\.npmjs\.org/,
  },
} as const;

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * 比较两个版本号字符串。
 *
 * @returns 正数 → a > b，负数 → a < b，0 → 相等
 *
 * 规则：
 * - "unknown" / 空字符串视为 [0]，即永远小于任何真实版本
 * - 版本段数不同时以 0 补齐（"2.30" 与 "2.30.0" 视为相等）
 * - 非数字段视为 0
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    if (!v || v.toLowerCase() === 'unknown') return [0];
    return v.split('.').map(seg => {
      const n = Number(seg);
      return Number.isNaN(n) ? 0 : n;
    });
  };

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }

  return 0;
}
