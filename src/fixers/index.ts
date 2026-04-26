import type { Fixer, FixSuggestion, FixResult, ScanResult, BackupData, FixTier, PostFixGuidance } from '../scanners/types';
import { runCommand, isAdmin, classifyCommandError, commandExists } from '../executor/index';
import { getScannerById } from '../scanners/registry';
import { registerFixer as _registerFixer, getFixers as _getFixers, getFixerByScannerId as _getFixerByScannerId } from './registry';

// Re-export new three-layer architecture (D-19, D-04)
export { classifyError } from './errors';
export { diagnose, formatDiagnostic } from './diagnostics';
export { verifyFix, determineVerificationStatus, buildNextSteps } from './verify';
export { registerFixer, getFixers, getFixerByScannerId } from './registry';
export { clearFixers } from './registry';
export type { ErrorCategory, ClassifiedError } from './errors';
export type { DiagnosticResult } from './diagnostics';
export type { VerificationStatus } from '../scanners/types';

/**
 * 修复系统：4 档分类
 * - green: 一键自动修复（需确认）
 * - yellow: 审查确认执行
 * - red: 只给指引
 * - black: 只告知
 *
 * 三阶段执行: backup() → execute() → verify(重扫)
 * 失败时自动 rollback()
 */

// Delegate to registry.ts to avoid duplication
function registerFixerLocal(fixer: Fixer): void { _registerFixer(fixer); }
function getFixersLocal(): Fixer[] { return _getFixers(); }
function getFixerByScannerIdLocal(scannerId: string): Fixer | undefined { return _getFixerByScannerId(scannerId); }

/** 获取所有需要修复的结果的建议 */
export function getFixSuggestions(results: ScanResult[]): FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];
  for (const result of results) {
    if (result.status === 'pass') continue;
    const fixer = getFixerByScannerIdLocal(result.id);
    if (fixer) {
      suggestions.push(fixer.getFix(result));
    }
  }
  return suggestions;
}

/** 根据修复类型生成修复后指导 */
function generatePostFixGuidance(scannerId: string, _tier: FixTier): PostFixGuidance | undefined {
  const guidance: PostFixGuidance = {};

  // 需要重启终端的修复（PATH、环境变量、全局 npm 包安装）
  const terminalRestartIds = [
    'git-path', 'claude-cli', 'openclaw', 'ccswitch', 'git', 'node-version',
    'package-managers', 'unix-commands', 'powershell-version', 'uv-package-manager',
    'mirror-sources',
  ];
  if (terminalRestartIds.includes(scannerId)) {
    guidance.needsTerminalRestart = true;
  }

  // 需要重启电脑的修复
  const rebootIds = ['wsl-version', 'long-paths', 'virtualization'];
  if (rebootIds.includes(scannerId)) {
    guidance.needsReboot = true;
  }

  // 手动验证命令
  const verifyCommands: Record<string, string[]> = {
    'mirror-sources': ['pip config get global.index-url', 'npm config get registry'],
    'powershell-policy': ['powershell -Command "Get-ExecutionPolicy"'],
    'long-paths': ['reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled'],
    'time-sync': ['w32tm /query /status'],
    'git': ['git --version'],
    'node-version': ['nvm version', 'node --version'],
    'git-path': ['where.exe git', 'where.exe ssh'],
    'wsl-version': ['wsl --status'],
    'package-managers': ['bun --version', 'pip --version', 'npm --version'],
    'unix-commands': ['where.exe ls', 'where.exe curl'],
    'uv-package-manager': ['uv --version'],
    'claude-cli': ['claude --version'],
    'openclaw': ['openclaw --version'],
    'ccswitch': ['ccswitch --version'],
    'powershell-version': ['pwsh --version'],
    'temp-space': ['powershell -Command "(Get-ChildItem $env:TEMP | Measure-Object).Count"'],
    'firewall-ports': ['netsh advfirewall firewall show rule name="Gradio"'],
  };
  const cmds = verifyCommands[scannerId];
  if (cmds) {
    guidance.verifyCommands = cmds;
  }

  // 额外注意事项
  const notes: Record<string, string[]> = {
    'claude-cli': ['首次运行 claude 需要登录 Anthropic 账号'],
    'powershell-version': ['PowerShell 7 (pwsh) 和 Windows PowerShell 5 是两个独立程序，互不影响'],
    'git-path': ['PATH 修改只影响新打开的终端，当前终端不会自动更新'],
    'mirror-sources': ['如果后续安装包仍然很慢，检查网络或尝试其他镜像源'],
    'wsl-version': ['WSL 安装后需要重启电脑才能使用。重启后运行 wsl --status 确认'],
    'long-paths': ['长路径支持需要重启后对所有程序生效'],
  };
  const noteList = notes[scannerId];
  if (noteList) {
    guidance.notes = noteList;
  }

  // 如果没有任何指导内容，不返回
  if (!guidance.needsTerminalRestart && !guidance.needsReboot && !guidance.verifyCommands && !guidance.notes) {
    return undefined;
  }

  return guidance;
}

/** 将修复后指导格式化为用户可读文本 */
function formatPostFixGuidance(guidance: PostFixGuidance): string {
  const lines: string[] = [];

  if (guidance.needsReboot) {
    lines.push('需要重启电脑才能生效');
  } else if (guidance.needsTerminalRestart) {
    lines.push('需要重新打开终端窗口才能生效');
  }

  if (guidance.verifyCommands && guidance.verifyCommands.length > 0) {
    lines.push('手动验证命令:');
    for (const cmd of guidance.verifyCommands) {
      lines.push(`  > ${cmd}`);
    }
  }

  if (guidance.notes && guidance.notes.length > 0) {
    for (const note of guidance.notes) {
      lines.push(`注意: ${note}`);
    }
  }

  return lines.join('\n');
}

