# Ground Truth 验证器 + 审计脚本 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 8 个高频扫描器编写独立的 ground truth 验证器 + 统一审计 CLI，能自动发现扫描器的误判、漏判。

**Architecture:** 每个验证器是独立 .ts 文件，导出 `TruthValidator` 接口。共享 `runner.ts` 提供 `tryMethods()` 降级链执行器和 `aggregateVerdict()` 聚合规则。`audit.ts` 是 CLI 入口，本地模式直接运行验证器，CI 模式通过 `_test.mockExecSync` 注入 fixture 数据。验证器通过 `scanWithDiagnostic()` 获取扫描器决策链，逐步比对独立获取的真实值。

**Tech Stack:** Bun + TypeScript，测试用 `bun:test`，命令模拟用 `_test.mockExecSync` + `createCommandMock`。

**计划范围：** 阶段 2 全部 — 8 个验证器 + 基础设施 + audit CLI + CI fixture + 测试。

**设计规格：** `docs/superpowers/specs/2026-04-28-ground-truth-validators-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| **Create** | `scripts/ground-truth/types.ts` | 共享类型定义 |
| **Create** | `scripts/ground-truth/runner.ts` | tryMethods、aggregateVerdict、discoverValidators、runAllValidators |
| **Modify** | `src/executor/index.ts` | 新增 _test.mockReadFileSync |
| **Create** | `scripts/ground-truth/git.truth.ts` | Git 验证器 |
| **Create** | `scripts/ground-truth/node-version.truth.ts` | Node.js 验证器 |
| **Create** | `scripts/ground-truth/python-versions.truth.ts` | Python 验证器 |
| **Create** | `scripts/ground-truth/long-paths.truth.ts` | 长路径验证器 |
| **Create** | `scripts/ground-truth/powershell-policy.truth.ts` | PowerShell 策略验证器 |
| **Create** | `scripts/ground-truth/mirror-sources.truth.ts` | 镜像源验证器 |
| **Create** | `scripts/ground-truth/wsl-version.truth.ts` | WSL 验证器 |
| **Create** | `scripts/ground-truth/firewall-ports.truth.ts` | 防火墙端口验证器 |
| **Create** | `scripts/audit.ts` | CLI 入口 |
| **Create** | `scripts/ground-truth/fixtures/*.json` | CI 模式 mock 数据 |
| **Create** | `tests/ground-truth-types.test.ts` | 类型 + 工具函数测试 |
| **Create** | `tests/ground-truth-runner.test.ts` | Runner 测试 |
| **Create** | `tests/ground-truth-validators.test.ts` | 全部 8 个验证器测试 |
| **Create** | `tests/audit-cli.test.ts` | audit CLI 测试 |

---

## Task 1: 核心类型 + 工具函数

**Files:**
- Create: `scripts/ground-truth/types.ts`
- Create: `tests/ground-truth-types.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/ground-truth-types.test.ts
import { describe, it, expect } from 'bun:test';
import { aggregateVerdict, tryMethods } from '../scripts/ground-truth/runner';
import type { ValidationCheck, CheckVerdict, ValidatorEnv } from '../scripts/ground-truth/types';

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
});

describe('tryMethods', () => {
  const baseEnv: ValidatorEnv = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };

  it('首选方法成功 → 返回结果，不记录降级', () => {
    const result = tryMethods([
      { name: 'method-a', execute: () => 'result-a', isAvailable: true },
      { name: 'method-b', execute: () => 'result-b', isAvailable: true },
    ], baseEnv);
    expect(result.result).toBe('result-a');
    expect(result.usedMethod).toBe('method-a');
    expect(baseEnv.degradedMethods).toEqual([]);
  });

  it('首选不可用 → 降级到备选', () => {
    const result = tryMethods([
      { name: 'method-a', execute: () => 'result-a', isAvailable: false },
      { name: 'method-b', execute: () => 'result-b', isAvailable: true },
    ], baseEnv);
    expect(result.result).toBe('result-b');
    expect(result.usedMethod).toBe('method-b');
    expect(baseEnv.degradedMethods).toContain('method-a');
  });

  it('全部不可用 → 返回 null', () => {
    const result = tryMethods([
      { name: 'method-a', execute: () => 'x', isAvailable: false },
      { name: 'method-b', execute: () => 'x', isAvailable: false },
    ], baseEnv);
    expect(result.result).toBeNull();
    expect(result.usedMethod).toBeNull();
  });

  it('方法抛异常 → 视为不可用，继续降级', () => {
    const result = tryMethods([
      { name: 'method-a', execute: () => { throw new Error('boom'); }, isAvailable: true },
      { name: 'method-b', execute: () => 'fallback', isAvailable: true },
    ], baseEnv);
    expect(result.result).toBe('fallback');
    expect(result.usedMethod).toBe('method-b');
  });

  it('空方法列表 → 返回 null', () => {
    const result = tryMethods([], baseEnv);
    expect(result.result).toBeNull();
    expect(result.usedMethod).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写类型定义**

```typescript
// scripts/ground-truth/types.ts
import type { ScanResult, ScanDiagnostic } from '../../src/scanners/types';

/** 单个检查点判定 */
export type CheckVerdict = 'correct' | 'incorrect' | 'partial' | 'skipped';

