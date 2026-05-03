import { describe, it, expect } from 'bun:test';
import { aggregateVerdict, tryMethods } from '../scripts/ground-truth/runner';
import type { ValidationCheck, ValidatorEnv, DegradableMethod } from '../scripts/ground-truth/types';

// ==================== aggregateVerdict tests ====================

describe('aggregateVerdict', () => {
  it('全部 correct → correct', () => {
    const checks: ValidationCheck[] = [
      { name: 'a', scannerStep: 'step1', expectedValue: '1', scannerValue: '1', verdict: 'correct' },
      { name: 'b', scannerStep: 'step2', expectedValue: '2', scannerValue: '2', verdict: 'correct' },
    ];
    expect(aggregateVerdict(checks)).toBe('correct');
  });

  it('任一 incorrect → incorrect', () => {
    const checks: ValidationCheck[] = [
      { name: 'a', scannerStep: 'step1', expectedValue: '1', scannerValue: '1', verdict: 'correct' },
      { name: 'b', scannerStep: 'step2', expectedValue: '2', scannerValue: '3', verdict: 'incorrect' },
    ];
    expect(aggregateVerdict(checks)).toBe('incorrect');
  });

  it('有 partial 无 incorrect → partial', () => {
    const checks: ValidationCheck[] = [
      { name: 'a', scannerStep: 'step1', expectedValue: '1', scannerValue: '1', verdict: 'correct' },
      { name: 'b', scannerStep: 'step2', expectedValue: '2', scannerValue: '2', verdict: 'partial' },
    ];
    expect(aggregateVerdict(checks)).toBe('partial');
  });

  it('全部 skipped → skipped', () => {
    const checks: ValidationCheck[] = [
      { name: 'a', scannerStep: 'step1', expectedValue: '', scannerValue: '', verdict: 'skipped' },
    ];
    expect(aggregateVerdict(checks)).toBe('skipped');
  });

  it('空数组 → skipped', () => {
    expect(aggregateVerdict([])).toBe('skipped');
  });

  it('优先级: incorrect > partial > correct > skipped', () => {
    const mixed: ValidationCheck[] = [
      { name: 'a', scannerStep: 's', expectedValue: '1', scannerValue: '1', verdict: 'correct' },
      { name: 'b', scannerStep: 's', expectedValue: '2', scannerValue: '2', verdict: 'partial' },
      { name: 'c', scannerStep: 's', expectedValue: '3', scannerValue: '4', verdict: 'incorrect' },
      { name: 'd', scannerStep: 's', expectedValue: '', scannerValue: '', verdict: 'skipped' },
    ];
    expect(aggregateVerdict(mixed)).toBe('incorrect');
  });

  it('correct + skipped → correct (只要有 correct)', () => {
    const checks: ValidationCheck[] = [
      { name: 'a', scannerStep: 's', expectedValue: '1', scannerValue: '1', verdict: 'correct' },
      { name: 'b', scannerStep: 's', expectedValue: '', scannerValue: '', verdict: 'skipped' },
    ];
    expect(aggregateVerdict(checks)).toBe('correct');
  });
});

// ==================== tryMethods tests ====================

describe('tryMethods', () => {
  const makeEnv = (): ValidatorEnv => ({
    windowsVersion: '10.0.22631',
    isAdmin: true,
    degradedMethods: [],
  });

  it('首选方法成功 → 返回结果，不记录降级', () => {
    const env = makeEnv();
    const result = tryMethods<string>([
      { name: 'method-a', execute: () => 'result-a', isAvailable: true },
      { name: 'method-b', execute: () => 'result-b', isAvailable: true },
    ], env);
    expect(result.result).toBe('result-a');
    expect(result.usedMethod).toBe('method-a');
    expect(env.degradedMethods).toEqual([]);
  });

  it('首选不可用 → 降级到备选', () => {
    const env = makeEnv();
    const result = tryMethods<string>([
      { name: 'method-a', execute: () => 'result-a', isAvailable: false },
      { name: 'method-b', execute: () => 'result-b', isAvailable: true },
    ], env);
    expect(result.result).toBe('result-b');
    expect(result.usedMethod).toBe('method-b');
    expect(env.degradedMethods).toContain('method-a');
  });

  it('全部不可用 → 返回 null', () => {
    const env = makeEnv();
    const result = tryMethods<string>([
      { name: 'method-a', execute: () => 'x', isAvailable: false },
      { name: 'method-b', execute: () => 'x', isAvailable: false },
    ], env);
    expect(result.result).toBeNull();
    expect(result.usedMethod).toBeNull();
  });

  it('方法抛异常 → 视为不可用，继续降级', () => {
    const env = makeEnv();
    const result = tryMethods<string>([
      { name: 'method-a', execute: () => { throw new Error('boom'); }, isAvailable: true },
      { name: 'method-b', execute: () => 'fallback', isAvailable: true },
    ], env);
    expect(result.result).toBe('fallback');
    expect(result.usedMethod).toBe('method-b');
    expect(env.degradedMethods).toContain('method-a');
  });

  it('空方法列表 → 返回 null', () => {
    const env = makeEnv();
    const result = tryMethods<string>([], env);
    expect(result.result).toBeNull();
    expect(result.usedMethod).toBeNull();
  });

  it('多个降级方法都记录到 degradedMethods', () => {
    const env = makeEnv();
    tryMethods<string>([
      { name: 'm1', execute: () => { throw new Error(); }, isAvailable: true },
      { name: 'm2', execute: () => 'x', isAvailable: false },
      { name: 'm3', execute: () => 'ok', isAvailable: true },
    ], env);
    expect(env.degradedMethods).toContain('m1');
    expect(env.degradedMethods).toContain('m2');
    expect(env.degradedMethods).not.toContain('m3');
  });
});
