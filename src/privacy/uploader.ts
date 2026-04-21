import type { ScanResult, ScoreResult } from '../scanners/types';
import { sanitize } from './sanitizer.js';
import { collectSystemInfo, type SystemInfo } from '../scanners/system-info.js';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync, statSync as fs_statSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';

let resolvedReportDir: string | null = null;
let reportDirCandidatesOverride: string[] | null = null;

function getReportDirCandidates(): string[] {
  if (reportDirCandidatesOverride) {
    return [...new Set(reportDirCandidatesOverride.filter(Boolean))];
  }
  const candidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'WinAICheck', 'reports') : '',
    join(homedir(), '.aicoevo', 'reports'),
    join(process.cwd(), 'reports'),
    join(tmpdir(), 'WinAICheck', 'reports'),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

const writableDirCache = new Set<string>();

function ensureWritableDir(dir: string): boolean {
  if (writableDirCache.has(dir)) return true;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.probe-${process.pid}-${Date.now()}-${randomUUID()}.tmp`);
    writeFileSync(probe, 'ok', 'utf-8');
    unlinkSync(probe);
    writableDirCache.add(dir);
    return true;
  } catch {
    return false;
  }
}

function getReportDir(): string {
  if (resolvedReportDir && ensureWritableDir(resolvedReportDir)) return resolvedReportDir;

  for (const dir of getReportDirCandidates()) {
    if (ensureWritableDir(dir)) {
      resolvedReportDir = dir;
      return dir;
    }
  }

  resolvedReportDir = join(process.cwd(), 'reports');
  return resolvedReportDir;
}

function writePayloadFile(dir: string, payload: UploadPayload): string {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const unique = `${Date.now()}-${process.pid}-${attempt}-${randomUUID()}`;
    const filepath = join(dir, `scan-${unique}.json`);
    try {
      writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
      return filepath;
    } catch (error) {
      lastError = error;
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EBUSY') {
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法写入扫描报告');
}

export interface UploadPayload {
  timestamp: string;
  score: number;
  results: Array<{
    id: string;
    name: string;
    category: string;
    status: string;
    message: string;
    detail?: string;
    version?: string | null;
    severity?: string | null;
    fixCommand?: string | null;
  }>;
  systemInfo: SystemInfo;
}

/** 生成脱敏后的上传数据（与后端 claim 页校验对齐） */
export function createPayload(results: ScanResult[], score: ScoreResult): UploadPayload {
  return {
    timestamp: new Date().toISOString(),
    score: score.score,
    results: results.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      status: r.status,
      message: sanitize(r.message),
      detail: r.detail ? sanitize(r.detail) : undefined,
      version: r.version || null,
      severity: r.severity || null,
      fixCommand: r.fixCommand ? sanitize(r.fixCommand) : null,
    })),
    systemInfo: collectSystemInfo(),
  };
}

/** 保存到本地（Phase 1 只存本地，Phase 2 再上传） */
export function saveLocal(payload: UploadPayload): string {
  const dirs = [getReportDir(), ...getReportDirCandidates()].filter((dir, index, arr) => dir && arr.indexOf(dir) === index);
  const errors: string[] = [];

  for (const dir of dirs) {
    if (!ensureWritableDir(dir)) { errors.push(`${dir}: 不可写`); continue; }
    try {
      resolvedReportDir = dir;
      return writePayloadFile(dir, payload);
    } catch (e) {
      errors.push(`${dir}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
  }

  console.error(`WinAICheck: 扫描报告保存失败，所有候选目录均不可用:\n${errors.join('\n')}`);
  return '';
}

/** Stash API 响应 */
export interface StashResponse {
  token: string;
  claim_url: string;
  ttl_seconds: number;
}

/** 上传扫描数据到 AICOEVO stash API（与 MacAICheck stashData 对齐） */
export async function stashData(payload: UploadPayload, apiBase: string): Promise<StashResponse> {
  const fingerprint = JSON.stringify({
    platform: 'Windows',
    userAgent: `WinAICheck/${process.version}`,
    system: payload.systemInfo,
    score: payload.score,
    failCount: payload.results.filter(r => r.status === 'fail').length,
    failCategories: [...new Set(payload.results.filter(r => r.status === 'fail').map(r => r.category))],
  });

  const resp = await fetch(`${apiBase}/stash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      data: JSON.stringify(payload),
      fingerprint,
    }),
  });

  if (!resp.ok) {
    throw new Error(`stash upload failed: ${resp.status}`);
  }

  return resp.json() as Promise<StashResponse>;
}

/** 构建 claim URL */
export function buildClaimUrl(token: string, apiBase: string): string {
  const origin = apiBase.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  return `${origin}/claim?t=${token}`;
}

/** 读取最近一次扫描报告（不含当前） */
export function loadPreviousReport(): UploadPayload | null {
  const reportDir = getReportDir();
  if (!existsSync(reportDir)) return null;
  const files = readdirSync(reportDir)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .sort((a, b) => {
      const statA = fs_statSync(join(reportDir, a));
      const statB = fs_statSync(join(reportDir, b));
      return statB.mtimeMs - statA.mtimeMs;
    });
  if (files.length < 1) return null;
  try {
    const raw = readFileSync(join(reportDir, files[0]), 'utf-8');
    return JSON.parse(raw) as UploadPayload;
  } catch {
    return null;
  }
}

/** 读取历史报告列表（最近 max 条） */
export function loadHistory(max = 10): Array<UploadPayload & { filename: string }> {
  const reportDir = getReportDir();
  if (!existsSync(reportDir)) return [];
  const files = readdirSync(reportDir)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, max);
  const results: Array<UploadPayload & { filename: string }> = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(reportDir, f), 'utf-8');
      results.push({ ...JSON.parse(raw), filename: f });
    } catch { /* skip corrupt */ }
  }
  return results;
}

export const _testHelpers = {
  ensureWritableDir,
  getReportDirCandidates,
  resetReportDirState() {
    resolvedReportDir = null;
    reportDirCandidatesOverride = null;
    writableDirCache.clear();
  },
  setReportDirCandidates(candidates: string[] | null) {
    resolvedReportDir = null;
    reportDirCandidatesOverride = candidates;
  },
};