/** 根据验证失败的扫描结果生成下一步操作指引 */
function generateNextSteps(scannerId: string, scanResult: ScanResult, tier: FixTier): string[] {
  const steps: string[] = [];

  // 通用：重启终端（PATH 类修复最常见的原因）
  if (['path', 'toolchain'].includes(scanResult.category)) {
    steps.push('关闭当前终端，重新打开一个新终端窗口（环境变量修改需要新终端生效）');
  }

  // 根据 scannerId 给出针对性指引
  const specificSteps: Record<string, string[]> = {
    'mirror-sources': [
      '手动验证: pip config get global.index-url',
      '手动验证: npm config get registry',
    ],
    'powershell-policy': [
      '手动验证: powershell -Command "Get-ExecutionPolicy"',
      '如果仍为 Restricted，请以管理员身份运行: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser',
    ],
    'long-paths': [
      '需要管理员权限才能修改此注册表项',
      '手动验证: reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled',
    ],
    'time-sync': [
      '需要管理员权限',
      '手动验证: w32tm /query /status',
    ],
    'git': [
      '安装完成后需要重启终端',
      '手动验证: git --version',
      '如果 winget 安装失败，尝试从 https://git-scm.com 下载安装',
    ],
    'node-version': [
      'nvm-windows 安装后需要重启终端',
      '手动验证: nvm version',
      '然后安装 Node: nvm install lts',
    ],
    'python-versions': [
      '多版本冲突需要手动处理，建议保留一个主版本',
      '可通过 py -0p 查看所有已安装版本',
    ],
    'firewall-ports': [
      '需要管理员权限',
      '手动验证: netsh advfirewall firewall show rule name="Gradio"',
    ],
    'temp-space': [
      '手动清理: 打开运行(Win+R)，输入 %TEMP%，删除不需要的文件',
      '或使用磁盘清理工具: cleanmgr',
    ],
    'git-path': [
      '修复已完成，但需要重启终端才能在新终端中生效',
      '手动验证: 在新终端运行 where.exe git',
    ],
    'wsl-version': [
      'WSL 安装后需要重启电脑',
      '手动验证: wsl --status',
    ],
    'package-managers': [
      '安装完成后重启终端',
      '手动验证: bun --version',
    ],
    'unix-commands': [
      'Git 安装后需要重启终端',
      '手动验证: where.exe ls',
    ],
    'uv-package-manager': [
      '安装后重启终端',
      '手动验证: uv --version',
      '如果 pip 不可用，尝试: powershell -Command "irm https://astral.sh/uv/install.ps1 | iex"',
    ],
    'claude-cli': [
      '安装后重启终端',
      '手动验证: claude --version',
      '首次运行 claude 需要登录 Anthropic 账号',
    ],
    'openclaw': [
      '安装后重启终端',
      '手动验证: openclaw --version',
    ],
    'ccswitch': [
      '安装后重启终端',
      '手动验证: ccswitch --version',
    ],
    'powershell-version': [
      '安装后需要重启终端',
      '手动验证: pwsh --version',
      'PowerShell 7 安装为独立程序，不影响 Windows PowerShell 5',
    ],
  };

  const specific = specificSteps[scannerId];
  if (specific) {
    steps.push(...specific);
  }

  // 兜底
  if (steps.length === 0) {
    steps.push(`手动验证: 该项检测结果仍为 ${scanResult.status}`);
    if (tier === 'green' || tier === 'yellow') {
      steps.push('尝试重启终端或重启电脑后再重新检测');
    }
  }

  return steps;
}

/** 预检规则：每个 fixer 执行前需要满足的前置条件 */
interface PreflightRule {
  /** 检查是否通过 */
  check: () => boolean;
  /** 不通过时的提示 */
  failMessage: string;
}

const PREFLIGHT_RULES: Record<string, PreflightRule[]> = {
  'mirror-sources': [
    { check: () => commandExists('pip') || commandExists('npm'), failMessage: 'pip 和 npm 都不可用。请先安装 Python 或 Node.js。' },
  ],
  'powershell-policy': [
    { check: () => commandExists('powershell'), failMessage: 'PowerShell 不可用。这是 Windows 系统组件，可能被禁用。' },
  ],
  'long-paths': [
    { check: () => isAdmin(), failMessage: '修改注册表需要管理员权限。请右键本工具，选择"以管理员身份运行"。' },
  ],
  'time-sync': [
    { check: () => isAdmin(), failMessage: '时间同步需要管理员权限。请右键本工具，选择"以管理员身份运行"。' },
  ],
  'git': [
    { check: () => commandExists('winget'), failMessage: 'winget 不可用。请先安装 App Installer（Microsoft Store 搜索"应用安装程序"）。' },
  ],
  'node-version': [
    { check: () => commandExists('winget'), failMessage: 'winget 不可用。请先安装 App Installer（Microsoft Store 搜索"应用安装程序"）。' },
  ],
  'python-versions': [], // 只读诊断，无需预检
  'firewall-ports': [
    { check: () => isAdmin(), failMessage: '修改防火墙规则需要管理员权限。请右键本工具，选择"以管理员身份运行"。' },
  ],
  'temp-space': [], // 清理临时文件无需特殊预检
  'git-path': [], // Git PATH 修复不需要额外前置检查，scanner 已确认 git 存在
  'wsl-version': [
    { check: () => isAdmin(), failMessage: '安装 WSL 需要管理员权限。请右键本工具，选择"以管理员身份运行"。' },
  ],
  'package-managers': [
    { check: () => commandExists('winget'), failMessage: 'winget 不可用。请先安装 App Installer。' },
  ],
  'unix-commands': [
    { check: () => commandExists('winget'), failMessage: 'winget 不可用。请先安装 App Installer。' },
  ],
  'uv-package-manager': [
    { check: () => commandExists('pip') || commandExists('powershell'), failMessage: 'pip 和 PowerShell 都不可用，无法安装 uv。请先安装 Python。' },
  ],
  'claude-cli': [
    { check: () => commandExists('npm'), failMessage: 'npm 不可用。请先安装 Node.js（可在修复建议中选择安装 nvm-windows）。' },
  ],
  'openclaw': [
    { check: () => commandExists('npm'), failMessage: 'npm 不可用。请先安装 Node.js。' },
  ],
  'ccswitch': [
    { check: () => commandExists('npm'), failMessage: 'npm 不可用。请先安装 Node.js。' },
  ],
  'powershell-version': [
    { check: () => commandExists('winget'), failMessage: 'winget 不可用。请先安装 App Installer。' },
  ],
  'env-path-length': [], // 只读诊断
};

/** 执行预检，返回第一条失败信息，全部通过返回 null */
function runPreflight(scannerId: string): string | null {
  const rules = PREFLIGHT_RULES[scannerId];
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    if (!rule.check()) return rule.failMessage;
  }
  return null;
}

const DEFERRED_VERIFICATION_SCANNERS = new Set([
  'git',
  'node-version',
  'package-managers',
  'unix-commands',
  'wsl-version',
  'git-path',
  'uv-package-manager',
  'claude-cli',
  'openclaw',
  'ccswitch',
  'powershell-version',
]);

