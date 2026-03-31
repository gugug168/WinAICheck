import type { Fixer, FixSuggestion, FixResult, ScanResult } from '../scanners/types';
import { runCommand } from '../executor/index';

/**
 * 修复系统：4 档分类
 * - green: 一键自动修复（需确认）
 * - yellow: 审查确认执行
 * - red: 只给指引
 * - black: 只告知
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

/** 执行修复 */
export async function executeFix(fix: FixSuggestion): Promise<FixResult> {
  const fixer = getFixerByScannerId(fix.scannerId);
  if (!fixer?.execute) {
    return { success: false, message: '此修复项不支持自动执行' };
  }
  return fixer.execute(fix);
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
  async execute(fix): Promise<FixResult> {
    const results: string[] = [];
    for (const cmd of fix.commands || []) {
      const r = runCommand(cmd, 15000);
      results.push(`${cmd}: ${r.exitCode === 0 ? '成功' : '失败'}`);
    }
    return { success: true, message: results.join('\n') };
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
  async execute(fix): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 10000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '执行策略已更新' : r.stderr };
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
  async execute(fix): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 10000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '长路径支持已启用' : r.stderr };
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
  async execute(fix): Promise<FixResult> {
    const r = runCommand(fix.commands![0], 15000);
    return { success: r.exitCode === 0, message: r.exitCode === 0 ? '时间同步成功' : r.stderr };
  },
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
});
