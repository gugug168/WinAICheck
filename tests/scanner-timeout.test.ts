import { describe, expect, test } from 'bun:test';
import { _testHelpers } from '../src/scanners/registry';
import type { Scanner } from '../src/scanners/types';

describe('scanner timeout', () => {
  test('scanWithTimeout 超时后返回 unknown', async () => {
    const scanner: Scanner = {
      id: 'slow-test',
      name: '慢扫描器',
      category: 'network',
      async scan() {
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          id: 'slow-test',
          name: '慢扫描器',
          category: 'network',
          status: 'pass',
          message: '不应返回',
        };
      },
    };

    const result = await _testHelpers.scanWithTimeout(scanner, 5);

    expect(result.status).toBe('unknown');
    expect(result.message).toContain('扫描超时');
  });
});
