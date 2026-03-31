# 自动修复系统设计

日期: 2026-03-31

## 概述

为 aicoevo 的 25 个 scanner 添加完整的自动修复流程：确认弹窗（分级）、执行前备份、失败回滚、执行后单 scanner 重扫验证。

## 需求

- 所有 tier (green/yellow/red/black) 都可自动执行
- 确认弹窗按风险等级递严
- 所有操作必须支持 rollback
- 修复后自动重扫对应 scanner，UI 实时更新

## 设计

### 1. Fixer 接口扩展

```typescript
interface Fixer {
  scannerId: string;
  getFix(result: ScanResult): FixSuggestion;
  backup?(result: ScanResult): Promise<BackupData>;
  execute(fix: FixSuggestion, backup: BackupData): Promise<FixResult>;
  rollback?(backup: BackupData): Promise<void>;
}

interface BackupData {
  scannerId: string;
  timestamp: number;
  data: Record<string, string>;  // 旧值键值对
}
```

### 2. 执行引擎三阶段流程

```
POST /api/fix { fixId, scannerId, tier }
  → backup()   记录旧值
  → execute()  执行修复
  → verify()   重扫对应 scanner
  → 失败时 rollback()
```

### 3. 确认弹窗分级

| Tier | 弹窗内容 | 确认操作 |
|------|---------|---------|
| green | 描述 + 命令 + 风险 | 点"确认执行" |
| yellow | 描述 + 命令 + 风险 + 影响范围 | 勾选"我已了解风险" + 确认 |
| red | 描述 + 命令 + 风险 + 警告色 | 勾选"我已了解风险" + 确认 |
| black | 描述 + 信息 + 建议操作 | 确认执行 |

### 4. Backup/Rollback 策略

| 修复类型 | Backup | Rollback |
|---------|--------|----------|
| 注册表 (long-paths) | reg query 读旧值 | reg add 写回 |
| PowerShell 策略 | Get-ExecutionPolicy | Set-ExecutionPolicy 写回 |
| 镜像源配置 | 读 pip.ini/.npmrc 旧内容 | 写回旧内容 |
| 防火墙端口 | 记录新规则名 | netsh delete rule |
| 安装类 (winget) | 记录 package-id | winget uninstall |
| TEMP 清理 | 移到 backup 文件夹 | 移回原位 |
| 时间同步 | 无需 (幂等) | w32tm /resync |
| 只读分析 | 无需 | 空操作 |

### 5. API

```
POST /api/fix
  请求: { fixId, scannerId, tier }
  响应: { success, message, rolledBack?, newScanResult? }

POST /api/scan-one  (新增)
  请求: { scannerId }
  响应: { result: ScanResult }
```

### 6. 前端交互

1. 用户点击"修复" → 弹出对应 tier 的确认弹窗
2. 确认 → 按钮 loading
3. POST /api/fix → 三阶段执行
4. 成功：UI 更新 scanner 状态 (fail→pass) + 按钮变"已修复"
5. 失败+已回滚：显示"修复失败，已自动恢复" + 按钮"重试"
6. 修复后自动重扫，UI 实时更新评分

## 文件改动

| 文件 | 改动 |
|------|------|
| src/scanners/types.ts | 新增 BackupData, Fixer 接口加 backup/rollback |
| src/fixers/index.ts | 各 fixer 实现 backup/rollback, executeFix 三阶段 |
| src/web/ui.ts | 确认弹窗 + 执行状态 + 单 scanner 重扫更新 |
| src/main.ts | /api/fix 调整 + /api/scan-one 新增 |