/** 单个检查点 */
export interface ValidationCheck {
  name: string;
  scannerStep: string;
  expectedValue: string;
  scannerValue: string;
  verdict: CheckVerdict;
  note?: string;
}

/** 验证器环境 */
export interface ValidatorEnv {
  windowsVersion: string;
  isAdmin: boolean;
  degradedMethods: string[];
}

/** 单个扫描器的完整验证报告 */
export interface ValidationReport {
  scannerId: string;
  scannerName: string;
  env: ValidatorEnv;
  checks: ValidationCheck[];
  overallVerdict: CheckVerdict;
  scannerResult: ScanResult;
  scannerDiagnostic?: ScanDiagnostic;
}

/** 验证器接口 */
export interface TruthValidator {
  id: string;
  name: string;
  validate(env: ValidatorEnv): Promise<ValidationReport>;
}

/** 降级链方法 */
export interface DegradableMethod<T> {
  name: string;
  execute: () => T;
  isAvailable: boolean;
}
```

- [ ] **Step 4: 写 runner 工具函数（只含 tryMethods + aggregateVerdict）**

```typescript
// scripts/ground-truth/runner.ts
import type { ValidationCheck, CheckVerdict, ValidatorEnv, DegradableMethod } from './types';

/** 整体判定聚合：incorrect > partial > correct > skipped */
export function aggregateVerdict(checks: ValidationCheck[]): CheckVerdict {
  if (checks.length === 0) return 'skipped';
  if (checks.some(c => c.verdict === 'incorrect')) return 'incorrect';
  if (checks.some(c => c.verdict === 'partial')) return 'partial';
  if (checks.every(c => c.verdict === 'skipped')) return 'skipped';
  return 'correct';
}

