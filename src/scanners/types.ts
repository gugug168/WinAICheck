/** Scanner 类别 */
export type ScannerCategory =
  | 'path'        // 路径与系统环境，权重 ×1.5
  | 'toolchain'   // 核心工具链，权重 ×1.0
  | 'gpu'         // 显卡与子系统，权重 ×0.8
  | 'permission'  // 权限与安全，权重 ×1.2
  | 'network';    // 网络与镜像，权重 ×1.0

/** 检测状态 */
export type ScanStatus = 'pass' | 'fail' | 'warn' | 'unknown';

/** 单个扫描结果 */
export interface ScanResult {
  id: string;
  name: string;
  category: ScannerCategory;
  status: ScanStatus;
  message: string;
  detail?: string;
}

/** Scanner 接口 */
export interface Scanner {
  id: string;
  name: string;
  category: ScannerCategory;
  scan(): Promise<ScanResult>;
}

/** 修复风险等级 */
export type FixTier = 'green' | 'yellow' | 'red' | 'black';

/** 修复建议 */
export interface FixSuggestion {
  id: string;
  scannerId: string;
  tier: FixTier;
  description: string;
  commands?: string[];
  risk: string;
}

/** Fixer 接口 */
export interface Fixer {
  scannerId: string;
  getFix(result: ScanResult): FixSuggestion;
  execute?(fix: FixSuggestion): Promise<FixResult>;
}

/** 修复执行结果 */
export interface FixResult {
  success: boolean;
  message: string;
}

/** 类别权重映射 */
export const CATEGORY_WEIGHTS: Record<ScannerCategory, number> = {
  path: 1.5,
  toolchain: 1.0,
  gpu: 0.8,
  permission: 1.2,
  network: 1.0,
};

/** 评分等级 */
export type ScoreGrade = 'excellent' | 'good' | 'fair' | 'poor';

/** 评分结果 */
export interface ScoreResult {
  score: number;        // 0-100
  grade: ScoreGrade;
  label: string;        // 优秀/良好/一般/需改善
  breakdown: {
    category: ScannerCategory;
    passed: number;
    total: number;
    weight: number;
    weightedScore: number;
  }[];
}
