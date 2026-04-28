import { describe, it, expect } from 'bun:test';
import { compareVersions, THRESHOLDS } from '../src/scanners/thresholds';

// ==================== compareVersions ====================

describe('compareVersions', () => {
  it('equal versions return 0', () => {
    expect(compareVersions('2.30.0', '2.30.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('18.0', '18.0')).toBe(0);
  });

  it('major version larger returns positive', () => {
    expect(compareVersions('3.0.0', '2.30.0')).toBeGreaterThan(0);
    expect(compareVersions('19.0.0', '18.0.0')).toBeGreaterThan(0);
  });

  it('major version smaller returns negative', () => {
    expect(compareVersions('1.99.99', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('17.9.0', '18.0.0')).toBeLessThan(0);
  });

  it('minor version comparison works', () => {
    expect(compareVersions('2.31.0', '2.30.0')).toBeGreaterThan(0);
    expect(compareVersions('2.29.0', '2.30.0')).toBeLessThan(0);
    expect(compareVersions('2.30.1', '2.30.0')).toBeGreaterThan(0);
  });

  it('version below threshold returns negative', () => {
    expect(compareVersions('2.29.1', '2.30')).toBeLessThan(0);
    expect(compareVersions('1.99.99', '2.30')).toBeLessThan(0);
  });

  it('patch version difference is detected', () => {
    expect(compareVersions('2.30.2', '2.30.1')).toBeGreaterThan(0);
    expect(compareVersions('2.30.0', '2.30.1')).toBeLessThan(0);
  });

  it('two-part version numbers pad correctly (equal to three-part)', () => {
    expect(compareVersions('2.30', '2.30.0')).toBe(0);
    expect(compareVersions('2.30.0', '2.30')).toBe(0);
    expect(compareVersions('2.30.1', '2.30')).toBeGreaterThan(0);
    expect(compareVersions('2.30', '2.30.1')).toBeLessThan(0);
  });

  it('"unknown" treated as version [0]', () => {
    expect(compareVersions('unknown', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('0.0.0', 'unknown')).toBe(0);
    expect(compareVersions('unknown', 'unknown')).toBe(0);
  });

  it('empty string treated as version [0]', () => {
    expect(compareVersions('', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('', '')).toBe(0);
  });

  it('non-numeric segments treated as 0', () => {
    expect(compareVersions('2.30.beta', '2.30.0')).toBe(0);
    expect(compareVersions('2.30.abc', '2.30.0')).toBe(0);
  });

  it('non-standard strings do not crash', () => {
    expect(() => compareVersions('not-a-version', 'also-not')).not.toThrow();
    expect(() => compareVersions('', 'unknown')).not.toThrow();
    expect(() => compareVersions('1', '')).not.toThrow();
  });
});

// ==================== THRESHOLDS constant ====================

describe('THRESHOLDS constant', () => {
  it('git.minVersion exists and is a string', () => {
    expect(typeof THRESHOLDS.git.minVersion).toBe('string');
    expect(THRESHOLDS.git.minVersion).toBe('2.30');
  });

  it('gpu_driver.minDriverMajor exists and is a number', () => {
    expect(typeof THRESHOLDS.gpu_driver.minDriverMajor).toBe('number');
    expect(THRESHOLDS.gpu_driver.minDriverMajor).toBe(525);
  });

  it('node.minMajor exists and is a number', () => {
    expect(typeof THRESHOLDS.node.minMajor).toBe('number');
    expect(THRESHOLDS.node.minMajor).toBe(18);
  });

  it('mirror_sources.pipMirrorPattern is a regex', () => {
    expect(THRESHOLDS.mirror_sources.pipMirrorPattern).toBeInstanceOf(RegExp);
  });

  it('pip mirror pattern matches known mirrors', () => {
    const pattern = THRESHOLDS.mirror_sources.pipMirrorPattern;
    expect(pattern.test('https://pypi.tuna.tsinghua.edu.cn/simple')).toBe(true);
    expect(pattern.test('https://mirrors.aliyun.com/pypi/simple')).toBe(true);
    expect(pattern.test('https://pypi.doubanio.com/simple')).toBe(true);
    expect(pattern.test('https://mirrors.tencent.com/pypi/simple')).toBe(true);
    expect(pattern.test('https://mirrors.huawei.com/pypi/simple')).toBe(true);
    // "index.url =" (dot not hyphen) is what the pattern matches
    expect(pattern.test('index.url = https://example.com')).toBe(true);
  });

  it('pip mirror pattern rejects non-mirror urls', () => {
    const pattern = THRESHOLDS.mirror_sources.pipMirrorPattern;
    expect(pattern.test('https://pypi.org/simple')).toBe(false);
    // "index-url" uses hyphen, not dot — does not match index\.url
    expect(pattern.test('index-url = https://example.com')).toBe(false);
  });

  it('npm default pattern detects official registry', () => {
    const pattern = THRESHOLDS.mirror_sources.npmDefaultPattern;
    expect(pattern.test('registry=https://registry.npmjs.org')).toBe(true);
    expect(pattern.test('registry=https://registry.npmmirror.com')).toBe(false);
  });
});
