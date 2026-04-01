# Claude Code 一键安装包

## 📦 包含内容

1. **install-claude-code-windows.ps1** - Windows 安装脚本
2. **install-claude-code-universal.sh** - Linux/macOS 安装脚本

## 🚀 使用方法

### Windows 用户

1. **以管理员身份打开 PowerShell**
   - 右键点击 PowerShell 图标
   - 选择"以管理员身份运行"

2. **允许脚本执行**
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

3. **运行脚本**
   ```powershell
   .\install-claude-code-windows.ps1
   ```

4. **等待安装完成**（约10-15分钟）

5. **重启 PowerShell 窗口**

6. **验证安装**
   ```powershell
   claude --version
   node --version
   git --version
   ```

### Linux/macOS 用户

1. **打开终端**

2. **运行脚本**
   ```bash
   bash install-claude-code-universal.sh
   ```

3. **等待安装完成**（约5-10分钟）

4. **验证安装**
   ```bash
   claude --version
   node --version
   git --version
   ```

## 📋 安装内容

### 核心组件
- ✅ Node.js（自动检测版本）
- ✅ Git（版本控制）
- ✅ Claude Code CLI（AI 编程助手）

### MCP 服务器（3个）
1. **filesystem** - 文件操作（读写、移动、创建）
2. **memory** - 对话记忆、上下文保存
3. **sequential-thinking** - 结构化思考（推理、分析）

### Skills（自动安装）
- find-skills - 查找技能
- skill-creator - 创建技能
- brave-search - 网络搜索
- web-search - 网络搜索（备用）

## ⚙️ 配置文件位置

### Windows
- MCP 配置：`C:\Users\<用户名>\.claude\mcp_settings.json`
- 桌面文档：`C:\Users\<用户名>\Desktop\ClaudeCode\README.md`

### Linux/macOS
- MCP 配置：`~/.claude/mcp_settings.json`
- 桌面文档：`~/Desktop/ClaudeCode/README.md`

## 🔧 下一步操作

安装完成后，你需要：

1. **登录 Claude Code**
   ```bash
   claude login
   ```

2. **配置 API（推荐阿里云百炼）**
   - Base URL: https://coding.dashscope.aliyuncs.com/api/anthropic
   - API Key: https://dashscope.console.aliyun.com/

3. **开始使用**
   ```bash
   claude chat
   ```

## ❓ 常见问题

### Windows: "无法运行脚本"
**解决方法：**
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Linux: "Permission denied"
**解决方法：**
```bash
chmod +x install-claude-code-universal.sh
```

### 安装失败
**可能原因：**
- 网络问题（检查网络连接）
- 权限不足（使用管理员/sudo权限）
- 磁盘空间不足（检查磁盘空间）

**解决方法：**
- 检查网络连接
- 使用管理员权限运行
- 清理磁盘空间

## 📞 技术支持

如有问题，请联系：
- 飞书：蟹老板_老王
- GitHub: https://github.com/openclaw/openclaw

## 📝 更新日志

### v2.0 (2026-03-05)
- ✅ 修复 MCP 包名错误
- ✅ 减少到 3 个核心 MCP 服务器
- ✅ 添加完整的错误处理
- ✅ 创建桌面文档和使用说明

---

**创建时间：** 2026-03-05
**作者：** 小A - OpenClaw AI Assistant