function shouldDeferVerification(scannerId: string): boolean {
  return DEFERRED_VERIFICATION_SCANNERS.has(scannerId);
}

/** 三阶段执行修复：preflight → backup → execute → verify，失败时 rollback */
export async function executeFix(fix: FixSuggestion): Promise<FixResult> {
  const fixer = getFixerByScannerIdLocal(fix.scannerId);
  if (!fixer) {
    return { success: false, message: `未找到 scanner ${fix.scannerId} 对应的 fixer` };
  }

  // Phase 0: Preflight（预检）
  const preflightFail = runPreflight(fix.scannerId);
  if (preflightFail) {
    return { success: false, message: `前置条件不满足: ${preflightFail}` };
  }

  // Phase 1: Backup
  let backup: BackupData;
  try {
    backup = fixer.backup ? await fixer.backup({} as ScanResult) : emptyBackup(fix.scannerId);
  } catch (err) {
    return { success: false, message: `备份失败: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Phase 2: Execute
  let result: FixResult;
  try {
    result = await fixer.execute(fix, backup);
  } catch (err) {
    // Execute 失败 → 尝试 rollback
    if (fixer.rollback) {
      try {
        await fixer.rollback(backup);
        return {
          success: false,
          message: `修复失败，已自动回滚: ${err instanceof Error ? err.message : String(err)}`,
          rolledBack: true,
        };
      } catch (rollbackErr) {
        return {
          success: false,
          message: `修复失败，回滚也失败: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
          rolledBack: false,
        };
      }
    }
    return { success: false, message: `修复失败: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Execute 失败：标记未验证 + 附加手动指导后返回
  // 注意：partial (部分成功) 场景也要走这里，不要跳过了 guidance
  if (!result.success) {
    result.verified = false;
    const guidance = generatePostFixGuidance(fix.scannerId, fix.tier);
    if (guidance && guidance.verifyCommands) {
      result.postFixGuidance = guidance;
      result.message += `\n\n手动验证:\n${guidance.verifyCommands.map(c => `  > ${c}`).join('\n')}`;
    }
    return result;
  }

  if (shouldDeferVerification(fix.scannerId)) {
    result.verified = false;
    const guidance = generatePostFixGuidance(fix.scannerId, fix.tier);
    if (guidance) {
      result.postFixGuidance = guidance;
      const deferredText = guidance.needsReboot
        ? '该修复需要重启电脑后再重新检测，当前进程内无法准确验证。'
        : '该修复需要重新打开终端后再重新检测，当前进程内无法准确验证。';
      if (!result.message.includes(deferredText)) {
        result.message += `\n\n${deferredText}`;
      }
      const guidanceText = formatPostFixGuidance(guidance);
      if (guidanceText && !result.message.includes(guidanceText)) {
        result.message += `\n\n${guidanceText}`;
      }
    }
    return result;
  }

  // Phase 3: Verify（重扫对应 scanner，验证修复是否真正生效）
  const scanner = getScannerById(fix.scannerId);
  if (!scanner) {
    // 没有 scanner 可验证，返回执行结果但标记为未验证，附加指导
    result.verified = false;
    const guidance = generatePostFixGuidance(fix.scannerId, fix.tier);
    if (guidance) {
      result.postFixGuidance = guidance;
      const guidanceText = formatPostFixGuidance(guidance);
      if (guidanceText) result.message += `\n\n${guidanceText}`;
    }
    return result;
  }

  try {
    const newScan = await scanner.scan();
    result.newScanResult = newScan;

    if (newScan.status === 'pass') {
      // 验证通过：修复真正生效
      result.verified = true;
    } else if (newScan.status === 'warn') {
      // 部分修复：执行成功但仍有警告
      result.verified = true;
      result.partial = true;
      result.nextSteps = generateNextSteps(fix.scannerId, newScan, fix.tier);
      result.message += `\n\n验证结果: ${newScan.message}${result.nextSteps.length > 0 ? '\n建议操作:\n' + result.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''}`;
    } else {
      // 验证未通过：执行成功但问题仍然存在
      result.verified = true;
      result.success = false;
      result.nextSteps = generateNextSteps(fix.scannerId, newScan, fix.tier);
      result.message = `修复已执行，但验证未通过: ${newScan.message}\n\n可能原因和下一步:\n${result.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
  } catch {
    // 重扫异常 → 标记为未验证，不覆盖执行结果
    result.verified = false;
    result.message += '\n\n(无法自动验证修复结果，请手动确认)';
  }

  // Phase 4: 修复后指导
  const guidance = generatePostFixGuidance(fix.scannerId, fix.tier);
  if (guidance) {
    result.postFixGuidance = guidance;
    // 将关键指导附加到消息中，确保 UI 一定能显示
    const guidanceText = formatPostFixGuidance(guidance);
    if (guidanceText && !result.message.includes(guidanceText)) {
      result.message += `\n\n${guidanceText}`;
    }
  }

  return result;
}

