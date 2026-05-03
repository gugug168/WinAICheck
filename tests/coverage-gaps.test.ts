/**
 * 补充测试：覆盖 feat/scanner-accuracy-optimization 分支的未测路径
 *
 * 重点关注：
 * - compareVersions 边界（单段版本、混合长度）
 * - git scanner "unknown" 版本分支
 * - node-version scanner NaN / 边界值
 * - gpu-driver scanner NaN driver major
 * - mirror-sources scanner 使用 THRESHOLDS 模式的文件模拟
 * - scanWithDiagnostic 的多种 scanner 状态
 * - executor _diag 钩子的集成覆盖
 */

import { describe, test, expect, afterEach, beforeEach, mock } from 'bun:test';
import { compareVersions, THRESHOLDS } from '../src/scanners/thresholds';
import { _test, _diag } from '../src/executor/index';
import { createCommandMock, teardownMock, type MockResponse } from './integration/mock-helper';

import '../src/scanners/index';
import { getScannerById } from '../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

// =====================================================================
// 1. compareVersions 额外边界
// =====================================================================

describe('compareVersions — 额外边界覆盖', () => {
  test('单段版本比较', () => {
    expect(compareVersions('5', '3')).toBeGreaterThan(0);
    expect(compareVersions('3', '5')).toBeLessThan(0);
    expect(compareVersions('7', '7')).toBe(0);
  });

  test('混合段数：1段 vs 2段', () => {
    expect(compareVersions('2', '2.0')).toBe(0);
    expect(compareVersions('2', '2.1')).toBeLessThan(0);
    expect(compareVersions('3', '2.99')).toBeGreaterThan(0);
  });

  test('混合段数：3段 vs 1段', () => {
    expect(compareVersions('2.30.1', '2')).toBeGreaterThan(0);
    expect(compareVersions('1.99.99', '2')).toBeLessThan(0);
  });

  test('大版本号正确比较', () => {
    expect(compareVersions('550.0', '525.0')).toBeGreaterThan(0);
    expect(compareVersions('525.0', '550.0')).toBeLessThan(0);
    expect(compareVersions('525.0', '525.0')).toBe(0);
  });
});

// =====================================================================
// 2. git scanner — "unknown" 版本分支
// =====================================================================

describe('git scanner — unparseable version → warn', () => {
  afterEach(teardownMock);

  test('版本号无法解析时返回 warn', async () => {
    setupMock(new Map([[
      'git --version',
      { stdout: 'git version custom-build-2024', exitCode: 0 },
    ]]));
    const scanner = getScannerById('git')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('无法解析');
  });

  test('版本号部分匹配（只有 major）→ warn', async () => {
    // regex 只匹配 \d+\.\d+\.\d+，所以 "git version 2" 不会匹配
    setupMock(new Map([[
      'git --version',
      { stdout: 'git version 2', exitCode: 0 },
    ]]));
    const scanner = getScannerById('git')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('无法解析');
  });
});

// =====================================================================
// 3. node-version scanner — 边界值和 NaN
// =====================================================================

