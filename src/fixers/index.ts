import type { Fixer, FixSuggestion, FixResult, ScanResult, BackupData } from '../scanners/types';
import { runCommand, isAdmin } from '../executor/index';
import { getScannerById } from '../scanners/registry';

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

const fixers: Fixer[] = [];

export function registerFixer(fixer: Fixer): void {
  fixers.push(fixer);
}

export function getFixers(): Fixer[] {
  return [...fixers];
}

export function getFixerByScannerId(scannerId: string): Fixer | undefined {
  return fixers.find(f => f.scannerId === scannerId);
}

/** 获取所有需要修复的结果的建议 */
export function getFixSuggestions(results: ScanResult[]): FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];
  for (const result of results) {
    if (result.status === 'pass') continue;
    const fixer = getFixerByScannerId(result.id);
    if (fixer) {
      suggestions.push(fixer.getFix(result));
    }
  }
  return suggestions;
}

/** 三阶段执行修复：backup → execute → verify，失败时 rollback */
export async function executeFix(fix: FixSuggestion): Promise<FixResult> {
  const fixer = getFixerByScannerId(fix.scannerId);
  if (!fixer) {
    return { success: false, message: `未找到 scanner ${fix.scannerId} 对应的 fixer` };
  }

  // Phase 1: Backup
  let backup: BackupData;
  try {
    backup = fixer.backup ? await fixer.backup({} as ScanResult) : emptyBackup(fix.scannerId);
  } catch (err) {
    return { success: false, message: `备份失败: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Phase 2: Execute
  try {
    const result = await fixer.execute(fix, backup);

    // Phase 3: Verify（重扫对应 scanner）
    const scanner = getScannerById(fix.scannerId);
    if (scanner) {
      try {
        const newScan = await scanner.scan();
        result.newScanResult = newScan;
      } catch {
        // 重扫失败不影响修复结果
      }
    }

    return result;
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
}

/** 空 backup（无需备份的 fixer 使用） */
function emptyBackup(scannerId: string): BackupData {
  return { scannerId, timestamp: Date.now(), data: {} };
}

/** 通用执行器：只执行命令，不备份 */
function simpleExecute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
  const results: string[] = [];
  for (const cmd of fix.commands || []) {
    const r = runCommand(cmd, 15000);
    results.push(`${cmd}: ${r.exitCode === 0 ? '成功' : '失败'}`);
    if (r.exitCode !== 0) {
      return Promise.resolve({ success: false, message: results.join('\n') });
    }
  }
  return Promise.resolve({ success: true, message: results.join('\n') || '执行完成' });
}

/** 创建恢复点（简单版：导出当前注册表/配置状态） */
export function createRestorePoint(tag: string): void {
  // 预留：Phase 2 可实现完整恢复点
}

// ==================== 绿色档（5个，一键修复）====================

// 1. mirror-sources → 写 pip.ini/.npmrc
registerFixer({
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
registerFixer({
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
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '执行策略已更新' : r.stderr };
  },
  async rollback(backup: BackupData): Promise<void> {
    runCommand(`powershell -Command "Set-ExecutionPolicy ${backup.data.oldPolicy} -Scope CurrentUser -Force"`, 10000);
  },
});

// 3. long-paths → 注册表修改
registerFixer({
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
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '长路径支持已启用' : r.stderr };
  },
  async rollback(backup: BackupData): Promise<void> {
    const oldVal = backup.data.LongPathsEnabled?.includes('0x1') ? '1' : '0';
    runCommand(`reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d ${oldVal} /f`, 10000);
  },
});

// 4. time-sync → 强制时间同步
registerFixer({
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
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '时间同步成功' : `同步失败: ${r.stderr || r.stdout}` };
  },
  // 幂等操作，无需 rollback
});

// 5. env-path-length → 分析重复项
registerFixer({
  scannerId: 'env-path-length',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-env-path-length',
      scannerId: 'env-path-length',
      tier: 'green',
      description: '分析 PATH 中的重复和失效条目',
      risk: '低风险：仅分析不修改',
    };
  },
  async backup(): Promise<BackupData> {
    return emptyBackup('env-path-length');
  },
  async execute(): Promise<FixResult> {
    return { success: true, message: '仅分析，无需修改' };
  },
});

// ==================== 黄色档（5个，审查确认）====================

registerFixer({
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
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'Git 安装/升级成功' : r.stderr };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.gitVersion === 'not-installed') {
      runCommand('winget uninstall Git.Git', 30000);
    }
  },
});

registerFixer({
  scannerId: 'node-version',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-node-version',
      scannerId: 'node-version',
      tier: 'yellow',
      description: '推荐使用 nvm-windows 管理 Node.js 版本',
      commands: ['winget install CoreyButler.NVMforWindows'],
      risk: '中风险：将安装 nvm-windows',
    };
  },
  async backup(): Promise<BackupData> {
    const r = runCommand('node --version', 5000);
    return { scannerId: 'node-version', timestamp: Date.now(), data: { nodeVersion: r.exitCode === 0 ? r.stdout : 'not-installed' } };
  },
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 60000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'nvm-windows 安装成功' : r.stderr };
  },
});

registerFixer({
  scannerId: 'python-versions',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-python-versions',
      scannerId: 'python-versions',
      tier: 'yellow',
      description: '列出所有 Python 版本及路径，建议清理冲突版本',
      risk: '中风险：需手动选择保留/卸载的版本',
    };
  },
  async backup(): Promise<BackupData> {
    return emptyBackup('python-versions');
  },
  async execute(): Promise<FixResult> {
    const r = runCommand('where.exe python', 5000);
    return { success: true, message: r.exitCode === 0 ? r.stdout : '未找到 Python' };
  },
});

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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

registerFixer({
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
registerFixer({
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
registerFixer({
  scannerId: 'package-managers',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-package-managers',
      scannerId: 'package-managers',
      tier: 'yellow',
      description: '安装缺失的包管理器',
      commands: ['winget install Bun.HBun --accept-package-agreements'],
      risk: '中风险：将安装 Bun 包管理器',
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
  async execute(fix: FixSuggestion, _backup: BackupData): Promise<FixResult> {
    return simpleExecute(fix, _backup);
  },
  async rollback(backup: BackupData): Promise<void> {
    // 只卸载本次新安装的（原来就有的不动）
    if (backup.data['bun'] === 'missing') {
      runCommand('winget uninstall Bun.HBun', 30000);
    }
  },
});

// path-spaces → 路径空格指引
registerFixer({
  scannerId: 'path-spaces',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-path-spaces',
      scannerId: 'path-spaces',
      tier: 'red',
      description: '部分工具安装在含空格的路径下，可能导致兼容性问题。\n建议：\n1. 将工具重新安装到无空格路径（如 C:\\Tools\\）\n2. 或创建符号链接: mklink /D C:\\Tools\\Git "C:\\Program Files\\Git"\n3. 部分工具可通过配置独立路径绕过',
      risk: '需手动操作',
    };
  },
  async backup(): Promise<BackupData> { return emptyBackup('path-spaces'); },
  async execute(): Promise<FixResult> { return { success: false, message: '需手动操作，请参考指引' }; },
});

// unix-commands → 安装 Unix 命令（通过 Git Bash 或 WSL）
registerFixer({
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
registerFixer({
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
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'WSL2 安装成功，可能需要重启' : r.stderr };
  },
  async rollback(backup: BackupData): Promise<void> {
    if (backup.data.status === 'not-installed') {
      runCommand('wsl --uninstall', 15000);
    }
  },
});

// ==================== Git PATH 完整性修复 ====================

registerFixer({
  scannerId: 'git-path',
  getFix(result: ScanResult): FixSuggestion {
    return {
      id: 'fix-git-path',
      scannerId: 'git-path',
      tier: 'green',
      description: '将 Git\\bin、Git\\usr\\bin 添加到用户 PATH 环境变量',
      commands: [
        'powershell -Command "$gitDir=(Get-Command git).Source | Split-Path | Split-Parent; $dirs=@(\"$gitDir\\bin\",\"$gitDir\\usr\\bin\"); $path=[Environment]::GetEnvironmentVariable(\'Path\',\'User\'); foreach($d in $dirs){ if($path -notlike \"*$d*\"){ $path+=\";$d\" } }; [Environment]::SetEnvironmentVariable(\'Path\',$path,\'User\'); echo $path"',
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
      return { success: false, message: `添加 PATH 失败: ${r.stderr}` };
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
      runCommand(`powershell -Command "[Environment]::SetEnvironmentVariable('Path','${backup.data.oldPath}','User')"`, 10000);
    }
  },
});

// ==================== AI 开发工具一键安装 ====================

// uv 包管理器 → pip 国内镜像安装
registerFixer({
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
        return { success: false, message: `pip 安装失败: ${r.stderr}\nPowerShell 安装也失败: ${r2.stderr}` };
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
registerFixer({
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
      return { success: false, message: `安装失败: ${r.stderr || r.stdout}` };
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
registerFixer({
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
      return { success: false, message: `安装失败: ${r.stderr || r.stdout}` };
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
registerFixer({
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
      return { success: false, message: `安装失败: ${r.stderr || r.stdout}` };
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

registerFixer({
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
      return { success: false, message: `安装失败: ${r.stderr || r.stdout}` };
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
