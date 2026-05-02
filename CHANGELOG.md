# Changelog

## [0.3.14] - 2026-05-02

### Fixed
- **社区上传**: 修复了社区数据上传时 `score` 字段类型不一致导致的校验失败问题，确保 `score` 始终为数字。
- **运行时稳定性**: 优化了 `agent-lite` 中的敏感信息脱敏正则表达式，修复了导致 Bun 在 Windows 环境下偶发 `Segmentation fault` 的 JIT 兼容性问题。
- **脱敏逻辑**: 增强了对带空格的 Windows 用户名路径的脱敏识别能力。
- **CLI 输出**: 修复了 CLI 模式下扫描详情多行输出被截断的问题。

## [0.3.13] - 2026-05-02

### Fixed
- 生产稳定性加固：实现 Web 服务优雅退出，彻底解决端口占用导致的服务闪退问题。
- UI 运行时修复：优化脚本加载顺序，修复 `switchTab is not defined` 及旧环境下的 JS 语法兼容性错误。
- 隐私安全增强：完善 `sanitizer` 正则，支持带空格的 Windows 用户路径脱敏。

### Changed
- CLI 体验优化：扫描详情现支持完整多行输出，解决长内容被截断的问题。
- 引导优化：识别 Microsoft Store 版 Python 别名，引导用户使用标准安装以避免环境污染。

## [0.3.12] - 2026-05-01

### Added
- 代理检测升级：支持从 Windows 注册表读取系统全局代理配置，提升网络环境诊断准确率。
- 时间同步优化：增加对中文 Windows `w32tm` 命令输出的正则解析支持。

## [0.3.8] - 2026-05-02

### Added
- WinAICheck worker 现在支持 `execution_task.kind=owner_repair` 的 Windows L2 安全自动修复闭环。
- 新增 owner repair allowlist，首批仅放行 `powershell-policy`、`long-paths`、`firewall-ports` 三个修复类型。
- owner repair 成功或失败后，会向平台提交结构化证据，包括 before/after scan、backup、rollback 和 diff summary。

### Changed
- `FixResult` 扩展为可携带结构化 `backupSummary`、`rollback`、`verification` 元数据，便于 Agent 与平台统一消费。

### Fixed
- worker 对 owner repair 任务现在会正确执行 consent、L2、target machine、rollback readiness 等门禁，不再误落入普通 validation 命令路径。

## [0.3.7] - 2026-05-02

### Added
- 支持平台下发 Owner Auto Validation 的拦截与放行网关（`prepare_action`），阻止未授权或未人工确认的高危自动执行任务。

### Fixed
- 修复 Bun 安装失败问题（将 winget 包名由 `Bun.HBun` 更正为 `Oven-sh.Bun`）。
- 修复 `temp-space` 修复器在 backup 阶段副作用导致的潜在文件丢失风险。
- 修复 CLI 模式下拒绝隐私上传后仍然可能上传数据的逻辑错误。
- 修正 `env-path-length` 诊断工具的成功语义。
- 修复扫描过程中 SSE 解析异常导致页面假死卡住的问题，并移除了生成 HTML 中的 TypeScript 语法残留（`?.`）。

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
