import type { ScanResult, ScoreResult } from '../scanners/types';
import { CATEGORY_WEIGHTS } from '../scanners/types';
import { sanitize } from '../privacy/sanitizer';
import { VERSION } from '../constants';

export interface JsonReport {
  version: string;
  timestamp: string;
  score: ScoreResult;
  results: ScanResult[];
}

/** 生成 JSON 报告 */
export function generateJsonReport(results: ScanResult[], score: ScoreResult): string {
  const report: JsonReport = {
    version: VERSION,
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