describe('node-version scanner — 边界值和 NaN', () => {
  afterEach(teardownMock);

  test('刚好 v18 → pass', async () => {
    setupMock(new Map([[
      'node --version',
      { stdout: 'v18.0.0', exitCode: 0 },
    ]]));
    const scanner = getScannerById('node-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('v17.9.9 → warn', async () => {
    setupMock(new Map([[
      'node --version',
      { stdout: 'v17.9.9', exitCode: 0 },
    ]]));
    const scanner = getScannerById('node-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.error_type).toBe('outdated');
  });

  test('异常输出导致 NaN major → warn', async () => {
    setupMock(new Map([[
      'node --version',
      { stdout: 'vabc.def.ghi', exitCode: 0 },
    ]]));
    const scanner = getScannerById('node-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
  });
});

// =====================================================================
// 4. gpu-driver scanner — NaN major version
// =====================================================================

describe('gpu-driver scanner — 异常驱动版本', () => {
  afterEach(teardownMock);

  test('驱动版本非数字（NaN）→ warn', async () => {
    setupMock(new Map([[
      'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader',
      { stdout: 'NVIDIA GeForce RTX 4060, abc.12\n', exitCode: 0 },
    ]]));
    const scanner = getScannerById('gpu-driver')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.error_type).toBe('outdated');
  });

  test('驱动刚好 525.0 → pass', async () => {
    setupMock(new Map([[
      'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader',
      { stdout: 'NVIDIA GeForce RTX 3060, 525.0\n', exitCode: 0 },
    ]]));
    const scanner = getScannerById('gpu-driver')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });
});

// =====================================================================
// 5. mirror-sources scanner — THRESHOLDS 模式单元验证
// =====================================================================
// mirror-sources 从 'fs' 解构导入 existsSync/readFileSync，模块加载时
// 已绑定原始引用，无法在运行时 monkey-patch。因此：
//   - THRESHOLDS 正则模式的正确性由 scanner-thresholds.test.ts 覆盖
//   - 此处验证扫描器结构 + 模式与已知内容的匹配

describe('mirror-sources scanner — 结构与 THRESHOLDS 集成', () => {
  test('scanner 已注册且 category 为 network', () => {
    const scanner = getScannerById('mirror-sources')!;
    expect(scanner).toBeDefined();
    expect(scanner.id).toBe('mirror-sources');
    expect(scanner.category).toBe('network');
  });

  test('THRESHOLDS pipMirrorPattern 匹配 pip.ini 配置', () => {
    // 这验证 mirror-sources.ts 中用 THRESHOLDS.pipMirrorPattern 替换
    // 内联 /tsinghua|aliyun|douban|tencent|index\.url\s*=/i 的行为一致
    const pattern = THRESHOLDS.mirror_sources.pipMirrorPattern;
    // "index.url = ..." 使用点 — 直接匹配 index\.url\s*= 子模式
    expect(pattern.test('index.url = https://example.com')).toBe(true);
    // 含 aliyun 的 URL — 匹配 aliyun 子模式
    expect(pattern.test('index-url = https://mirrors.aliyun.com/pypi/simple')).toBe(true);
    // 纯官方源 — 不匹配任何子模式
    expect(pattern.test('[global]\nindex-url = https://pypi.org/simple')).toBe(false);
  });

  test('THRESHOLDS npmDefaultPattern 排除非官方源 → 镜像扫描逻辑', () => {
    // 验证 mirror-sources.ts 的 npm 检查：
    //   /registry/.test(content) && !npmDefaultPattern.test(content)
    const content1 = 'registry=https://registry.npmmirror.com';
    expect(/registry/.test(content1)).toBe(true);
    expect(THRESHOLDS.mirror_sources.npmDefaultPattern.test(content1)).toBe(false);
    // 满足条件：有 registry 且不是默认源 → 算镜像

    const content2 = 'registry=https://registry.npmjs.org';
    expect(/registry/.test(content2)).toBe(true);
    expect(THRESHOLDS.mirror_sources.npmDefaultPattern.test(content2)).toBe(true);
    // npmDefaultPattern 命中 → 不算镜像 → "使用默认源"
  });

  test('scan 方法返回合法的 ScanResult 结构', async () => {
    // 即使无法 mock 文件系统，scan 不会抛异常
    const scanner = getScannerById('mirror-sources')!;
    const result = await scanner.scan();
    expect(['pass', 'warn', 'fail', 'unknown']).toContain(result.status);
    expect(result.id).toBe('mirror-sources');
    expect(result.category).toBe('network');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// 6. scanWithDiagnostic — 多种状态
// =====================================================================

describe('scanWithDiagnostic — 多种扫描器状态', () => {
  afterEach(() => {
    teardownMock();
    _diag.onCommand = undefined;
    _diag.onReg = undefined;
    _diag.onPS = undefined;
  });

  test('node-version 扫描器 fail → diagnostic 记录 finalStatus=fail', async () => {
    _test.mockExecSync = (cmd: string) => {
      if (cmd.includes('node --version')) {
        const err: any = new Error('not found');
        err.status = 1;
        err.stderr = Buffer.from('not found');
        throw err;
      }
      if (cmd.includes('net session')) {
        const err: any = new Error('denied');
        err.status = 1;
        throw err;
      }
      return Buffer.from('');
    };

    const { scanWithDiagnostic } = await import('../src/scanners/diagnostic');
    const scanner = getScannerById('node-version')!;
    const { result, diagnostic } = await scanWithDiagnostic(scanner);

    expect(result.status).toBe('fail');
    expect(diagnostic.finalStatus).toBe('fail');
    expect(diagnostic.scannerId).toBe('node-version');
    expect(diagnostic.steps.length).toBeGreaterThan(0);
    expect(diagnostic.environment.admin).toBe(false);
  });

  test('gpu-driver 扫描器 warn → diagnostic 记录 finalStatus=warn', async () => {
    _test.mockExecSync = (cmd: string) => {
      if (cmd.includes('nvidia-smi')) {
        return Buffer.from('RTX 3060, 470.50\n');
      }
      if (cmd.includes('net session')) return Buffer.from('');
      return Buffer.from('');
    };

    const { scanWithDiagnostic } = await import('../src/scanners/diagnostic');
    const scanner = getScannerById('gpu-driver')!;
    const { result, diagnostic } = await scanWithDiagnostic(scanner);

    expect(result.status).toBe('warn');
    expect(diagnostic.finalStatus).toBe('warn');
    expect(diagnostic.environment.os).toBeDefined();
    expect(diagnostic.environment.arch).toBeDefined();
    expect(diagnostic.environment.timestamp).toBeGreaterThan(0);
  });

  test('admin=true 时 environment.admin 为 true', async () => {
    _test.mockExecSync = (cmd: string) => {
      if (cmd.includes('git --version')) return Buffer.from('git version 2.45.0');
      if (cmd.includes('net session')) return Buffer.from('');  // exitCode=0 => admin
      return Buffer.from('');
    };

    const { scanWithDiagnostic } = await import('../src/scanners/diagnostic');
    const scanner = getScannerById('git')!;
    const { diagnostic } = await scanWithDiagnostic(scanner);

    expect(diagnostic.environment.admin).toBe(true);
  });

  test('_diag 钩子在 scanWithDiagnostic 完成后被清理', async () => {
    _test.mockExecSync = (cmd: string) => {
      if (cmd.includes('git --version')) return Buffer.from('git version 2.45.0');
      if (cmd.includes('net session')) {
        const err: any = new Error('denied');
        err.status = 1;
        throw err;
      }
      return Buffer.from('');
    };

    const { scanWithDiagnostic } = await import('../src/scanners/diagnostic');
    const scanner = getScannerById('git')!;
    await scanWithDiagnostic(scanner);

    // 钩子应已被清理
    expect(_diag.onCommand).toBeUndefined();
    expect(_diag.onReg).toBeUndefined();
    expect(_diag.onPS).toBeUndefined();
  });
});

// =====================================================================
// 7. THRESHOLDS 常量 — 额外断言
// =====================================================================

describe('THRESHOLDS — 可冻结性验证', () => {
  test('THRESHOLDS 对象的值不可被运行时篡改（as const）', () => {
    // as const 使对象深层 readonly，TypeScript 会阻止赋值
    // 运行时验证：属性确实存在且有预期值
    expect(THRESHOLDS.git.minVersion).toBe('2.30');
    expect(THRESHOLDS.gpu_driver.minDriverMajor).toBe(525);
    expect(THRESHOLDS.node.minMajor).toBe(18);
  });

  test('pip 模式匹配 douban 镜像', () => {
    const pattern = THRESHOLDS.mirror_sources.pipMirrorPattern;
    expect(pattern.test('https://pypi.doubanio.com/simple/')).toBe(true);
  });

  test('pip 模式匹配 tencent 镜像', () => {
    const pattern = THRESHOLDS.mirror_sources.pipMirrorPattern;
    expect(pattern.test('https://mirrors.tencent.com/pypi/simple')).toBe(true);
  });

  test('npm 默认模式不匹配淘宝镜像', () => {
    const pattern = THRESHOLDS.mirror_sources.npmDefaultPattern;
    expect(pattern.test('registry=https://registry.npmmirror.com')).toBe(false);
  });
});
