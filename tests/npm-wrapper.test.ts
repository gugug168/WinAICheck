import { describe, expect, test } from 'bun:test';

describe('npm wrapper', () => {
  test('ESM 环境下可直接导入入口脚本', async () => {
    const mod = await import('../bin/winaicheck.js');
    expect(typeof mod.main).toBe('function');
  });
});
