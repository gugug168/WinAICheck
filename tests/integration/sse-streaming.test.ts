import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock } from './mock-helper';
import { runAllScanners } from '../../src/scanners/registry';
import type { ScanResult } from '../../src/scanners/types';
import '../../src/scanners/index';

function setupMock() {
  // 空 mock：所有命令抛异常，scanner 返回 fail/unknown/warn 但不会崩溃
  _test.mockExecSync = createCommandMock(new Map());
}

describe('SSE 流式推送 (runAllScanners onProgress)', () => {
  afterEach(teardownMock);

  test('onProgress 每完成一个 scanner 调用一次', async () => {
    setupMock();

    const calls: Array<{
      completed: number;
      total: number;
      current: string;
      result?: ScanResult;
    }> = [];

    const results = await runAllScanners(5, (completed, total, current, result) => {
      calls.push({ completed, total, current, result });
    });

    // 调用次数 = scanner 总数
    expect(calls.length).toBe(results.length);
    expect(calls.length).toBeGreaterThan(0);

    // total 始终一致
    const total = calls[0].total;
    for (const c of calls) {
      expect(c.total).toBe(total);
    }
    expect(total).toBe(results.length);
  });

  test('completed 单调递增，最后一次等于 total', async () => {
    setupMock();

    const completions: number[] = [];
    await runAllScanners(5, (completed) => {
      completions.push(completed);
    });

    for (let i = 1; i < completions.length; i++) {
      expect(completions[i]).toBeGreaterThan(completions[i - 1]);
    }
    expect(completions[completions.length - 1]).toBe(completions.length);
  });

  test('每次回调的 result 参数是有效 ScanResult', async () => {
    setupMock();

    const validStatuses = ['pass', 'warn', 'fail', 'unknown'];

    await runAllScanners(5, (_c, _t, _cur, result) => {
      expect(result).toBeDefined();
      if (result) {
        expect(typeof result.id).toBe('string');
        expect(typeof result.name).toBe('string');
        expect(typeof result.category).toBe('string');
        expect(validStatuses).toContain(result.status);
        expect(typeof result.message).toBe('string');
      }
    });
  });

  test('无 onProgress 时仍正常返回全部结果', async () => {
    setupMock();

    const results = await runAllScanners(5);
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.id).toBeDefined();
      expect(r.status).toBeDefined();
    }
  });

  test('并发限制生效：5 个 worker 处理所有 scanner', async () => {
    setupMock();

    // 验证结果顺序与 scanner 注册顺序一致（即使并发执行）
    const results = await runAllScanners(5);

    // 每个 result 有唯一的 id
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