/** 空 backup（无需备份的 fixer 使用） */
function emptyBackup(scannerId: string): BackupData {
  return { scannerId, timestamp: Date.now(), data: {} };
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildGitPathFixCommand(): string {
  return [
    '$gitSource=(Get-Command git).Source',
    '$gitCmdDir=Split-Path -Parent $gitSource',
    '$gitDir=Split-Path -Parent $gitCmdDir',
    '$dirs=@("$gitDir\\bin","$gitDir\\usr\\bin")',
    "$path=[Environment]::GetEnvironmentVariable('Path','User')",
    '$entries=@()',
    "if($path){$entries=$path -split ';' | Where-Object { $_ }}",
    "foreach($d in $dirs){ if(-not ($entries -contains $d)){ $entries += $d } }",
    "$newPath=($entries | Select-Object -Unique) -join ';'",
    "[Environment]::SetEnvironmentVariable('Path',$newPath,'User')",
    'echo $newPath',
  ].join('; ');
}

function buildPythonLocatorMessage(lines: string[]): string {
  const output = lines.filter(Boolean).join('\n\n');
  if (!output) {
    return '未发现可用 Python 入口。\n已检查: python、python3、py 启动器、pip。';
  }
  return [
    '以下是当前 Python 相关入口信息。',
    '这一步只用于确认默认版本、路径来源和多版本冲突，不会修改你的环境。',
    '',
    output,
  ].join('\n');
}

export const _testHelpers = {
  escapePowerShellSingleQuotedString,
  buildGitPathFixCommand,
  buildPythonLocatorMessage,
};

/** 将失败的命令结果转为带分类的用户友好消息 */
function commandFailedMessage(r: { exitCode: number; stderr: string; stdout: string; errorHint?: string }, context: string): string {
  if (r.errorHint) return `${context}失败: ${r.errorHint}`;
  const classified = classifyCommandError(r);
  return `${context}失败: ${classified.hint}`;
}

/** 通用执行器：执行命令并分类失败原因 */
function simpleExecute(fix: FixSuggestion, _backup: BackupData, timeout = 15000): Promise<FixResult> {
  if (!fix.commands || fix.commands.length === 0) {
    return Promise.resolve({ success: false, message: '无执行命令' });
  }
  const results: { cmd: string; success: boolean; hint?: string }[] = [];
  let allSuccess = true;

  for (const cmd of fix.commands || []) {
    const r = runCommand(cmd, timeout);
    if (r.exitCode !== 0) {
      allSuccess = false;
      let hint: string;
      try { hint = classifyCommandError(r, timeout).hint; }
      catch { hint = r.errorHint || '未知错误'; }
      results.push({ cmd, success: false, hint });
    } else {
      results.push({ cmd, success: true });
    }
  }

  // 格式化消息，让成功/失败更清晰
  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;

  const lines: string[] = [];
  for (const r of results) {
    // 提取命令名（pip config... → pip）
    const cmdName = r.cmd.split(' ')[0];
    if (r.success) {
      lines.push(`✓ ${cmdName}: 配置成功`);
    } else {
      lines.push(`✗ ${cmdName}: 配置失败 - ${r.hint || '未知错误'}`);
    }
  }

  const summary = failCount === 0
    ? '全部配置成功'
    : successCount === 0
      ? '全部配置失败'
      : `部分成功: ${successCount}/${results.length}`;

  return Promise.resolve({
    success: allSuccess,
    partial: successCount > 0 && failCount > 0,
    message: `${summary}\n${lines.join('\n')}`,
  });
}

/** 创建恢复点（简单版：导出当前注册表/配置状态） */
export function createRestorePoint(tag: string): void {
  // 预留：Phase 2 可实现完整恢复点
}

// ==================== 绿色档（5个，一键修复）====================

// 1. mirror-sources → 写 pip.ini/.npmrc
registerFixerLocal({
  scannerId: 'mirror-sources',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-mirror-sources',
      scannerId: 'mirror-sources',
      tier: 'green',
      description: '配置 pip/npm 国内镜像源（清华源）',
      commands: [
        'pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple',
        'npm config set registry https://registry.npmmirror.com',
      ],
      risk: '低风险：仅修改包管理器下载源',
    };
  },
  async backup(result: ScanResult): Promise<BackupData> {
    const data: Record<string, string> = {};
    const pip = runCommand('pip config get global.index-url', 5000);
    data['pip.index-url'] = pip.exitCode === 0 ? pip.stdout : '';
    const npm = runCommand('npm config get registry', 5000);
    data['npm.registry'] = npm.exitCode === 0 ? npm.stdout : '';
    return { scannerId: 'mirror-sources', timestamp: Date.now(), data };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    return simpleExecute(fix, _backup);
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data['pip.index-url']) {
      runCommand(`pip config set global.index-url "${backup.data['pip.index-url']}"`, 10000);
    }
    if (backup.data['npm.registry']) {
      runCommand(`npm config set registry "${backup.data['npm.registry']}"`, 10000);
    }
  },
});

// 2. powershell-policy → Set-ExecutionPolicy
registerFixerLocal({
  scannerId: 'powershell-policy',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-powershell-policy',
      scannerId: 'powershell-policy',
      tier: 'green',
      description: '设置 PowerShell 执行策略为 RemoteSigned',
      commands: [
        'powershell -Command "Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force"',
      ],
      risk: '低风险：仅允许运行本地脚本',
    };
  },
  async backup(result: ScanResult): Promise<BackupData> {
    const r = runCommand('powershell -Command "Get-ExecutionPolicy -Scope CurrentUser"', 5000);
    return { scannerId: 'powershell-policy', timestamp: Date.now(), data: { oldPolicy: r.stdout.trim() || 'Restricted' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 10000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '执行策略已更新' : commandFailedMessage(r, '设置执行策略') };
  },
  async rollback(backup: BackupData): Promise<void> {
    runCommand(`powershell -Command "Set-ExecutionPolicy ${backup.data.oldPolicy} -Scope CurrentUser -Force"`, 10000);
  },
});

// 3. long-paths → 注册表修改
registerFixerLocal({
  scannerId: 'long-paths',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-long-paths',
      scannerId: 'long-paths',
      tier: 'green',
      description: '启用 Windows 长路径支持（需管理员）',
      commands: [
        'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f',
      ],
      risk: '低风险：启用系统长路径支持',
    };
  },
  async backup(result: ScanResult): Promise<BackupData> {
    const r = runCommand('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled', 5000);
    return { scannerId: 'long-paths', timestamp: Date.now(), data: { LongPathsEnabled: r.exitCode === 0 ? r.stdout : '0' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 10000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '长路径支持已启用' : commandFailedMessage(r, '启用长路径') };
  },
  async rollback(backup: BackupData): Promise<void> {
    const oldVal = backup.data.LongPathsEnabled?.includes('0x1') ? '1' : '0';
    runCommand(`reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d ${oldVal} /f`, 10000);
  },
});

// 4. time-sync → 强制时间同步
registerFixerLocal({
  scannerId: 'time-sync',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-time-sync',
      scannerId: 'time-sync',
      tier: 'green',
      description: '强制同步系统时间（需管理员）',
      commands: ['w32tm /resync /force'],
      risk: '低风险：同步系统时钟',
    };
  },
  async backup(): Promise<BackupData> {
    return emptyBackup('time-sync');
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    if (!isAdmin()) {
      return { success: false, message: '需要管理员权限。请右键以管理员身份运行本工具后重试。' };
    }
    // 先启动时间服务
    runCommand('net start w32time', 5000);
    const r = runCommand(fix.commands![0], 15000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '时间同步成功' : commandFailedMessage(r, '时间同步') };
  },
  // 幂等操作，无需 rollback
});