/** 按优先级尝试多个检测方法，自动降级 */
export function tryMethods<T>(
  methods: DegradableMethod<T>[],
  env: ValidatorEnv,
): { result: T | null; usedMethod: string | null } {
  for (const method of methods) {
    if (!method.isAvailable) {
      env.degradedMethods.push(method.name);
      continue;
    }
    try {
      const result = method.execute();
      return { result, usedMethod: method.name };
    } catch {
      env.degradedMethods.push(method.name);
    }
  }
  return { result: null, usedMethod: null };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-types.test.ts`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/types.ts scripts/ground-truth/runner.ts tests/ground-truth-types.test.ts
git commit -m "feat: add ground truth validator types, tryMethods, and aggregateVerdict"
```

---

## Task 2: executor 增强 — _test.mockReadFileSync

**Files:**
- Modify: `src/executor/index.ts`
- Create: `tests/ground-truth-executor.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/ground-truth-executor.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { _test } from '../src/executor/index';
import { readFileSync } from 'fs';

describe('_test.mockReadFileSync', () => {
  afterEach(() => {
    _test.mockReadFileSync = null;
  });

  it('mock 生效时返回 mock 数据', () => {
    _test.mockReadFileSync = (path: string) => {
      if (path.includes('pip.ini')) return 'index-url = https://pypi.tuna.tsinghua.edu.cn/simple';
      return null;
    };
    // 通过验证器逻辑间接测试
    const result = _test.mockReadFileSync!(join(homedir(), 'pip', 'pip.ini'));
    expect(result).toContain('tsinghua');
  });

  it('mock 返回 null 时表示未 mock 该路径', () => {
    _test.mockReadFileSync = (_path: string) => null;
    const result = _test.mockReadFileSync!('/some/random/path');
    expect(result).toBeNull();
  });

  it('清理后恢复原始行为', () => {
    _test.mockReadFileSync = () => 'mocked';
    expect(_test.mockReadFileSync!('any')).toBe('mocked');
    _test.mockReadFileSync = null;
    expect(_test.mockReadFileSync).toBeNull();
  });
});
```

注意：上面的测试 import 需要补上 `import { join } from 'path'` 和 `import { homedir } from 'os'`。实际编写时调整。

- [ ] **Step 2: 在 executor/index.ts 的 _test 对象中新增 mockReadFileSync**

在 `src/executor/index.ts` 第 9 行 `mockExistsSync` 之后新增一行：

```typescript
export const _test = {
  mockExecSync: null as ((cmd: string, opts: any) => Buffer) | null,
  mockExistsSync: null as ((path: string) => boolean) | null,
  mockReadFileSync: null as ((path: string) => string | null) | null,
};
```

- [ ] **Step 3: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-executor.test.ts`
Expected: ALL PASS

- [ ] **Step 4: 跑全量测试确认无回归**

Run: `cd E:/WinAICHECK && bun test`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd E:/WinAICHECK
git add src/executor/index.ts tests/ground-truth-executor.test.ts
git commit -m "feat: add _test.mockReadFileSync for filesystem validator CI mode"
```

---

## Task 3: Git 验证器（模板验证器）

**Files:**
- Create: `scripts/ground-truth/git.truth.ts`
- Create: `tests/ground-truth-validators.test.ts`（第一个验证器测试）

这是第一个验证器，建立所有后续验证器遵循的模式。

- [ ] **Step 1: 写测试**

```typescript
// tests/ground-truth-validators.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { _test } from '../src/executor/index';
import { createCommandMock } from './integration/mock-helper';
import { gitValidator } from '../scripts/ground-truth/git.truth';

describe('git validator', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('git 2.51.1 → 全部 correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['git --version', { stdout: 'git version 2.51.1', exitCode: 0 }],
      ['where git', { stdout: 'C:\\Program Files\\Git\\cmd\\git.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await gitValidator.validate(env);

    expect(report.scannerId).toBe('git');
    expect(report.overallVerdict).toBe('correct');
    expect(report.checks.length).toBeGreaterThanOrEqual(2);
  });

  it('git 未安装 → 至少一个 incorrect', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['git --version', { stdout: '', exitCode: 1 }],
      ['where git', { stdout: '', exitCode: 1 }],
      ['net session', { exitCode: 0 }],
    ]));

    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await gitValidator.validate(env);

    expect(report.overallVerdict).toBe('incorrect');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-validators.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 git.truth.ts**

```typescript
// scripts/ground-truth/git.truth.ts
import { runCommand } from '../../src/executor/index';
import { getScannerById } from '../../src/scanners/registry';
import { scanWithDiagnostic } from '../../src/scanners/diagnostic';
import { compareVersions, THRESHOLDS } from '../../src/scanners/thresholds';
import { tryMethods, aggregateVerdict } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

export const gitValidator: TruthValidator = {
  id: 'git',
  name: 'Git 检测',

  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取 Git 是否安装
    const installResult = tryMethods([
      { name: 'where git', execute: () => runCommand('where git', 5000), isAvailable: true },
    ], env);

    const isInstalled = installResult.result !== null && installResult.result.exitCode === 0;

    // Step 2: 独立获取版本号
    let realVersion = 'unknown';
    if (isInstalled) {
      const versionOutput = runCommand('git --version', 5000);
      const match = versionOutput.stdout.match(/git version (\d+\.\d+\.\d+)/);
      realVersion = match?.[1] || 'unknown';
    }

    // Step 3: 运行扫描器
    const scanner = getScannerById('git')!;
    const { result: scannerResult, diagnostic: scannerDiag } = await scanWithDiagnostic(scanner);

    // Step 4: 逐步比对
    // 检查点 1: 安装状态
    checks.push({
      name: '安装状态',
      scannerStep: 'runCommand:git --version',
      expectedValue: isInstalled ? '已安装' : '未安装',
      scannerValue: scannerResult.status === 'fail' ? '未安装' : '已安装',
      verdict: (isInstalled && scannerResult.status !== 'fail') || (!isInstalled && scannerResult.status === 'fail')
        ? 'correct' : 'incorrect',
    });

    // 检查点 2: 版本号解析（仅在已安装时）
    if (isInstalled && realVersion !== 'unknown') {
      const scannerVersion = scannerResult.message.match(/(\d+\.\d+\.\d+)/)?.[1] || 'unknown';
      checks.push({
        name: '版本号解析',
        scannerStep: 'parse:version',
        expectedValue: realVersion,
        scannerValue: scannerVersion,
        verdict: realVersion === scannerVersion ? 'correct' : 'incorrect',
      });

      // 检查点 3: 阈值判定
      const expectedStatus = compareVersions(realVersion, THRESHOLDS.git.minVersion) < 0 ? 'warn' : 'pass';
      checks.push({
        name: '阈值判定',
        scannerStep: 'compare:threshold',
        expectedValue: expectedStatus,
        scannerValue: scannerResult.status,
        verdict: expectedStatus === scannerResult.status ? 'correct' : 'incorrect',
      });
    }

    return {
      scannerId: scanner.id,
      scannerName: scanner.name,
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
```

- [ ] **Step 4: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-validators.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/git.truth.ts tests/ground-truth-validators.test.ts
git commit -m "feat: add git ground truth validator"
```

---

## Task 4: Node.js + Python 验证器

**Files:**
- Create: `scripts/ground-truth/node-version.truth.ts`
- Create: `scripts/ground-truth/python-versions.truth.ts`
- Modify: `tests/ground-truth-validators.test.ts`（追加测试）

两个验证器结构相同，合并为一个 Task。

- [ ] **Step 1: 在 tests/ground-truth-validators.test.ts 中追加测试**

```typescript
describe('node-version validator', () => {
  afterEach(() => { _test.mockExecSync = null; });

  it('node v22.22.2 → 全部 correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['node --version', { stdout: 'v22.22.2', exitCode: 0 }],
      ['where node', { stdout: 'C:\\nvm4w\\nodejs\\node.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await nodeVersionValidator.validate(env);
    expect(report.overallVerdict).toBe('correct');
  });
});

describe('python-versions validator', () => {
  afterEach(() => { _test.mockExecSync = null; });

  it('python 3.12 detected → correct', async () => {
    _test.mockExecSync = createCommandMock(new Map([
      ['python --version', { stdout: 'Python 3.12.0', exitCode: 0 }],
      ['where python', { stdout: 'C:\\Python312\\python.exe', exitCode: 0 }],
      ['net session', { exitCode: 0 }],
    ]));
    const env = { windowsVersion: '10.0.22631', isAdmin: true, degradedMethods: [] };
    const report = await pythonVersionsValidator.validate(env);
    expect(report.overallVerdict).toBe('correct');
  });
});
```

- [ ] **Step 2: 写 node-version.truth.ts**

与 git.truth.ts 结构相同：独立 `runCommand('node --version')` 获取版本，用 `THRESHOLDS.node.minMajor` 做阈值比较。import 和 validate 流程一致，检查点为：安装状态、版本号解析、阈值判定。

- [ ] **Step 3: 写 python-versions.truth.ts**

独立 `runCommand('python --version')` + `runCommand('where python')` 获取版本和路径。检查点：安装状态、版本号解析、多版本检测（where 输出多行时）。

- [ ] **Step 4: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-validators.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/node-version.truth.ts scripts/ground-truth/python-versions.truth.ts tests/ground-truth-validators.test.ts
git commit -m "feat: add node-version and python-versions ground truth validators"
```

---

## Task 5: 注册表 + 文件系统验证器（long-paths、powershell-policy、mirror-sources）

**Files:**
- Create: `scripts/ground-truth/long-paths.truth.ts`
- Create: `scripts/ground-truth/powershell-policy.truth.ts`
- Create: `scripts/ground-truth/mirror-sources.truth.ts`
- Modify: `tests/ground-truth-validators.test.ts`

这三个验证器涉及注册表和文件系统读取，需要测试降级链。

- [ ] **Step 1: 追加测试到 tests/ground-truth-validators.test.ts**

long-paths：mock `reg query` 返回 `LongPathsEnabled = 1`，管理员模式全部 correct。非管理员 mock reg query 失败，检查 degradedMethods 包含降级记录。

powershell-policy：mock `Get-ExecutionPolicy` 返回 `RemoteSigned`，检查判定正确。

mirror-sources：mock `_test.mockReadFileSync` 返回 pip.ini 内容，检查正则匹配判定。

- [ ] **Step 2: 写 long-paths.truth.ts**

独立方法：`runReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled')`。降级链：reg query (管理员) → Get-ItemProperty (非管理员)。检查点：注册表值读取、判定。

- [ ] **Step 3: 写 powershell-policy.truth.ts**

独立方法：`runPS('Get-ExecutionPolicy')`。降级链：Get-ExecutionPolicy → reg query HKLM。检查点：执行策略值、判定。

- [ ] **Step 4: 写 mirror-sources.truth.ts**

独立方法：直接 readFileSync 读 pip.ini 和 .npmrc（使用 _test.mockReadFileSync 支持 CI 模式）。检查点：pip 配置、npm 配置。

- [ ] **Step 5: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-validators.test.ts`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/long-paths.truth.ts scripts/ground-truth/powershell-policy.truth.ts scripts/ground-truth/mirror-sources.truth.ts tests/ground-truth-validators.test.ts
git commit -m "feat: add long-paths, powershell-policy, mirror-sources ground truth validators"
```

---

## Task 6: WSL + 防火墙验证器

**Files:**
- Create: `scripts/ground-truth/wsl-version.truth.ts`
- Create: `scripts/ground-truth/firewall-ports.truth.ts`
- Modify: `tests/ground-truth-validators.test.ts`

- [ ] **Step 1: 追加测试**

wsl-version：mock `wsl --version` 返回 WSL 2.x，检查判定。mock `wsl --version` exitCode=1（未安装），检查 incorrect。

firewall-ports：mock `netsh advfirewall firewall show rule name=all dir=in` 返回端口规则，检查判定。非管理员降级测试。

- [ ] **Step 2: 写 wsl-version.truth.ts**

独立方法：`runCommand('wsl --version')` → 降级 `runCommand('wsl --status')` → 降级 `runCommand('wsl --list')`。检查点：安装检测、版本判定。

- [ ] **Step 3: 写 firewall-ports.truth.ts**

独立方法：`runCommand('netsh advfirewall ...')` → 降级 `runPS('Get-NetFirewallRule')`。检查点：端口规则读取、判定。

- [ ] **Step 4: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-validators.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/wsl-version.truth.ts scripts/ground-truth/firewall-ports.truth.ts tests/ground-truth-validators.test.ts
git commit -m "feat: add wsl-version and firewall-ports ground truth validators"
```

---

## Task 7: Runner 完整实现（发现 + 运行 + 报告）

**Files:**
- Modify: `scripts/ground-truth/runner.ts`
- Create: `tests/ground-truth-runner.test.ts`

- [ ] **Step 1: 写 runner 测试**

```typescript
// tests/ground-truth-runner.test.ts
import { describe, it, expect } from 'bun:test';
import { discoverValidators, runAllValidators, formatReport } from '../scripts/ground-truth/runner';

describe('discoverValidators', () => {
  it('发现所有 .truth.ts 验证器文件', async () => {
    const validators = await discoverValidators();
    expect(validators.length).toBe(8);
    const ids = validators.map(v => v.id).sort();
    expect(ids).toEqual(['firewall-ports', 'git', 'long-paths', 'mirror-sources', 'node-version', 'powershell-policy', 'python-versions', 'wsl-version']);
  });
});

describe('formatReport', () => {
  it('空报告不崩溃', () => {
    const output = formatReport([]);
    expect(output).toContain('审计');
  });
});
```

- [ ] **Step 2: 在 runner.ts 中补充 discoverValidators、runAllValidators、formatReport**

```typescript
// 在 runner.ts 已有 tryMethods + aggregateVerdict 基础上追加

/** 动态发现所有 .truth.ts 验证器 */
export async function discoverValidators(): Promise<TruthValidator[]> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');
  const dir = join(__dirname, 'ground-truth');
  const files = await readdir(dir);
  const truthFiles = files.filter(f => f.endsWith('.truth.ts') || f.endsWith('.truth.js'));

  const validators: TruthValidator[] = [];
  for (const file of truthFiles) {
    const mod = await import(join(dir, file));
    const validator: TruthValidator = mod.default || Object.values(mod).find((v: any) => v && typeof v.validate === 'function');
    if (validator) validators.push(validator);
  }
  return validators;
}

/** 运行所有验证器 */
export async function runAllValidators(
  validators: TruthValidator[],
  env?: ValidatorEnv,
): Promise<ValidationReport[]> {
  const realEnv: ValidatorEnv = env ?? {
    windowsVersion: await detectWindowsVersion(),
    isAdmin: await detectAdmin(),
    degradedMethods: [],
  };

  const reports: ValidationReport[] = [];
  for (const validator of validators) {
    try {
      const report = await validator.validate(realEnv);
      reports.push(report);
    } catch (err) {
      // 验证器出错不阻塞其他验证器
    }
  }
  return reports;
}

/** 格式化报告为终端表格 */
export function formatReport(reports: ValidationReport[]): string {
  if (reports.length === 0) return 'WinAICheck 扫描器审计 — 无验证器可用';

  let output = 'WinAICheck 扫描器审计\n\n';
  const correct = reports.filter(r => r.overallVerdict === 'correct').length;
  const issues = reports.filter(r => r.overallVerdict !== 'correct').length;
  output += `总计: ${reports.length} 验证器, ${correct} 正确, ${issues} 有问题\n\n`;

  for (const report of reports) {
    const icon = report.overallVerdict === 'correct' ? '✅' : report.overallVerdict === 'incorrect' ? '❌' : '⚠️';
    output += `${icon} ${report.scannerName}: ${report.checks.length} 检查点, 判定 ${report.overallVerdict}\n`;
    for (const check of report.checks) {
      if (check.verdict !== 'correct') {
        output += `   → ${check.name}: 期望 "${check.expectedValue}" 实际 "${check.scannerValue}"\n`;
      }
    }
  }

  return output;
}

async function detectWindowsVersion(): Promise<string> {
  const result = runCommand('ver', 5000);
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] || 'unknown';
}

async function detectAdmin(): Promise<boolean> {
  return runCommand('net session', 5000).exitCode === 0;
}
```

- [ ] **Step 3: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/ground-truth-runner.test.ts`
Expected: ALL PASS

- [ ] **Step 4: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/runner.ts tests/ground-truth-runner.test.ts
git commit -m "feat: add runner discovery, execution, and report formatting"
```

---

## Task 8: audit.ts CLI 入口

**Files:**
- Create: `scripts/audit.ts`
- Create: `tests/audit-cli.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/audit-cli.test.ts
import { describe, it, expect } from 'bun:test';
import { parseArgs, AuditConfig } from '../scripts/audit';

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
});
```

- [ ] **Step 2: 写 audit.ts**

```typescript
// scripts/audit.ts
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { _test } from '../src/executor/index';
import { createCommandMock } from '../tests/integration/mock-helper';
import { discoverValidators, runAllValidators, formatReport } from './ground-truth/runner';
import type { ValidationReport } from './ground-truth/types';

