# Changelog

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
