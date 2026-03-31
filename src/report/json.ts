import type { ScanResult, ScoreResult } from '../scanners/types';
import { CATEGORY_WEIGHTS } from '../scanners/types';
import { sanitize } from '../privacy/sanitizer';

export interface JsonReport {
  version: string;
  timestamp: string;
  score: ScoreResult;
  results: ScanResult[];
}

/** 生成 JSON 报告 */
export function generateJsonReport(results: ScanResult[], score: ScoreResult): string {
  const report: JsonReport = {
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    score,
    results: results.map(r => ({
      ...r,
      message: sanitize(r.message),
      detail: r.detail ? sanitize(r.detail) : undefined,
    })),
  };
  return JSON.stringify(report, null, 2);
}
