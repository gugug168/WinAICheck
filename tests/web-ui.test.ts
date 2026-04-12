import { describe, expect, test } from 'bun:test';
import { generateWebUI } from '../src/web/ui';
import type { ScanResult, ScoreResult } from '../src/scanners/types';

describe('web ui html generation', () => {
  test('浏览器脚本不包含 TypeScript 语法残留', () => {
    const score: ScoreResult = {
      score: 0,
      grade: 'fair',
      label: '准备扫描',
      breakdown: [],
    };

    const html = generateWebUI([], score, null, true);

    expect(html).not.toContain(' as HTML');
    expect(html).not.toContain('window as any');
    expect(html).not.toContain('catch(e: any)');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('?.');
    expect(html).toContain('window.__autoStartScan = true;');
    expect(html).toContain('setTimeout(function() {');
    expect(html).toContain('rescan();');
    expect(html).toContain('scrollToFeedback()');
    expect(html).toContain('getStreamReader');
    expect(html).toContain('/api/scan-full');
    expect(html).toContain('Agent 进化');
    expect(html).toContain('/api/agent/enable');
    expect(html).toContain('/api/agent/status');
    expect(html).toContain('setScanRunning');
    expect(html).toContain('scanEndedWithDone');
    expect(html).not.toContain("card.scrollIntoView({behavior:'smooth',block:'end'});");
  });

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
  });
});