// 5. env-path-length → 分析重复项
registerFixerLocal({
  scannerId: 'env-path-length',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-env-path-length',
      scannerId: 'env-path-length',
      tier: 'yellow',
      description: '查看 PATH 重复/冗余条目报告（不会自动修改）',
      actionLabel: '查看报告',
      risk: '无风险：只展示诊断信息，需要你手动清理',
    };
  },
  async backup(): Promise<BackupData> {
    return emptyBackup('env-path-length');
  },
  async execute(): Promise<FixResult> {
    const scanner = getScannerById('env-path-length');
    if (!scanner) return { success: false, message: '未找到 PATH 检测器' };
    const result = await scanner.scan();
    const hasIssues = result.status === 'fail' || result.status === 'warn';
    return {
      success: hasIssues,
      message: result.detail
        ? `${result.message}\n\n${result.detail}\n\n说明：当前不会自动改 PATH，请先确认哪些条目确实可以删除。`
        : `${result.message}\n\n说明：当前没有可直接自动修复的 PATH 项。`,
    };
  },
});

// ==================== 黄色档（5个，审查确认）====================

registerFixerLocal({
  scannerId: 'git',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-git',
      scannerId: 'git',
      tier: 'yellow',
      description: '使用 winget 安装/升级 Git',
      commands: ['winget install Git.Git --accept-package-agreements'],
      risk: '中风险：将安装或升级 Git',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('git --version', 5000);
    return { scannerId: 'git', timestamp: Date.now(), data: { gitVersion: r.exitCode === 0 ? r.stdout : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 60000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'Git 安装/升级成功' : commandFailedMessage(r, 'Git 安装') };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.gitVersion === 'not-installed') {
      runCommand('winget uninstall Git.Git', 30000);
    }
  },
});

registerFixerLocal({
  scannerId: 'node-version',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-node-version',
      scannerId: 'node-version',
      tier: 'yellow',
      description: '安装或升级 Node.js LTS',
      commands: ['winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements'],
      risk: '中风险：将安装或升级 Node.js LTS',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('node --version', 5000);
    return { scannerId: 'node-version', timestamp: Date.now(), data: { nodeVersion: r.exitCode === 0 ? r.stdout : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 60000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'Node.js LTS 安装/升级成功' : commandFailedMessage(r, 'Node.js LTS 安装') };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.nodeVersion === 'not-installed') {
      runCommand('winget uninstall OpenJS.NodeJS.LTS', 30000);
    }
  },
});

registerFixerLocal({
  scannerId: 'python-versions',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-python-versions',
      scannerId: 'python-versions',
      tier: 'yellow',
      description: '查看当前 Python 入口、版本和来源，确认是否存在旧版本或多版本冲突',
      actionLabel: '查看详情',
      risk: '无风险：只读取 python/pip/py 路径，不会修改环境',
    };
  },
  async backup(): Promise<BackupData> {
    return emptyBackup('python-versions');
  },
  async execute(): Promise<FixResult> {
    const checks = [
      { label: 'python --version', command: 'python --version' },
      { label: 'python3 --version', command: 'python3 --version' },
      { label: 'where.exe python', command: 'where.exe python' },
      { label: 'where.exe python3', command: 'where.exe python3' },
      { label: 'py -0p', command: 'py -0p' },
      { label: 'pip --version', command: 'pip --version' },
    ];
    const lines: string[] = [];
    let found = false;

    for (const check of checks) {
      const r = runCommand(check.command, 5000);
      const text = (r.stdout || r.stderr || '').trim();
      if (r.exitCode === 0 && text) {
        found = true;
        lines.push(`[${check.label}]\n${text}`);
      }
    }

    return {
      success: found,
      message: buildPythonLocatorMessage(lines),
    };
  },
});

registerFixerLocal({
  scannerId: 'firewall-ports',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-firewall-ports',
      scannerId: 'firewall-ports',
      tier: 'yellow',
      description: '生成开放 AI 常用端口的 netsh 命令',
      commands: [
        'netsh advfirewall firewall add rule name="Gradio" dir=in action=allow protocol=TCP localport=7860',
        'netsh advfirewall firewall add rule name="Jupyter" dir=in action=allow protocol=TCP localport=8888',
        'netsh advfirewall firewall add rule name="Ollama" dir=in action=allow protocol=TCP localport=11434',
      ],
      risk: '中风险：将开放防火墙端口',
    };
  },
  async backup(): Promise<BackupData> {
    return { scannerId: 'firewall-ports', timestamp: Date.now(), data: { rules: 'Gradio,Jupyter,Ollama' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    if (!isAdmin()) {
      return { success: false, message: '需要管理员权限才能修改防火墙规则。请右键以管理员身份运行本工具后重试。' };
    }
    return simpleExecute(fix, _backup);
  },
  async rollback(backup: BackupData): Promise<void> {
    const rules = (backup.data.rules || '').split(',');
    for (const rule of rules) {
      runCommand(`netsh advfirewall firewall delete rule name="${rule}"`, 10000);
    }
  },
});

registerFixerLocal({
  scannerId: 'temp-space',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-temp-space',
      scannerId: 'temp-space',
      tier: 'yellow',
      description: '清理 TEMP 目录中的旧文件',
      commands: ['powershell -Command "Get-ChildItem $env:TEMP | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-7)} | Remove-Item -Recurse -Force"'],
      risk: '中风险：删除 7 天前的临时文件',
    };
  },
  async backup(): Promise<BackupData> {
    // 将旧文件先移到备份目录
    const backupDir = `${process.env.TEMP}\\aicoevo-backup-${Date.now()}`;
    runCommand(`powershell -Command "New-Item -ItemType Directory -Force -Path '${backupDir}'; Get-ChildItem $env:TEMP | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-7)} | Move-Item -Destination '${backupDir}' -Force"`, 15000);
    return { scannerId: 'temp-space', timestamp: Date.now(), data: { backupDir } };
  },
  async execute(_fix: FixSuggestion, backup: BackupData): Promise<FixResult> {
    // backup 阶段已移走文件，这里删除备份目录
    const dir = backup.data.backupDir;
    if (dir) {
      runCommand(`powershell -Command "Remove-Item -Path '${dir}' -Recurse -Force"`, 15000);
    }
    return { success: true, message: '旧临时文件已清理' };
  },
  async rollback(backup: BackupData): Promise<void> {
    const dir = backup.data.backupDir;
    if (dir) {
      // 从备份目录移回 TEMP
      runCommand(`powershell -Command "Get-ChildItem '${dir}' | Move-Item -Destination $env:TEMP -Force"`, 15000);
    }
  },
});

