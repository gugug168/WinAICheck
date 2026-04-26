import { describe, expect, test } from 'bun:test';
import { generateWebUI } from '../src/web/ui';
import type { ScoreResult } from '../src/scanners/types';

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
    expect(html).toContain('/api/agent/loop/start');
    expect(html).toContain('/api/agent/loop/stop');
    expect(html).toContain('/api/agent/loop/run-once');
    expect(html).toContain('/api/agent/strategy');
    expect(html).toContain('开启持续守护');
    expect(html).toContain('立即分析一次');
    expect(html).toContain('agent-strategy');
    expect(html).toContain('setScanRunning');
    expect(html).toContain('scanEndedWithDone');
    expect(html).toContain('data.success && data.verified !== false && fix.scannerId');
    expect(html).not.toContain("card.scrollIntoView({behavior:'smooth',block:'end'});");
  }, 10_000);
});
