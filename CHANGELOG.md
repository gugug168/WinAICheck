# Changelog

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
