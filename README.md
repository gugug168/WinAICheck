# WinAICheck - Windows AI 开发环境诊断工具

[![GitHub](https://img.shields.io/badge/GitHub-gugug168%2FWinAICheck-blue?logo=github)](https://github.com/gugug168/WinAICheck)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-orange.svg)](CHANGELOG.md)

Windows AI 开发环境一键诊断与修复工具。扫描 25 个维度，给出加权评分和分级修复建议。

## 功能

- **25 个扫描器**: 路径环境、工具链、GPU、权限、网络五大类别
- **加权评分**: 按类别重要性加权计算 0-100 分
- **25 个修复器**: 4 级风险分类，全部覆盖
- **安全回滚**: 修复前自动备份，失败自动回滚（三阶段引擎）
- **Web UI**: 暗色主题浏览器界面，分级确认弹窗，实时修复与重扫
- **CLI 模式**: 纯终端彩色输出

## 截图

```
评分: 66/100 — 一般

  ✓ 用户路径中文检测: 用户目录路径正常
  ⚠ 安装路径空格检测: 1 个工具安装在含空格路径下
  ✓ Git 检测: Git 正常 (2.51.1)
  ✓ GPU 驱动检测: NVIDIA GeForce RTX 5060 Ti (驱动 591.74)
  ✓ WSL 版本检测: WSL2 已安装并配置正确
  ✓ 显存使用检测: 1929/16311 MB (12%)
  ...
```

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/gugug168/WinAICheck.git
cd WinAICheck

# 安装依赖（需要 Bun）
bun install

# Web UI 模式（默认，自动打开浏览器）
bun run dev

# CLI 模式
bun run dev:cli

# 生成报告
bun run dev:cli -- --report   # JSON + HTML
```

## 构建 exe

```bash
bun run build
# 输出: dist/WinAICheck.exe
```

## 项目结构

```
src/
├── main.ts           # 入口（CLI / Web 模式）
├── scanners/         # 25 个环境扫描器
│   ├── types.ts      # 类型定义（Scanner, Fixer, BackupData）
│   ├── registry.ts   # 注册表 + 并发执行
│   └── index.ts      # 扫描器注册
├── fixers/           # 修复系统（backup → execute → verify → rollback）
├── scoring/          # 加权评分算法
├── executor/         # 命令执行工具
├── web/              # Web UI 生成
├── report/           # JSON/HTML 报告
└── privacy/          # 隐私同意与数据脱敏
```

## 扫描类别

| 类别 | 权重 | 扫描项 |
|------|------|--------|
| 路径与系统环境 | x1.5 | 中文路径、空格、长路径、PATH长度、临时空间 |
| 权限与安全 | x1.2 | 管理员权限、PowerShell策略、防火墙、时间同步 |
| 核心工具链 | x1.0 | Git、Node、Python、C++编译器、包管理器、Unix命令 |
| 网络与镜像 | x1.0 | 镜像源、代理、SSL证书、站点可达性、DNS解析 |
| 显卡与子系统 | x0.8 | GPU驱动、虚拟化、WSL、CUDA、显存 |

## 修复系统

| 风险等级 | 说明 | 示例 |
|----------|------|------|
| green 一键修复 | 低风险，确认即可执行 | 镜像源配置、PowerShell策略、长路径支持 |
| yellow 确认修复 | 需勾选确认后执行 | Git安装、防火墙端口、WSL2安装 |
| red 操作指引 | 高风险，提供手动步骤 | 中文路径、GPU驱动、虚拟化 |
| black 仅供参考 | 信息告知 | CUDA兼容参考、SSL诊断 |

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript
- **Web服务**: Bun.serve
- **测试**: Bun test (108 个 mock 集成测试)

## License

[MIT](LICENSE)
