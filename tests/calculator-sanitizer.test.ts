import { describe, it, expect } from 'bun:test';
import { calculateScore } from '../src/scoring/calculator';
import type { ScanResult } from '../src/scanners/types';
import { sanitize, detectSensitive } from '../src/privacy/sanitizer';
import '../src/scanners/index';

// ==================== Scoring Calculator ====================

function makeResult(overrides: Partial<ScanResult> & { id: string; category: ScanResult['category'] }): ScanResult {
  return {
    name: overrides.id,
    status: 'pass',
    message: 'ok',
    ...overrides,
  };
}

describe('calculateScore', () => {
  it('全部通过 = 100 分', () => {
    const results: ScanResult[] = [
      makeResult({ id: 'a', category: 'path', status: 'pass' }),
      makeResult({ id: 'b', category: 'toolchain', status: 'pass' }),
      makeResult({ id: 'c', category: 'gpu', status: 'pass' }),
      makeResult({ id: 'd', category: 'permission', status: 'pass' }),
      makeResult({ id: 'e', category: 'network', status: 'pass' }),
    ];
    const { score, grade } = calculateScore(results);
    expect(score).toBe(100);
    expect(grade).toBe('excellent');
  });

  it('全部失败 = 0 分', () => {
    const results: ScanResult[] = [
      makeResult({ id: 'a', category: 'path', status: 'fail' }),
      makeResult({ id: 'b', category: 'toolchain', status: 'fail' }),
      makeResult({ id: 'c', category: 'gpu', status: 'fail' }),
      makeResult({ id: 'd', category: 'permission', status: 'fail' }),
      makeResult({ id: 'e', category: 'network', status: 'fail' }),
    ];
    const { score, grade } = calculateScore(results);
    expect(score).toBe(0);
    expect(grade).toBe('poor');
  });

  it('unknown 不计入分母', () => {
    // 只有 1 个 pass，1 个 unknown
    const results: ScanResult[] = [
      makeResult({ id: 'a', category: 'path', status: 'pass' }),
      makeResult({ id: 'b', category: 'toolchain', status: 'unknown' }),
    ];
    const { score, breakdown } = calculateScore(results);
    // path 权重 1.5, toolchain 被排除
    // 只有 path 通过，总分 = (1.5/1.5) * 100 = 100
    expect(score).toBe(100);
    // toolchain breakdown total 应为 0
    const tcBreakdown = breakdown.find(b => b.category === 'toolchain');
    expect(tcBreakdown?.total).toBe(0);
  });

  it('权重正确影响分数', () => {
    // path(×1.5) 失败，其余通过
    const results: ScanResult[] = [
      makeResult({ id: 'a', category: 'path', status: 'fail' }),
      makeResult({ id: 'b', category: 'toolchain', status: 'pass' }),
      makeResult({ id: 'c', category: 'gpu', status: 'pass' }),
      makeResult({ id: 'd', category: 'permission', status: 'pass' }),
      makeResult({ id: 'e', category: 'network', status: 'pass' }),
    ];
    const { score, breakdown } = calculateScore(results);
    // 总权重 = 1.5 + 1.0 + 0.8 + 1.2 + 1.0 = 5.5
    // 通过权重 = 0 + 1.0 + 0.8 + 1.2 + 1.0 = 4.0
    // 分数 = (4.0 / 5.5) * 100 = 72.7 → 73
    expect(score).toBe(73);
    expect(breakdown.length).toBe(5);
  });

  it('空结果 = 0 分', () => {
    const { score, grade } = calculateScore([]);
    expect(score).toBe(0);
    expect(grade).toBe('poor');
  });

  it('分级阈值正确', () => {
    // 构造精确到边界的分数
    const results90: ScanResult[] = [
      // path(1.5) pass, toolchain(1.0) pass, gpu(0.8) fail, permission(1.2) pass, network(1.0) pass
      makeResult({ id: 'a', category: 'path', status: 'pass' }),
      makeResult({ id: 'b', category: 'toolchain', status: 'pass' }),
      makeResult({ id: 'c', category: 'gpu', status: 'fail' }),
      makeResult({ id: 'd', category: 'permission', status: 'pass' }),
      makeResult({ id: 'e', category: 'network', status: 'pass' }),
    ];
    // (1.5+1.0+0+1.2+1.0)/(1.5+1.0+0.8+1.2+1.0) = 4.7/5.5 = 85.45 → 85
    const r90 = calculateScore(results90);
    expect(r90.score).toBe(85);
    expect(r90.grade).toBe('good');
  });

  it('warn 不算通过也不算失败', () => {
    const results: ScanResult[] = [
      makeResult({ id: 'a', category: 'path', status: 'pass' }),
      makeResult({ id: 'b', category: 'toolchain', status: 'warn' }),
    ];
    const { score } = calculateScore(results);
    // path pass (1.5), toolchain warn → 不算 pass
    // (1.5 / (1.5 + 1.0)) * 100 = 60
    expect(score).toBe(60);
  });

  it('可选工具 warn 不进入分母', () => {
    const results: ScanResult[] = [
      makeResult({ id: 'path-chinese', category: 'path', status: 'pass' }),
      makeResult({ id: 'openclaw', category: 'toolchain', status: 'warn' }),
      makeResult({ id: 'ccswitch', category: 'toolchain', status: 'warn' }),
    ];
    const { score, breakdown } = calculateScore(results);
    expect(score).toBe(100);
    const tcBreakdown = breakdown.find(b => b.category === 'toolchain');
    expect(tcBreakdown?.total).toBe(0);
  });

  it('breakdown 包含每类统计', () => {
    const results: ScanResult[] = [
      makeResult({ id: 'a', category: 'path', status: 'pass' }),
      makeResult({ id: 'b', category: 'path', status: 'fail' }),
      makeResult({ id: 'c', category: 'gpu', status: 'pass' }),
    ];
    const { breakdown } = calculateScore(results);
    const pathBd = breakdown.find(b => b.category === 'path');
    expect(pathBd?.passed).toBe(1);
    expect(pathBd?.total).toBe(2);
    const gpuBd = breakdown.find(b => b.category === 'gpu');
    expect(gpuBd?.passed).toBe(1);
    expect(gpuBd?.total).toBe(1);
  });
});

