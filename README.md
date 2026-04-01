<h1 align="center">WinAICheck</h1>
<p align="center"><strong>Windows AI 开发环境一键诊断与修复工具</strong></p>
<p align="center">
  <a href="https://github.com/gugug168/WinAICheck/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-orange.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows-blue.svg" alt="Platform">
</p>

---

## 它能做什么？

你的 Windows 电脑准备好跑 AI 了吗？一条命令就知道：

- 检测 **GPU 驱动、CUDA、显存** 是否满足 AI 需求
- 检测 **Python、Node.js、Git、C++ 编译器** 是否正确安装
- 检测 **网络、镜像源、代理、SSL** 是否通畅
- 检测 **权限、防火墙、路径** 是否有隐患
- 给出 **0-100 综合评分**，哪里有问题一目了然
- 一键自动修复常见问题（**修复前自动备份，失败自动回滚**）

## 快速安装

### 方式一：PowerShell 一键安装（推荐）

打开 PowerShell，粘贴这一行：

```powershell
irm https://raw.githubusercontent.com/gugug168/WinAICheck/main/install.ps1 | iex
```

自动下载最新版并启动，无需手动安装任何依赖。

### 方式二：npm / npx

```bash
npx winaicheck
```

首次运行自动从 GitHub Release 下载 exe，后续使用缓存。

### 方式三：手动下载 exe

去 [Releases](https://github.com/gugug168/WinAICheck/releases) 页面下载 `WinAICheck.exe`，双击运行。

### 方式四：从源码运行（开发者）

需要先安装 [Bun](https://bun.sh)：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

```bash
git clone https://github.com/gugug168/WinAICheck.git
cd WinAICheck
bun install
bun run dev
```

浏览器会自动打开诊断页面。

## 发布新版本

```bash
# 1. 更新 package.json 中的 version
# 2. 提交并打 tag
git add . && git commit -m "release: v0.x.x"
git tag v0.x.x
git push origin main --tags
# 3. GitHub Actions 自动构建并创建 Release
# 4. npm 发布
npm publish
```

## 两种使用方式

### Web UI 模式（推荐）

```bash
bun run src/main.ts
```

打开浏览器，看到评分页面。点击"一键修复"按钮即可自动修复问题。

### CLI 终端模式

```bash
bun run src/main.ts -- --cli
```

在终端里直接看结果：

```
评分: 66/100 — 一般

  ✓ Git 检测: Git 正常 (2.51.1)
  ✓ GPU 驱动检测: NVIDIA GeForce RTX 5060 Ti (驱动 591.74)
  ⚠ Python 版本检测: Python 版本过旧 (3.7.0)，建议 3.8+
  ✗ C/C++ 编译器检测: 未检测到 C/C++ 编译器
  ...
```

### 更多选项

```bash
bun run src/main.ts -- --port=8080    # 指定端口
bun run src/main.ts -- --cli --report  # 生成 JSON + HTML 报告
bun run src/main.ts -- --cli --json    # 仅输出 JSON
bun run src/main.ts -- --help          # 查看帮助
```

## 诊断覆盖范围

| 类别 | 检查项 | 权重 |
|:-----|:-------|:-----|
| 路径与环境 | 中文路径、空格路径、长路径、PATH长度、临时空间 | x1.5 |
| 权限与安全 | 管理员权限、PowerShell策略、防火墙、时间同步 | x1.2 |
| 核心工具链 | Git、Node.js、Python、C++编译器、包管理器、Unix命令 | x1.0 |
| 网络与镜像 | 镜像源、代理、SSL证书、AI站点可达性、DNS | x1.0 |
| 显卡与子系统 | GPU驱动、虚拟化、WSL、CUDA、显存 | x0.8 |

共 **25 个检查项**，全部配备修复建议。

## 修复系统

所有检查项都有对应的修复方案，按风险分 4 级：

| 级别 | 说明 | 操作方式 |
|:-----|:-----|:---------|
| 🟢 一键修复 | 低风险操作 | 点按钮直接执行 |
| 🟡 确认修复 | 需要注意影响 | 勾选确认后执行 |
| 🔴 操作指引 | 高风险，需手动操作 | 给出详细步骤 |
| ⚫ 仅供参考 | 信息告知 | 提示即可 |

**所有自动修复都支持备份和回滚**：修复前记录旧配置，修复失败自动恢复。

## 从源码构建 exe

```bash
bun run build
# 输出: dist/WinAICheck.exe
```

## 项目结构

```
src/
├── main.ts           # 入口
├── scanners/         # 25 个扫描器
├── fixers/           # 25 个修复器（backup → execute → rollback）
├── scoring/          # 加权评分
├── web/              # Web UI
├── executor/         # 命令执行
├── report/           # 报告生成
└── privacy/          # 隐私保护
```

## 技术栈

Bun + TypeScript | 108 个测试全通过 | MIT License

## 反馈与贡献

发现问题？有建议？欢迎提 [Issue](https://github.com/gugug168/WinAICheck/issues) 或 PR。
