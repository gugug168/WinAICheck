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
  version?: string | null;
  path?: string | null;
  fixCommand?: string | null;
  severity?: string | null;
}

/** Scanner 接口 */
export interface Scanner {
  id: string;
  name: string;
  category: ScannerCategory;
  affectsScore?: boolean;
  defaultEnabled?: boolean;
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
  actionLabel?: string;
  risk: string;
}

/** 备份数据，用于 rollback */
export interface BackupData {
  scannerId: string;
  timestamp: number;
  data: Record<string, string>; // 旧值键值对
}

/** Fixer 接口 (D-02, FIX-01) */
export interface Fixer {
  id?: string;
  scannerId: string;
  risk?: 'green' | 'yellow' | 'red';
  /** Check if this fixer can handle the given scan failure */
  canFix?(scanResult: ScanResult): boolean;
  /** Generate a fix suggestion for the given scan result */
  getFix(result: ScanResult): FixSuggestion;
  /** Backup state before applying fix */
  backup?(result: ScanResult): Promise<BackupData>;
  /** Execute the fix */
  execute(fix: FixSuggestion, backup: BackupData): Promise<FixResult>;
  /** Rollback on failure */
  rollback?(backup: BackupData): Promise<void>;
  /** Optional preflight checks */
  preflightChecks?: PreflightCheck[];
  /** Optional post-fix guidance */
  getGuidance?: () => PostFixGuidance | undefined;
  /** Optional verification commands */
  getVerificationCommand?: () => string | string[] | undefined;
}

/** 预检检查项 (D-15, DIA-02) */
export interface PreflightCheck {
  id: string;
  check: () => Promise<{ pass: boolean; message?: string }>;
}

/** Verification result states (D-05, VRF-02) */
export type VerificationStatus = 'pass' | 'warn' | 'fail';

/** 修复执行结果 */
export interface FixResult {
  success: boolean;
  message: string;
  rolledBack?: boolean;
  newScanResult?: ScanResult;
  /** 验证闭环：是否通过重扫确认修复生效 */
  verified?: boolean;
  /** 部分修复：执行成功但验证仍有警告 */
  partial?: boolean;
  /** 验证未通过时的下一步操作指引 */
  nextSteps?: string[];
  /** 修复后指导：需要用户做的后续操作（重启终端、验证命令等） */
  postFixGuidance?: PostFixGuidance;
}

/** 修复后指导 */
export interface PostFixGuidance {
  /** 是否需要重启终端 */
  needsTerminalRestart?: boolean;
  /** 是否需要重启电脑 */
  needsReboot?: boolean;
  /** 手动验证命令 */
  verifyCommands?: string[];
  /** 额外注意事项 */
  notes?: string[];
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
