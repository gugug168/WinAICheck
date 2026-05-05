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

  test('诊断页提供吸顶导航和更清晰的后续路线', () => {
    const score: ScoreResult = {
      score: 61,
      grade: 'fair',
      label: '一般',
      breakdown: [],
    };
    const results: ScanResult[] = [
      {
        id: 'mirror-sources',
        name: '镜像源配置检测',
        category: 'network',
        status: 'warn',
        message: '1 个包管理器未配置国内镜像',
      },
      {
        id: 'cpp-compiler',
        name: 'C/C++ 编译器检测',
        category: 'toolchain',
        status: 'fail',
        message: '未检测到 C/C++ 编译器（MSVC 或 GCC）',
      },
    ];

    const html = generateWebUI(results, score, 58, false);
    expect(html).toContain('后续路线');
    expect(html).toContain('接入 aicoevo 持续优化');
    expect(html).toContain("scrollToDiagSection('diag-fixes')");
    expect(html).toContain("scrollToDiagSection('diag-details')");
    expect(html).toContain("focusScanner('cpp-compiler')");
    expect(html).toContain('点击定位到对应检测项');
    expect(html).toContain('查看并执行');
  }, 10_000);
});
