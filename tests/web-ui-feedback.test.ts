import { describe, expect, test } from 'bun:test';
import { generateWebUI } from '../src/web/ui';
import type { ScanResult, ScoreResult } from '../src/scanners/types';

describe('web ui feedback layout', () => {
  test('反馈区位于修复建议之前，方便用户先提问题', () => {
    const score: ScoreResult = {
      score: 71,
      grade: 'good',
      label: '良好',
      breakdown: [],
    };
    const results: ScanResult[] = [
      {
        id: 'python-versions',
        name: 'Python 版本检测',
        category: 'toolchain',
        status: 'warn',
        message: 'Python 版本过旧 (3.7.0)，建议 3.8+',
      },
    ];

    const html = generateWebUI(results, score, 68, false);
    expect(html.indexOf('反馈与建议')).toBeGreaterThan(-1);
    expect(html.indexOf('修复建议')).toBeGreaterThan(-1);
    expect(html.indexOf('反馈与建议')).toBeLessThan(html.indexOf('修复建议'));
  }, 10_000);
});
