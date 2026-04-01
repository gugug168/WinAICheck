import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/**
 * 检测 PowerShell 版本
 * Windows 自带 PowerShell 5.1，但 PowerShell 7+ 功能更强大、性能更好
 * AI 开发中很多脚本依赖 pwsh 7 的特性（如并行执行、null 合并操作符等）
 */
const scanner: Scanner = {
  id: 'powershell-version',
  name: 'PowerShell 版本检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    // 检测 Windows PowerShell 5.x
    const ps5 = runCommand('powershell -Command "$PSVersionTable.PSVersion.ToString()"', 5000);

    // 检测 PowerShell 7 (pwsh)
    const ps7 = runCommand('pwsh -Command "$PSVersionTable.PSVersion.ToString()"', 5000);

    const hasPs5 = ps5.exitCode === 0;
    const hasPs7 = ps7.exitCode === 0;
    const ps5Ver = hasPs5 ? ps5.stdout.trim() : '';
    const ps7Ver = hasPs7 ? ps7.stdout.trim() : '';

    if (hasPs7) {
      // 已安装 PowerShell 7
      const major = parseInt(ps7Ver.split('.')[0], 10);
      if (major >= 7) {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          status: 'pass',
          message: `PowerShell 7 已安装 (${ps7Ver})`,
          detail: `Windows PowerShell: ${ps5Ver}\nPowerShell 7 (pwsh): ${ps7Ver}\n路径: ${runCommand('where.exe pwsh', 3000).stdout.trim()}`,
        };
      }
    }

    // 没有 PowerShell 7，只有 5.x
    if (hasPs5) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `仅安装了 Windows PowerShell ${ps5Ver}，建议升级到 PowerShell 7`,
        detail: `Windows PowerShell 5.x 是旧版本，缺少以下特性:\n- 并行执行 (ForEach-Object -Parallel)\n- 三元运算符 ($a ? $b : $c)\n- 管道链操作符 (&& 和 ||)\n- null 合并操作符 (??)\n- 更好的性能和跨平台兼容性\n\n安装命令: winget install Microsoft.PowerShell`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'fail',
      message: '未检测到 PowerShell',
    };
  },
};

registerScanner(scanner);
