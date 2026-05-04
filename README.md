<h1 align="center">WinAICheck</h1>
<p align="center"><strong>Windows AI 开发环境一键诊断与修复 + AI 工具一键安装 + Coding Plan 导航</strong></p>
<p align="center">
  <a href="https://github.com/gugug168/WinAICheck/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License"></a>
  <a href="https://www.npmjs.com/package/winaicheck"><img src="https://img.shields.io/npm/v/winaicheck.svg" alt="npm"></a>
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
- 一键安装 **Claude Code、OpenClaw、CCSwitch、Claude Code 汉化** 等 AI 编程工具
- **Coding Plan 编程套餐**购买直达，按次数计费，不用担心 AI 写代码烧 Token 超预算

> 说明：综合评分主要反映核心环境健康度。像 OpenClaw、CCSwitch、uv、WSL 这类可选工具或附加能力，会给出提示，但不会再直接拉低核心得分。
>
> 说明：防火墙、站点连通性、DNS 等网络类结果，部分属于“能力提示”而非“系统故障判定”。例如未发现显式入站放行规则，并不等同于本地开发端口一定不可用。

## AI 工具一键安装

Web UI 的"AI 工具安装"Tab 提供一键安装：

| 工具 | 说明 | 需要管理员 |
|:-----|:-----|:----------|
| Claude Code | CLI + MCP 服务器 + CC Switch，含 Node.js/Git 环境 | 是 |
| OpenClaw | 开源 Claude Code 替代品，支持 OpenRouter 等兼容 API | 否 |
| CCSwitch | Claude Code 多账号/API Key 切换工具 | 是 |
| Claude Code 汉化 | 中文界面汉化 + 实用 Hooks 集合 | 否 |

安装过程通过 SSE 实时显示进度，全程可视。

## Coding Plan 编程套餐导航

Web UI 的"AI 资源"Tab 提供国内 Coding Plan 购买直达：

**推荐购买 Coding Plan（按次数计费）**，而不是 API（按 Token 计费）。AI 编程一次对话消耗几千 Token，按 Token 计费容易超预算。

| 平台 | 起步价 | 包含模型 |
|:-----|:-------|:---------|
| 智谱 GLM Coding Plan | ¥20/月 | GLM-5/4.6 系列 |
| 阿里云百炼 Coding Plan | 首月¥7.9 | 千问/Kimi/GLM 多模型 |
| 腾讯云 Coding Plan | 首月¥7.9 | 混元/GLM-5/Kimi 多模型 |
| 火山方舟 Coding Plan (字节) | ¥9.9/月 | 豆包/GLM/DeepSeek/Kimi |
| 百度千帆 Coding Plan | ¥40/月 | 文心+多模型 |
| Kimi Code (月之暗面) | 会员权益 | K2.5 编程模型 |
| MiniMax Token Plan | ¥40/月 | M2.5 全模态（编程+生图+语音） |
| 无问芯穹 Infini Coding | ¥40/月 | 聚合多家顶尖编程模型 |

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

### 首次运行信任说明

当前公开 MVP 分发主要来自：

- GitHub Releases
- `npx winaicheck`
- PowerShell 安装脚本

首次运行时，Windows Defender 或 SmartScreen 可能提示未知发布者或要求额外确认。这不应被理解成“文件一定有问题”，但也不应跳过来源校验。

建议至少核对：

1. 下载地址是否来自官方仓库或对应 release
2. 版本号、tag、README 说明是否一致
3. 发版说明是否与 AICOEVO 平台文档中的手动发布记录一致

### 杀毒软件误报说明

**WinAICheck.exe 可能被 360 安全卫士、Windows Defender 等杀毒软件误报为病毒并删除。这是误报，不是病毒。**

原因：WinAICheck 使用 Bun 编译为独立 EXE（内嵌运行时），且软件行为包括扫描系统硬件信息、上传诊断数据——这些特征与杀毒引擎的"恶意软件"启发式规则高度相似，导致误报。

**解决方法（任选其一）：**

