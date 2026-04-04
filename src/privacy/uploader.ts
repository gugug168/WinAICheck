import type { ScanResult, ScoreResult } from '../scanners/types';
import { sanitize } from './sanitizer.js';
import { collectSystemInfo, type SystemInfo } from '../scanners/system-info.js';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
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
  systemInfo: SystemInfo;
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
    systemInfo: collectSystemInfo(),
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

/** 读取最近一次扫描报告（不含当前） */
export function loadPreviousReport(): UploadPayload | null {
  if (!existsSync(REPORT_DIR)) return null;
  const files = readdirSync(REPORT_DIR)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length < 1) return null;
  try {
    const raw = require('fs').readFileSync(join(REPORT_DIR, files[0]), 'utf-8');
    return JSON.parse(raw) as UploadPayload;
  } catch {
    return null;
  }
}

/** 读取历史报告列表（最近 max 条） */
export function loadHistory(max = 10): Array<UploadPayload & { filename: string }> {
  if (!existsSync(REPORT_DIR)) return [];
  const files = readdirSync(REPORT_DIR)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, max);
  const results: Array<UploadPayload & { filename: string }> = [];
  for (const f of files) {
    try {
      const raw = require('fs').readFileSync(join(REPORT_DIR, f), 'utf-8');
      results.push({ ...JSON.parse(raw), filename: f });
    } catch { /* skip corrupt */ }
  }
  return results;
}
