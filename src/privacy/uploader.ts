import type { ScanResult, ScoreResult } from '../scanners/types';
import { sanitize } from './sanitizer.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REPORT_DIR = join(homedir(), '.aicoevo', 'reports');

export interface UploadPayload {
  timestamp: string;
  score: number;
  results: Array<{
    id: string;
    status: string;
    message: string;
  }>;
}

/** 生成脱敏后的上传数据 */
export function createPayload(results: ScanResult[], score: ScoreResult): UploadPayload {
  return {
    timestamp: new Date().toISOString(),
    score: score.score,
    results: results.map(r => ({
      id: r.id,
      status: r.status,
      message: sanitize(r.message),
    })),
  };
}

/** 保存到本地（Phase 1 只存本地，Phase 2 再上传） */
export function saveLocal(payload: UploadPayload): string {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const filename = `scan-${Date.now()}.json`;
  const filepath = join(REPORT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
  return filepath;
}
