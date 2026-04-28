# Changelog

## [0.3.14] - 2026-04-28

### Added
- 集中式扫描器阈值配置 (`src/scanners/thresholds.ts`)：Git 最低版本、GPU 驱动最低主版本号、Node.js 最低主版本号、镜像源正则模式，统一管理不再各文件硬编码
- 语义化版本比较函数 `compareVersions()`，支持不等长版本号、"unknown" 边界、非数字段
- 执行器诊断钩子 (`_diag`)：`onCommand`/`onReg`/`onPS` 观察者回调，不干扰执行，与 `_test` mock 共存
- 扫描决策链类型 `ScanDiagnostic`/`DecisionStep`，以及 `scanWithDiagnostic()` 包装器，可捕获完整扫描决策过程
- 114 行阈值配置测试 + 91 行诊断钩子测试 + 7 个扫描器边界测试用例

### Changed
- `git.ts` 使用 `compareVersions` + `THRESHOLDS.git.minVersion` 替代硬编码的 `major < 2 || (major === 2 && minor < 30)` 逻辑，并新增 unknown 版本保护
- `gpu-driver.ts` 使用 `THRESHOLDS.gpu_driver.minDriverMajor` 替代硬编码 `525`，新增 `isNaN` 保护
- `node-version.ts` 使用 `THRESHOLDS.node.minMajor` 替代硬编码 `18`，新增 `isNaN` 保护
- `mirror-sources.ts` 使用 `THRESHOLDS.mirror_sources` 集中正则模式替代内联正则

## [0.3.6] - 2026-04-18

### Added
- **Agent 自动更新检查**: Claude Code 捕获错误后，自动检查 WinAICheck 是否有新版本。有更新时在对话中显示提醒 `[WinAICheck] 发现新版本 vX.X.X → vX.X.X`。
- `agent check-update` 命令：查询 GitHub VERSION 文件，1 小时 TTL 缓存，支持 `deps.fetchImpl` 注入测试。
- 安装 Agent 时自动写入当前版本号到 `~/.aicoevo/version-cache.json`。

### Changed
- PostToolUse hook 在捕获错误后额外调用 `check-update`，8 秒超时，失败静默。
- Agent 启用检测：`getAgentLocalStatus()` 同时识别 `settings` hook 类型和旧版 PowerShell hook。

## [0.3.5] - 2026-04-15

### Fixed
- 修复 Windows 上 Claude Code 同时存在 extensionless shim 和 `.cmd` shim 时，Agent Hook 误选 extensionless 路径导致 `spawn ENOENT` 的问题。
- 本地经验库现在能识别 Claude Code 的 `unknown option` 参数错误。

## [0.3.4] - 2026-04-14

### Added
- Agent Lite 支持本地经验库建议、连续失败诊断和一键启用监控。
- Agent 运行包装器会同时捕获 stdout/stderr 中的常见错误块，退出码为 0 但有错误输出时也会记录 warn 事件。
- 扫描器增加单项 30 秒超时保护，可通过 `WINAICHECK_SCANNER_TIMEOUT_MS` 调整。

### Changed
- Web 端 Agent 状态会展示最近本地经验库命中记录，并通过新的 `enable` 命令完成安装和自动同步配置。
- 测试脚本改为自动发现全部测试文件，并逐文件运行，避免 Bun Windows 聚合测试崩溃。

### Fixed
- 修复 Windows 下 `bun run build` 因 shell 语法不兼容导致 UPX 成功后仍返回失败的问题。

## [0.3.2] - 2026-04-12

### Added
- npm 包 `npx winaicheck` 智能入口：检测到 Bun + 源码时直接运行，无需下载 exe
- 新增 `winaicheck-agent` bin 入口，可直接 `npx winaicheck-agent` 启动轻量 agent 插件

### Changed
- npm 包包含 `src/` 源码目录（~200KB），开发者可直接从源码运行
- Web UI "Agent 进化" tab 升级为 "持续优化插件"（主导航栏），品红霓虹主题，三步价值展示
- build 脚本集成 UPX 压缩并区分未安装/压缩失败两种错误状态

## [0.3.1] - 2026-04-07

### Fixed
- 修复 `npx winaicheck` 在 Node.js ESM 环境下因 `require()` 报错后直接崩溃的问题
- 修复 npm 包包装器的 GitHub Releases 最新版本请求地址，避免下载流程异常

### Changed
- 移除“安装路径空格检测”与对应修复建议，不再把 `Program Files` 等标准 Windows 安装路径视为问题项

## [0.1.0] - 2026-04-01

### 新增
- 25 个环境扫描器，覆盖五大类别：路径环境、工具链、GPU、权限、网络
- 加权评分系统（0-100），按类别重要性加权
- 25 个修复器（原 20 个 + 新增 5 个），四级分类：green/yellow/red/black
- 三阶段修复引擎：backup → execute → verify(重扫) → 失败自动 rollback
- Web UI 模式（Bun.serve，暗色主题，评分卡片 + 分类结果 + 修复按钮）
- 分级确认弹窗（green 直接确认、yellow 需勾选确认、red 警告确认）
- 修复后自动重扫并实时更新 scanner 状态
- CLI 模式（彩色终端输出）
- 报告生成（JSON + HTML）
- 隐私同意系统与数据脱敏
- `/api/fix`、`/api/scan`、`/api/scan-one` API 端点
- 108 个 mock 集成测试，覆盖全部 25 个 scanner
- 自动修复系统设计文档

### 新增修复器（本版本补充）
- `admin-perms`: 管理员权限运行提示
- `package-managers`: 自动安装缺失包管理器（bun）
- `path-spaces`: 路径空格问题指引
- `unix-commands`: 通过 Git for Windows 安装 Unix 命令
- `wsl-version`: 安装/升级 WSL2
