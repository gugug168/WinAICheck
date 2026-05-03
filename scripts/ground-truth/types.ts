// scripts/ground-truth/types.ts

import type { ScanResult, ScanDiagnostic } from '../../src/scanners/types';

/** 单个检查点判定 */
export type CheckVerdict = 'correct' | 'incorrect' | 'partial' | 'skipped';

/** 单个检查点 */
export interface ValidationCheck {
  name: string;
  scannerStep: string;
  expectedValue: string;
  scannerValue: string;
  verdict: CheckVerdict;
  note?: string;
}

/** 验证器环境 */
export interface ValidatorEnv {
  windowsVersion: string;
  isAdmin: boolean;
  degradedMethods: string[];
}

/** 单个扫描器的完整验证报告 */
export interface ValidationReport {
  scannerId: string;
  scannerName: string;
  env: ValidatorEnv;
  checks: ValidationCheck[];
  overallVerdict: CheckVerdict;
  scannerResult: ScanResult;
  scannerDiagnostic?: ScanDiagnostic;
}

/** 验证器接口 */
export interface TruthValidator {
  id: string;
  name: string;
  validate(env: ValidatorEnv): Promise<ValidationReport>;
}

/** 降级链方法 */
export interface DegradableMethod<T> {
  name: string;
  execute: () => T;
  isAvailable: boolean;
}