// ==================== 红色档（5个，只给指引）====================

registerFixerLocal({
  scannerId: 'path-chinese',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-path-chinese',
      scannerId: 'path-chinese',
      tier: 'red',
      description: '用户路径包含中文，建议：\n1. 创建新的英文用户名\n2. 或使用符号链接: mklink /D C:\\Users\\EnglishName C:\\Users\\中文名\n3. 部分工具可设置独立安装路径绕过',
      risk: '高风险：需要系统级更改',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('path-chinese'); },
  async execute(): Promise<FixResult> { return { success: false, message: '需手动操作，请参考指引' }; },
});

registerFixerLocal({
  scannerId: 'gpu-driver',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-gpu-driver',
      scannerId: 'gpu-driver',
      tier: 'red',
      description: 'NVIDIA 驱动版本过旧，请访问:\nhttps://www.nvidia.com/Download/index.aspx\n选择对应 GPU 型号下载最新驱动',
      risk: '需手动操作',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('gpu-driver'); },
  async execute(): Promise<FixResult> { return { success: false, message: '需手动操作，请参考指引' }; },
});

registerFixerLocal({
  scannerId: 'virtualization',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-virtualization',
      scannerId: 'virtualization',
      tier: 'red',
      description: '虚拟化未启用，步骤：\n1. 重启电脑进入 BIOS\n2. 找到 Virtualization / VT-x / AMD-V 选项\n3. 设为 Enabled\n4. 保存退出\n5. Windows 设置 → 应用 → 可选功能 → 启用 WSL/Hyper-V',
      risk: '需手动 BIOS 操作',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('virtualization'); },
  async execute(): Promise<FixResult> { return { success: false, message: '需手动操作，请参考指引' }; },
});

registerFixerLocal({
  scannerId: 'cpp-compiler',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-cpp-compiler',
      scannerId: 'cpp-compiler',
      tier: 'red',
      description: '安装 C++ 编译工具：\n1. 下载 VS Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/\n2. 安装时勾选 "C++ 桌面开发" 工作负载\n3. 或使用 winget: winget install Microsoft.VisualStudio.2022.BuildTools',
      risk: '需手动安装',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('cpp-compiler'); },
  async execute(): Promise<FixResult> { return { success: false, message: '需手动操作，请参考指引' }; },
});

registerFixerLocal({
  scannerId: 'proxy-config',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-proxy-config',
      scannerId: 'proxy-config',
      tier: 'red',
      description: '代理配置指南：\n- HTTP_PROXY / HTTPS_PROXY: 用于 HTTP 请求转发\n- NO_PROXY: 排除不走代理的地址\n- 示例: set HTTPS_PROXY=http://127.0.0.1:7890\n- 建议同时设置 NO_PROXY=localhost,127.0.0.1',
      risk: '需手动配置',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('proxy-config'); },
  async execute(): Promise<FixResult> { return { success: false, message: '需手动操作，请参考指引' }; },
});

// ==================== 黑色档（5个，只告知）====================

registerFixerLocal({
  scannerId: 'vram-usage',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'info-vram-usage',
      scannerId: 'vram-usage',
      tier: 'black',
      description: '显存占用较高。查看占用进程：nvidia-smi\n如需释放，关闭占用 GPU 的程序即可',
      risk: '仅告知',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('vram-usage'); },
  async execute(): Promise<FixResult> { return { success: true, message: '仅供参考' }; },
});

registerFixerLocal({
  scannerId: 'cuda-version',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'info-cuda-version',
      scannerId: 'cuda-version',
      tier: 'black',
      description: 'CUDA 版本兼容参考：\n- PyTorch 2.x → CUDA 11.8 / 12.1+\n- TensorFlow 2.x → CUDA 11.8 / 12.x\n- 确保 CUDA Toolkit 版本与驱动版本匹配',
      risk: '仅告知',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('cuda-version'); },
  async execute(): Promise<FixResult> { return { success: true, message: '仅供参考' }; },
});

registerFixerLocal({
  scannerId: 'ssl-certs',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'info-ssl-certs',
      scannerId: 'ssl-certs',
      tier: 'black',
      description: 'SSL 证书问题通常由以下原因导致：\n1. 公司网络代理劫持证书\n2. 系统时间不正确\n3. 根证书缺失\n解决方法：检查系统时间、联系网络管理员、或临时设置 pip 的 --trusted-host',
      risk: '仅告知',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('ssl-certs'); },
  async execute(): Promise<FixResult> { return { success: true, message: '仅供参考' }; },
});

registerFixerLocal({
  scannerId: 'dns-resolution',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'info-dns-resolution',
      scannerId: 'dns-resolution',
      tier: 'black',
      description: 'DNS 解析异常。建议：\n1. 尝试更换 DNS 为 8.8.8.8 或 114.114.114.114\n2. 刷新 DNS 缓存: ipconfig /flushdns\n3. 检查 hosts 文件是否有异常条目',
      risk: '仅告知',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('dns-resolution'); },
  async execute(): Promise<FixResult> { return { success: true, message: '仅供参考' }; },
});

registerFixerLocal({
  scannerId: 'site-reachability',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'info-site-reachability',
      scannerId: 'site-reachability',
      tier: 'black',
      description: '部分 AI 站点不可达。可能原因：\n1. 网络限制/防火墙\n2. 需要代理或 VPN\n3. 站点临时故障\n建议配置镜像源作为替代',
      risk: '仅告知',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('site-reachability'); },
  async execute(): Promise<FixResult> { return { success: true, message: '仅供参考' }; },
});

// ==================== 补充 fixer（原 5 个未覆盖的 scanner）====================

// admin-perms → 管理员权限提示
registerFixerLocal({
  scannerId: 'admin-perms',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-admin-perms',
      scannerId: 'admin-perms',
      tier: 'red',
      description: '当前非管理员权限。部分修复操作（注册表、防火墙、时间同步）需要管理员权限。\n请以管理员身份重新运行本工具：\n右键 → 以管理员身份运行',
      risk: '需手动操作：重新以管理员身份运行',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('admin-perms'); },
  async execute(): Promise<FixResult> { return { success: false, message: '请以管理员身份重新运行本工具' }; },
});

