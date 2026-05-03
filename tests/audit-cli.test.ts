import { describe, it, expect } from 'bun:test';
import { parseArgs } from '../scripts/audit';

describe('parseArgs', () => {
  it('默认模式: --mode=scanners, 本地', () => {
    const config = parseArgs([]);
    expect(config.mode).toBe('scanners');
    expect(config.ci).toBe(false);
    expect(config.json).toBe(false);
  });

  it('--ci 启用 CI 模式', () => {
    const config = parseArgs(['--ci']);
    expect(config.ci).toBe(true);
  });

  it('--json 启用 JSON 输出', () => {
    const config = parseArgs(['--json']);
    expect(config.json).toBe(true);
  });

  it('--output 指定输出路径', () => {
    const config = parseArgs(['--output', 'report.json']);
    expect(config.outputPath).toBe('report.json');
  });

  it('--mode=fixers', () => {
    const config = parseArgs(['--mode=fixers']);
    expect(config.mode).toBe('fixers');
  });

  it('组合参数', () => {
    const config = parseArgs(['--ci', '--json', '--output', 'reports/audit.json']);
    expect(config.ci).toBe(true);
    expect(config.json).toBe(true);
    expect(config.outputPath).toBe('reports/audit.json');
  });
});
