# 阶段 2：Ground Truth 验证器 + 审计脚本 — 设计规格

> brainstorming reviewed — 2026-04-28

## 背景

阶段 0（阈值集中化）和阶段 1（诊断钩子）已完成。阶段 2 目标：为 8 个高频扫描器编写独立的"第二意见"验证器，能自动发现扫描器的误判、漏判，并生成可操作的审计报告。

## 设计决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 验证器范围 | 8 个，不含 GPU（gpu-driver、cuda-version 后续） | 用户指定 |
| 2 | 验证方法 | 独立命令为主、_diag 诊断审核为辅 | 双重验证，发现方法级和逻辑级问题 |
| 3 | 判定粒度 | 细粒度，每步独立判定 | 精确定位扫描器哪一步出错 |
| 4 | 架构方案 | 独立文件 + 共享 Runner | 跟代码库风格一致，灵活度高 |
| 5 | 审计脚本模式 | 本地 + CI 两种模式，报告格式复用 ScanDiagnostic | 覆盖真实环境和自动化测试 |
| 6 | 报告格式 | 复用 ScanDiagnostic 结构 | 减少类型重复 |

## 8 个验证器

| # | scannerId | 验证器文件 | 关键检查点 | 降级链要点 |
|---|-----------|-----------|-----------|-----------|
| 1 | git | git.truth.ts | 安装检测、版本解析、阈值判定、PATH完整性 | where git → Get-Command git → 注册表 Uninstall |
| 2 | node-version | node-version.truth.ts | 安装检测、版本解析、阈值判定 | where node → Get-Command node → 注册表 |
| 3 | python-versions | python-versions.truth.ts | 安装检测、多版本发现、版本解析 | where python → py --list → 注册表 |
| 4 | long-paths | long-paths.truth.ts | 注册表值读取、判定 | reg query HKLM (管理员) → Get-ItemProperty (非管理员降级) |
| 5 | powershell-policy | powershell-policy.truth.ts | 执行策略读取、多版本共存 | Get-ExecutionPolicy → reg query HKLM |
| 6 | mirror-sources | mirror-sources.truth.ts | pip.ini 读取、npmrc 读取、正则匹配 | 文件存在性检测 → 内容匹配 |
| 7 | wsl-version | wsl-version.truth.ts | WSL 安装检测、版本判定 | wsl --version → wsl --status → wsl --list |
| 8 | firewall-ports | firewall-ports.truth.ts | 端口规则读取、判定 | netsh advfirewall (管理员) → Get-NetFirewallRule (非管理员降级) |

## 文件结构

```
scripts/
  audit.ts                     ← CLI 入口 (--mode=scanners|fixers, --ci, --json)
  ground-truth/
    types.ts                   ← 共享类型 (TruthValidator, ValidationCheck, ValidationReport 等)
    runner.ts                  ← 发现 + 运行验证器 + 收集报告
    git.truth.ts
    node-version.truth.ts
    python-versions.truth.ts
    long-paths.truth.ts
    powershell-policy.truth.ts
    mirror-sources.truth.ts
    wsl-version.truth.ts
    firewall-ports.truth.ts
    fixtures/                  ← CI 模式的 mock 数据
      git.fixture.json
      node-version.fixture.json
      ...
audit-reports/                 ← 报告输出 (.gitignore)
```

## 核心类型

```typescript
// scripts/ground-truth/types.ts

/** 单个检查点判定 */
type CheckVerdict = 'correct' | 'incorrect' | 'partial' | 'skipped';

/** 单个检查点 */
interface ValidationCheck {
  name: string;            // "版本号解析"
  scannerStep: string;     // 对应 _diag 决策链的哪一步
  expectedValue: string;   // 验证器独立获取的真实值
  scannerValue: string;    // 扫描器的值
  verdict: CheckVerdict;
  note?: string;
}

/** 验证器环境 */
interface ValidatorEnv {
  windowsVersion: string;     // "10.0.22631"
  isAdmin: boolean;
  degradedMethods: string[];  // 记录使用了哪些降级方法
}

/** 单个扫描器的完整验证报告 */
interface ValidationReport {
  scannerId: string;
  scannerName: string;
  env: ValidatorEnv;
  checks: ValidationCheck[];
  overallVerdict: CheckVerdict;
  scannerResult: ScanResult;
  scannerDiagnostic?: ScanDiagnostic; // _diag 决策链
}

/** 验证器接口 */
interface TruthValidator {
  id: string;
  name: string;
  validate(env: ValidatorEnv): Promise<ValidationReport>;
}
```

## 验证器内部流程

每个验证器遵循相同的 5 步流程：

```
1. 检测环境
   → Windows 版本 + 管理员权限
   → 记录到 ValidatorEnv

2. 获取真实值（独立方法，不同于扫描器用的命令）
   → 通过 tryMethods() 执行降级链
   → 首选方法不可用 → 降级到备选 → 都不行 → 标记 skipped
   → 自动记录使用了哪些降级方法

3. 运行扫描器（通过 scanWithDiagnostic）
   → 获取 ScanResult + ScanDiagnostic

4. 逐步比对
   → 遍历检查点，对比 expectedValue vs scannerValue
   → 每个检查点独立判定 correct/incorrect/partial/skipped

5. 输出 ValidationReport
   → 通过 aggregateVerdict() 计算整体判定
```

