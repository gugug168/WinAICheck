import type { Scanner, ScanResult } from './types';

const scanners: Scanner[] = [];

/** 注册一个 scanner */
export function registerScanner(scanner: Scanner): void {
  scanners.push(scanner);
}

/** 获取所有已注册的 scanner */
export function getScanners(): Scanner[] {
  return [...scanners];
}

/** 按 ID 查找 scanner */
export function getScannerById(id: string): Scanner | undefined {
  return scanners.find(s => s.id === id);
}

/** 并发执行所有 scanner，限制并发数 */
export async function runAllScanners(
  limit = 5,
  onProgress?: (completed: number, total: number, current: string) => void,
): Promise<ScanResult[]> {
  const total = scanners.length;
  const results: ScanResult[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < total) {
      const idx = nextIndex++;
      const scanner = scanners[idx];

      try {
        results[idx] = await scanner.scan();
      } catch (err) {
        results[idx] = {
          id: scanner.id,
          name: scanner.name,
          category: scanner.category,
          status: 'unknown',
          message: `扫描出错: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      completed++;
      onProgress?.(completed, total, scanner.name);
    }
  }

  // 启动 limit 个并发 worker
  const workers = Array.from({ length: Math.min(limit, total) }, () => runNext());
  await Promise.all(workers);

  return results;
}