// package-managers → 安装缺失的包管理器
registerFixerLocal({
  scannerId: 'package-managers',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-package-managers',
      scannerId: 'package-managers',
      tier: 'yellow',
      description: '安装缺失的核心包管理器（pip / npm / bun）',
      risk: '中风险：将安装缺失的包管理器',
    };
  },
  async backup(): Promise<BackupData> {
    const data: Record<string, string> = {};
    for (const cmd of ['pip', 'npm', 'bun']) {
      const r = runCommand(`where.exe ${cmd}`, 3000);
      data[cmd] = r.exitCode === 0 ? 'installed' : 'missing';
    }
    return { scannerId: 'package-managers', timestamp: Date.now(), data };
  },
  async execute(_fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const installPlans = [
      {
        name: 'Python',
        cmd: 'where.exe pip',
        install: 'winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements',
      },
      {
        name: 'Node.js',
        cmd: 'where.exe npm',
        install: 'winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
      },
      {
        name: 'Bun',
        cmd: 'where.exe bun',
        install: 'winget install Bun.HBun --accept-package-agreements --accept-source-agreements',
      },
    ];

    const installedNow: string[] = [];
    const alreadyPresent: string[] = [];
    const failures: string[] = [];

    for (const plan of installPlans) {
      if (runCommand(plan.cmd, 3000).exitCode === 0) {
        alreadyPresent.push(plan.name);
        continue;
      }
      const result = runCommand(plan.install, 120000);
      if (result.exitCode === 0) {
        installedNow.push(plan.name);
      } else {
        failures.push(`${plan.name}: ${commandFailedMessage(result, '安装')}`);
      }
    }

    if (failures.length > 0) {
      const prefix = installedNow.length > 0
        ? `已安装: ${installedNow.join('、')}\n`
        : '';
      return {
        success: false,
        message: `${prefix}${failures.join('\n')}`,
      };
    }

    if (installedNow.length === 0) {
      return {
        success: true,
        message: `核心包管理器已存在，无需修复${alreadyPresent.length > 0 ? `: ${alreadyPresent.join('、')}` : ''}`,
      };
    }

    return {
      success: true,
      message: `已安装缺失的包管理器: ${installedNow.join('、')}`,
    };
  },
  async rollback(backup: BackupData): Promise<void> {
    // 只卸载本次新安装的（原来就有的不动）
    if (backup.data['pip'] === 'missing') {
      runCommand('winget uninstall Python.Python.3.12', 30000);
    }
    if (backup.data['npm'] === 'missing') {
      runCommand('winget uninstall OpenJS.NodeJS.LTS', 30000);
    }
    if (backup.data['bun'] === 'missing') {
      runCommand('winget uninstall Bun.HBun', 30000);
    }
  },
});

// unix-commands → 安装 Unix 命令（通过 Git Bash 或 WSL）
registerFixerLocal({
  scannerId: 'unix-commands',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-unix-commands',
      scannerId: 'unix-commands',
      tier: 'yellow',
      description: '安装 Git for Windows 可获得 ls, grep, curl, ssh, tar 等常用 Unix 命令',
      commands: ['winget install Git.Git --accept-package-agreements'],
      risk: '中风险：将安装 Git for Windows（包含 Unix 命令）',
    };
  },
  async backup(): Promise<BackupData> {
    const data: Record<string, string> = {};
    for (const cmd of ['ls', 'grep', 'curl', 'ssh', 'tar']) {
      const r = runCommand(`where.exe ${cmd}`, 3000);
      data[cmd] = r.exitCode === 0 ? 'available' : 'missing';
    }
    return { scannerId: 'unix-commands', timestamp: Date.now(), data };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    return simpleExecute(fix, _backup);
  },
});

// wsl-version → 安装/升级 WSL
registerFixerLocal({
  scannerId: 'wsl-version',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-wsl-version',
      scannerId: 'wsl-version',
      tier: 'yellow',
      description: '安装或升级 WSL2',
      commands: ['wsl --install --no-distribution'],
      risk: '中风险：将安装 WSL2 组件',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('wsl --status', 8000);
    return { scannerId: 'wsl-version', timestamp: Date.now(), data: { status: r.exitCode === 0 ? r.stdout : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 60000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'WSL2 安装成功，可能需要重启' : commandFailedMessage(r, 'WSL2 安装') };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.status === 'not-installed') {
      runCommand('wsl --uninstall', 15000);
    }
  },
});

// ==================== Git PATH 完整性修复 ====================

registerFixerLocal({
  scannerId: 'git-path',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-git-path',
      scannerId: 'git-path',
      tier: 'green',
      description: '将 Git\\bin、Git\\usr\\bin 添加到用户 PATH 环境变量',
      commands: [
        `powershell -Command "${buildGitPathFixCommand()}"`,
      ],
      risk: '低风险：仅添加 Git 子目录到用户 PATH',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', 5000);
    return { scannerId: 'git-path', timestamp: Date.now(), data: { oldPath: r.exitCode === 0 ? r.stdout : '' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 15000);
    if (r.exitCode !== 0) {
      return { success: false, message: commandFailedMessage(r, '添加 Git PATH') };
    }
    // 同时更新当前进程的 PATH，让后续检测立即生效
    const newPath = r.stdout.trim();
    if (newPath) {
      process.env.PATH = newPath + ';' + process.env.PATH;
    }
    return { success: true, message: 'Git PATH 已补全，新终端窗口生效。请重启终端使 PATH 生效。' };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.oldPath) {
      const escapedPath = escapePowerShellSingleQuotedString(backup.data.oldPath);
      runCommand(`powershell -Command "[Environment]::SetEnvironmentVariable('Path','${escapedPath}','User')"`, 10000);
    }
  },
});

// ==================== AI 开发工具一键安装 ====================