## 降级链规则

每个验证器必须处理以下场景：

| 场景 | 处理方式 |
|------|---------|
| 命令不存在 (Win10 vs Win11) | 降级到兼容命令 |
| 需要管理员权限 | 非管理员时用受限方法，或标记 skipped |
| 命令超时 | 降级到更快的替代命令 |
| 输出格式变化 | 多种正则模式匹配 |

## audit.ts CLI 设计

```
用法: bun run scripts/audit.ts [选项]

选项:
  --mode=scanners    运行扫描器验证器（默认）
  --mode=fixers      运行修复器验证（阶段 4+）
  --ci               CI 模拟模式，用 fixture 数据
  --json             输出 JSON（默认终端彩色表格）
  --output <path>    保存报告文件路径
```

### 本地模式

```
$ bun run scripts/audit.ts --mode=scanners

WinAICheck 扫描器审计 — 2026-04-28
环境: Windows 11 Pro 10.0.22631, 管理员

┌──────────────────┬─────────┬──────────┬────────────┐
│ 扫描器           │ 检查点  │ 正确     │ 问题       │
├──────────────────┼─────────┼──────────┼────────────┤
│ git              │ 4/4     │ ✅ 4     │            │
│ node-version     │ 3/3     │ ✅ 3     │            │
│ python-versions  │ 3/3     │ ✅ 2     │ ⚠️ 1      │
│ long-paths       │ 2/2     │ ✅ 2     │            │
│ powershell-policy│ 2/2     │ ✅ 2     │            │
│ mirror-sources   │ 3/3     │ ✅ 3     │            │
│ wsl-version      │ 2/2     │ ✅ 1     │ ❌ 1      │
│ firewall-ports   │ 2/2     │ ✅ 2     │            │
└──────────────────┴─────────┴──────────┴────────────┘

总计: 21/21 检查点, 17 正确, 1 部分正确, 1 错误, 2 跳过
报告已保存: audit-reports/2026-04-28.json
```

### CI 模式

```
$ bun run scripts/audit.ts --mode=scanners --ci

加载 fixture 数据... 8 个场景
运行验证器... 全部通过
CI 审计: 8/8 验证器判定逻辑正确
```

## 不做的事

- 不做 GPU 相关验证器（gpu-driver、cuda-version）
- 不做修复器验证（阶段 4+）
- 不改扫描器逻辑（只发现问题，不修复）
- 不加遥测/上报
- 不覆盖全部 48 个扫描器

## 审查修订（eng-review 2026-04-28）

### 修订 1：统一降级链执行器 `tryMethods()`

在 `runner.ts` 中提供统一工具函数，消除 8 个验证器的降级链重复代码：

```typescript
/** 降级链方法定义 */
interface DegradableMethod<T> {
  name: string;          // "where git"
  execute: () => T;      // 执行检测
  isAvailable: boolean;  // 是否可用（如命令是否存在）
}

/**
 * 按优先级尝试多个检测方法，自动降级。
 * 返回第一个成功的结果，记录使用的方法名。
 * 全部失败时返回 null 并标记所有尝试过的方法。
 */
function tryMethods<T>(
  methods: DegradableMethod<T>[],
  env: ValidatorEnv
): { result: T | null; usedMethod: string | null };
```

### 修订 2：CI 模式复用 `_test.mockExecSync`

验证器通过 `runCommand` 执行命令，CI 模式由 `audit.ts` 在运行前设置 `_test.mockExecSync`，验证器代码无需感知 mock。fixture JSON 文件定义每个命令的 mock 返回值。

```typescript
// audit.ts CI 模式核心逻辑
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
_test.mockExecSync = createCommandMock(new Map(
  Object.entries(fixture.commands).map(([cmd, resp]) => [cmd, resp])
));
// 运行验证器...
_test.mockExecSync = null; // 清理
```

### 修订 3：新增 `_test.mockReadFileSync`

在 `src/executor/index.ts` 的 `_test` 对象中新增 `mockReadFileSync`，支持 mirror-sources 等文件系统扫描器的 CI 验证：

```typescript
export const _test = {
  mockExecSync: null as ((cmd: string, opts: any) => Buffer) | null,
  mockExistsSync: null as ((path: string) => boolean) | null,
  mockReadFileSync: null as ((path: string) => string | null) | null,  // 新增
};
```

### 修订 4：整体判定聚合规则 `aggregateVerdict()`

在 `runner.ts` 中定义明确的聚合规则：

```typescript
function aggregateVerdict(checks: ValidationCheck[]): CheckVerdict {
  if (checks.length === 0) return 'skipped';
  if (checks.some(c => c.verdict === 'incorrect')) return 'incorrect';
  if (checks.some(c => c.verdict === 'partial')) return 'partial';
  if (checks.every(c => c.verdict === 'skipped')) return 'skipped';
  return 'correct';
}
```

规则优先级：incorrect > partial > correct > skipped。

## 验证器与测试文件的关系

- **验证器** (`scripts/ground-truth/*.truth.ts`)：在真实机器上跑，对比真实值和扫描器输出
- **单元测试** (`tests/*.test.ts`)：用 mock 数据跑，验证验证器本身的判定逻辑
- 两者互补：验证器发现真实环境问题，测试保证验证器代码正确