1. **360 安全卫士**：打开 360 → 木马查杀 → 左下角"信任区" → 添加信任文件/目录 → 选择 WinAICheck.exe
2. **Windows Defender**：设置 → 更新和安全 → Windows 安全中心 → 病毒和威胁防护 → 管理设置 → 排除项 → 添加排除项 → 选择 WinAICheck.exe
3. **下载 ZIP 包而非直接下载 EXE**：浏览器对压缩包的拦截更宽容

我们已经向 360、Microsoft Defender 等厂商提交了白名单申请，正在处理中。

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

## Agent Lite 轻量探针

第一次可以用完整 WinAICheck.exe 完成环境诊断、工具安装和授权。启用 Agent 错误探索后，WinAICheck 会把轻量 runner 安装到 `~/.aicoevo/agent/`，后续 Claude Code / OpenClaw 运行时只调用这个轻量 runner，不再启动完整 100MB 程序。

```bash
# 推荐：启用 Claude Code settings hook + OpenClaw PowerShell hook
npx winaicheck agent enable --target all

# 仅迁移 Claude Code 到 settings hook
npx winaicheck agent migrate --target claude-code

# 旧方式：仅在需要兼容 OpenClaw 或排查问题时使用 PowerShell hook
npx winaicheck agent install-hook --target openclaw

# 手动记录一次 Agent 错误
npx winaicheck agent capture --agent claude-code --message "MCP config JSON parse error"

# 查看本地上传清单与每日问题包
npx winaicheck agent uploads --local
npx winaicheck agent summary --date today

# 同步到 AICOEVO 并读取最新建议
npx winaicheck agent sync
npx winaicheck agent advice --format markdown

# 暂停或恢复自动上传
npx winaicheck agent pause
npx winaicheck agent resume
```

`npx winaicheck agent bind` 的主流程会自动打开 AICOEVO 绑定页；如果浏览器里已经登录，只需在网页中点一次确认即可完成绑定。6 位绑定码仍保留为兼容兜底流程，仅在手动调试或旧客户端场景下使用，例如 `npx winaicheck agent bind --code 123456`。

Claude Code 监控使用 `.claude/settings.json` 中的 `SessionStart` / `PostToolUse` hooks，不再拦截 `claude` 命令本身；即使 WinAICheck hook 出错，也不会阻止 Claude Code 启动。

轻量探针只上传脱敏后的错误摘要、错误指纹、Agent 类型、时间和粗粒度环境信息；不会上传源码、完整日志、完整路径或 API Key。所有事件会先写入 `~/.aicoevo/outbox/events.jsonl`，上传账本保存在 `~/.aicoevo/uploads/ledger.jsonl`，每日趋势保存在 `~/.aicoevo/daily/`。

### Owner safe auto-repair

Phase 6 的 owner task 现已支持一个受限的 Windows 本地安全自动修复闭环，但只放行 3 个经过测试的 L2 修复类型：

- `powershell-policy`
- `long-paths`
- `firewall-ports`

自动修复必须同时满足这些门禁：

- 当前机器就是平台路由到的 owner 目标机器
- 平台任务 `risk_level` 为 `L2`
- 用户已授权，或任务处于 `full_auto_limited`
- 平台声明 `rollback_state=ready`
- 本地执行后能够形成 before/after 证据并回传平台

不在 allowlist 内的修复项、缺少 consent、缺少 rollback、或更高风险级别任务，都会被 worker 明确阻止，不会静默执行。

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
├── constants.ts      # 版本号与全局常量
├── scanners/         # 25 个扫描器
├── fixers/           # 25 个修复器（backup → execute → rollback）
├── scoring/          # 加权评分
├── installers/      # AI 工具安装器（Claude Code、OpenClaw、CCSwitch、汉化）
├── web/              # Web UI（诊断 + 安装 + 资源导航）
├── executor/         # 命令执行
├── report/           # 报告生成
├── privacy/          # 隐私保护
└── agent/            # Agent Lite 嵌入源码 + 本地状态管理
```

## 技术栈

Bun + TypeScript | 108 个测试全通过 | MIT License

## 微信交流群

扫描二维码加入 WinAICheck 交流群，获取使用帮助和最新动态：

<p align="center">
  <img src=".github/assets/wechat-qr.png" alt="微信群二维码" width="200">
</p>

## 反馈与贡献

发现问题？有建议？欢迎提 [Issue](https://github.com/gugug168/WinAICheck/issues) 或 PR。