// uv 包管理器 → pip 国内镜像安装
registerFixerLocal({
  scannerId: 'uv-package-manager',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-uv-package-manager',
      scannerId: 'uv-package-manager',
      tier: 'green',
      description: '使用 pip 国内镜像安装 uv（Python MCP 服务器必需）\n\n将执行: pip install uv -i https://pypi.tuna.tsinghua.edu.cn/simple',
      commands: ['pip install uv -i https://pypi.tuna.tsinghua.edu.cn/simple'],
      risk: '低风险：仅安装 Python 包管理工具',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('uv --version', 5000);
    return { scannerId: 'uv-package-manager', timestamp: Date.now(), data: { uvVersion: r.exitCode === 0 ? r.stdout.trim() : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 60000);
    if (r.exitCode !== 0) {
      // pip 失败时尝试 PowerShell 安装
      const r2 = runCommand('powershell -Command "irm https://astral.sh/uv/install.ps1 | iex"', 60000);
      if (r2.exitCode !== 0) {
        return { success: false, message: `pip 安装失败: ${commandFailedMessage(r, '')}\nPowerShell 安装也失败: ${commandFailedMessage(r2, '')}` };
      }
      return { success: true, message: 'uv 安装成功（via PowerShell）' };
    }
    return { success: true, message: 'uv 安装成功（via pip 清华镜像）' };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.uvVersion === 'not-installed') {
      runCommand('pip uninstall uv -y', 15000);
    }
  },
});

// Claude Code CLI → npm 国内镜像安装
registerFixerLocal({
  scannerId: 'claude-cli',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-claude-cli',
      scannerId: 'claude-cli',
      tier: 'green',
      description: '使用 npmmirror 国内镜像安装 Claude Code CLI\n\n将执行: npm install -g @anthropic-ai/claude-code --registry https://registry.npmmirror.com\n\n安装后运行 claude 命令启动，首次需登录 Anthropic 账号',
      commands: ['npm install -g @anthropic-ai/claude-code --registry https://registry.npmmirror.com'],
      risk: '低风险：仅安装 npm 全局包',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('claude --version', 8000);
    return { scannerId: 'claude-cli', timestamp: Date.now(), data: { claudeVersion: r.exitCode === 0 ? r.stdout.trim() : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 120000);
    if (r.exitCode !== 0) {
      return { success: false, message: commandFailedMessage(r, 'Claude Code 安装') };
    }
    return { success: true, message: 'Claude Code 安装成功。运行 claude 命令启动。' };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.claudeVersion === 'not-installed') {
      runCommand('npm uninstall -g @anthropic-ai/claude-code', 30000);
    }
  },
});

// OpenClaw → npm 国内镜像安装
registerFixerLocal({
  scannerId: 'openclaw',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-openclaw',
      scannerId: 'openclaw',
      tier: 'green',
      description: '使用 npmmirror 国内镜像安装 OpenClaw（开源 Claude Code 替代品）\n\n将执行: npm install -g openclaw --registry https://registry.npmmirror.com\n\n支持 OpenRouter/兼容 API，无需 Anthropic 账号',
      commands: ['npm install -g openclaw --registry https://registry.npmmirror.com'],
      risk: '低风险：仅安装 npm 全局包',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('openclaw --version', 8000);
    return { scannerId: 'openclaw', timestamp: Date.now(), data: { version: r.exitCode === 0 ? r.stdout.trim() : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 120000);
    if (r.exitCode !== 0) {
      return { success: false, message: commandFailedMessage(r, 'OpenClaw 安装') };
    }
    return { success: true, message: 'OpenClaw 安装成功。运行 openclaw 命令启动。' };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.version === 'not-installed') {
      runCommand('npm uninstall -g openclaw', 30000);
    }
  },
});

// CCSwitch → npm 国内镜像安装
registerFixerLocal({
  scannerId: 'ccswitch',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-ccswitch',
      scannerId: 'ccswitch',
      tier: 'green',
      description: '使用 npmmirror 国内镜像安装 CCSwitch（Claude Code 多账号切换工具）\n\n将执行: npm install -g ccswitch --registry https://registry.npmmirror.com\n\n可在多个 Anthropic 账号/API Key 之间快速切换',
      commands: ['npm install -g ccswitch --registry https://registry.npmmirror.com'],
      risk: '低风险：仅安装 npm 全局包',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('ccswitch --version', 8000);
    return { scannerId: 'ccswitch', timestamp: Date.now(), data: { version: r.exitCode === 0 ? r.stdout.trim() : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 120000);
    if (r.exitCode !== 0) {
      return { success: false, message: commandFailedMessage(r, 'CCSwitch 安装') };
    }
    return { success: true, message: 'CCSwitch 安装成功。运行 ccswitch 命令管理账号。' };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.version === 'not-installed') {
      runCommand('npm uninstall -g ccswitch', 30000);
    }
  },
});

// ==================== PowerShell 7 升级 ====================

registerFixerLocal({
  scannerId: 'powershell-version',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-powershell-version',
      scannerId: 'powershell-version',
      tier: 'green',
      description: '使用 winget 安装 PowerShell 7（最新稳定版）\n\nPowerShell 7 相比 5.x 的优势:\n- 并行执行 (ForEach-Object -Parallel)\n- 管道链操作符 (&& 和 ||)\n- 三元运算符 ($a ? $b : $c)\n- null 合并操作符 (??)\n- 更快速度、跨平台兼容\n- 更好的错误提示和补全',
      commands: ['winget install Microsoft.PowerShell --accept-package-agreements --accept-source-agreements'],
      risk: '低风险：安装 PowerShell 7 不影响现有的 Windows PowerShell 5',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('pwsh --version', 3000);
    return { scannerId: 'powershell-version', timestamp: Date.now(), data: { pwshVersion: r.exitCode === 0 ? r.stdout.trim() : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 120000);
    if (r.exitCode !== 0) {
      return { success: false, message: commandFailedMessage(r, 'PowerShell 7 安装') };
    }

    // 安装完成后，把 pwsh 设为 Windows Terminal 默认 profile（如果 Windows Terminal 存在）
    const wtExists = runCommand('where.exe wt', 3000).exitCode === 0;
    let extra = '';
    if (wtExists) {
      try {
        // 设置 Windows Terminal 默认 profile 为 PowerShell 7
        runCommand(
          `powershell -Command "$settings = Get-Content '$env:LOCALAPPDATA\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json' | ConvertFrom-Json; $settings.defaultProfile = '{574e775e-4f2a-5b96-ac1e-a2962a402336}'; $settings | ConvertTo-Json -Depth 10 | Set-Content '$env:LOCALAPPDATA\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json'"`,
          10000,
        );
        extra = '，已设为 Windows Terminal 默认';
      } catch {
        // 不影响主流程
      }
    }

    return { success: true, message: `PowerShell 7 安装成功${extra}。请重新打开终端使用 pwsh 命令。` };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.pwshVersion === 'not-installed') {
      runCommand('winget uninstall Microsoft.PowerShell', 30000);
    }
  },
});