// ==================== Sanitizer ====================

describe('sanitizer', () => {
  it('移除 API Key', () => {
    const input = 'config with sk-abc123def456ghi789jkl012mno345';
    const output = sanitize(input);
    expect(output).not.toContain('sk-abc123');
    expect(output).toContain('<API_KEY>');
  });

  it('移除 Bearer Token', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test';
    const output = sanitize(input);
    expect(output).not.toContain('eyJhbGci');
    expect(output).toContain('Bearer <TOKEN>');
  });

  it('替换 Windows 用户名路径', () => {
    const input = '路径: C:\\Users\\张三\\project';
    const output = sanitize(input);
    expect(output).not.toContain('张三');
    expect(output).toContain('C:\\Users\\<USER>\\project');
  });

  it('替换 IP 地址', () => {
    const input = '连接到 192.168.1.100 失败';
    const output = sanitize(input);
    expect(output).not.toContain('192.168.1.100');
    expect(output).toContain('<IP>');
  });

  it('替换邮箱', () => {
    const input = '联系 admin@example.com 获取帮助';
    const output = sanitize(input);
    expect(output).not.toContain('admin@example.com');
    expect(output).toContain('<EMAIL>');
  });

  it('不修改正常文本', () => {
    const input = 'Git 正常 (2.51.1)';
    expect(sanitize(input)).toBe(input);
  });

  it('detectSensitive 正确检测', () => {
    const { found, items } = detectSensitive('key: sk-abc123def456ghi789jkl012mno345 and ip: 1.2.3.4');
    expect(found).toBe(true);
    expect(items).toContain('API Key');
    expect(items).toContain('IP 地址');
  });

  it('detectSensitive 正常文本不触发', () => {
    const { found } = detectSensitive('Node.js v22.22.2 正常');
    expect(found).toBe(false);
  });

  it('多层嵌套脱敏', () => {
    const input = '用户 C:\\Users\\John 使用 sk-abc123def456ghi789jkl012 连接 10.0.0.1';
    const output = sanitize(input);
    expect(output).not.toContain('John');
    expect(output).not.toContain('sk-abc');
    expect(output).not.toContain('10.0.0.1');
    expect(output).toContain('<USER>');
    expect(output).toContain('<API_KEY>');
    expect(output).toContain('<IP>');
  });
});
