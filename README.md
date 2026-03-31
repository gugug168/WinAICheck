# aicoevo - AI 环境诊断工具

Windows AI 开发环境一键诊断与修复工具。扫描 25 个维度，给出加权评分和分级修复建议。

## 功能

- **25 个扫描器**: 路径环境、工具链、GPU、权限、网络五大类别
- **加权评分**: 按类别重要性加权计算 0-100 分
- **分级修复**: green(一键) / yellow(确认) / red(指引) / black(告知) 四档
- **安全回滚**: 修复前自动备份，失败自动回滚
- **Web UI**: 暗色主题浏览器界面，实时修复与重扫
- **CLI 模式**: 纯终端彩色输出

## 安装

```bash
# 需要 Bun 运行时
bun install
```

## 使用

```bash
# Web UI 模式（默认，自动打开浏览器）
bun run dev

# CLI 模式
bun run dev -- --cli

# 指定端口
bun run dev -- --port=8080

# 生成报告
bun run dev -- --cli --report   # JSON + HTML
bun run dev -- --cli --json     # 仅 JSON
bun run dev -- --cli --html     # 仅 HTML
```

## 构建

```bash
bun run build
# 输出: dist/aicoevo.exe
```

## 项目结构

```
src/
├── main.ts           # 入口（CLI / Web 模式）
├── scanners/         # 25 个环境扫描器
│   ├── types.ts      # 类型定义
│   ├── registry.ts   # 注册表 + 并发执行
│   └── index.ts      # 扫描器注册
├── fixers/           # 修复系统（backup → execute → verify → rollback）
├── scoring/          # 加权评分算法
├── executor/         # 命令执行工具
├── web/              # Web UI 生成
├── report/           # JSON/HTML 报告
├── privacy/          # 隐私同意与数据脱敏
└── scripts/          # 构建脚本
```

## 扫描类别

| 类别 | 权重 | 扫描项 |
|------|------|--------|
| 路径与系统环境 | ×1.5 | 中文路径、空格、长路径、PATH长度、临时空间 |
| 权限与安全 | ×1.2 | 管理员权限、PowerShell策略、防火墙、时间同步 |
| 核心工具链 | ×1.0 | Git、Node、Python、C++编译器、包管理器、Unix命令 |
| 网络与镜像 | ×1.0 | 镜像源、代理、SSL证书、站点可达性、DNS解析 |
| 显卡与子系统 | ×0.8 | GPU驱动、虚拟化、WSL、CUDA、显存 |

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript
- **Web服务**: Bun.serve
- **测试**: Bun test (108 个 mock 集成测试)