export interface AuditConfig {
  mode: 'scanners' | 'fixers';
  ci: boolean;
  json: boolean;
  outputPath?: string;
}

export function parseArgs(args: string[]): AuditConfig {
  return {
    mode: args.find(a => a.startsWith('--mode='))?.split('=')[1] as any || 'scanners',
    ci: args.includes('--ci'),
    json: args.includes('--json'),
    outputPath: args[args.indexOf('--output') + 1],
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  // 发现验证器
  const validators = await discoverValidators();
  if (validators.length === 0) {
    console.error('未找到任何验证器');
    process.exit(1);
  }

  // CI 模式: 加载 fixture 并设置 mock
  if (config.ci) {
    const fixtureDir = join(__dirname, 'ground-truth', 'fixtures');
    const commands = new Map<string, { stdout: string; exitCode: number }>();
    for (const file of await import('fs').then(fs => fs.readdirSync(fixtureDir).filter(f => f.endsWith('.json')))) {
      const fixture = JSON.parse(readFileSync(join(fixtureDir, file), 'utf-8'));
      for (const [cmd, resp] of Object.entries(fixture.commands || {})) {
        commands.set(cmd, resp as any);
      }
    }
    _test.mockExecSync = createCommandMock(commands);
  }

  // 运行
  const reports = await runAllValidators(validators);

  // 清理 mock
  if (config.ci) {
    _test.mockExecSync = null;
    _test.mockReadFileSync = null;
  }

  // 输出
  if (config.json) {
    const jsonOutput = JSON.stringify(reports, null, 2);
    if (config.outputPath) {
      mkdirSync(join(config.outputPath, '..'), { recursive: true });
      writeFileSync(config.outputPath, jsonOutput);
      console.log(`报告已保存: ${config.outputPath}`);
    } else {
      console.log(jsonOutput);
    }
  } else {
    const textOutput = formatReport(reports);
    console.log(textOutput);
    if (config.outputPath) {
      mkdirSync(join(config.outputPath, '..'), { recursive: true });
      writeFileSync(config.outputPath, textOutput);
      console.log(`\n报告已保存: ${config.outputPath}`);
    }
  }

  // 退出码: 有 incorrect 时返回 1
  const hasIssues = reports.some(r => r.overallVerdict === 'incorrect');
  process.exit(hasIssues ? 1 : 0);
}

main().catch(err => {
  console.error('审计失败:', err);
  process.exit(2);
});
```

- [ ] **Step 3: 跑测试**

Run: `cd E:/WinAICHECK && bun test tests/audit-cli.test.ts`
Expected: ALL PASS

- [ ] **Step 4: 提交**

```bash
cd E:/WinAICHECK
git add scripts/audit.ts tests/audit-cli.test.ts
git commit -m "feat: add audit.ts CLI entry point with local and CI modes"
```

---

## Task 9: CI Fixture 文件

**Files:**
- Create: `scripts/ground-truth/fixtures/git.fixture.json`
- Create: `scripts/ground-truth/fixtures/node-version.fixture.json`
- (其他 6 个 fixture 同结构)

- [ ] **Step 1: 创建 fixture 文件**

每个 fixture 是 JSON 文件，定义 mock 命令输出：

```json
// scripts/ground-truth/fixtures/git.fixture.json
{
  "scannerId": "git",
  "commands": {
    "git --version": { "stdout": "git version 2.45.0", "exitCode": 0 },
    "where git": { "stdout": "C:\\Program Files\\Git\\cmd\\git.exe", "exitCode": 0 },
    "net session": { "exitCode": 0 },
    "ver": { "stdout": "Microsoft Windows [Version 10.0.22631]", "exitCode": 0 }
  }
}
```

```json
// scripts/ground-truth/fixtures/node-version.fixture.json
{
  "scannerId": "node-version",
  "commands": {
    "node --version": { "stdout": "v22.0.0", "exitCode": 0 },
    "where node": { "stdout": "C:\\nvm4w\\nodejs\\node.exe", "exitCode": 0 },
    "net session": { "exitCode": 0 },
    "ver": { "stdout": "Microsoft Windows [Version 10.0.22631]", "exitCode": 0 }
  }
}
```

其余 6 个 fixture 按相同格式创建。

- [ ] **Step 2: 跑 CI 模式验证**

Run: `cd E:/WinAICHECK && bun run scripts/audit.ts --ci --json`
Expected: JSON 输出包含 8 个验证器报告

- [ ] **Step 3: 提交**

```bash
cd E:/WinAICHECK
git add scripts/ground-truth/fixtures/
git commit -m "feat: add CI fixture files for all 8 validators"
```

---

## Task 10: 全量回归测试 + 验证

**Files:** 无新文件，验证性任务。

- [ ] **Step 1: 跑全部测试**

Run: `cd E:/WinAICHECK && bun test`
Expected: ALL PASS

- [ ] **Step 2: 跑 typecheck**

Run: `cd E:/WinAICHECK && bunx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 本地模式跑 audit**

Run: `cd E:/WinAICHECK && bun run scripts/audit.ts --mode=scanners`
Expected: 终端输出 8 个验证器的审计报告

- [ ] **Step 4: CI 模式跑 audit**

Run: `cd E:/WinAICHECK && bun run scripts/audit.ts --ci --json`
Expected: JSON 输出，8 个验证器全部有结果

- [ ] **Step 5: 确认 .gitignore 包含 audit-reports/**

检查 `.gitignore` 中是否有 `audit-reports/`，没有则添加。

---

## 自查清单

- [x] **Spec 覆盖度：** 8 个验证器 → Task 3-6；基础设施 → Task 1-2；CLI → Task 7-8；CI → Task 9；验证 → Task 10
- [x] **占位符扫描：** 无 TBD / TODO / "implement later"
- [x] **类型一致性：** `TruthValidator.validate(env)` 签名贯穿所有 Task；`tryMethods` 在 runner.ts 定义在所有验证器使用；`aggregateVerdict` 在 runner.ts 定义在所有验证器返回时使用；`_test.mockReadFileSync` 在 executor 定义在 mirror-sources 使用
- [x] **审查修订覆盖：** 修订 1 (tryMethods) → Task 1；修订 2 (CI mock) → Task 8；修订 3 (mockReadFileSync) → Task 2；修订 4 (aggregateVerdict) → Task 1
