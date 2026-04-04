import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists, runReg, _test } from '../executor/index';
import { registerScanner } from './registry';
import { existsSync } from 'fs';
import path from 'path';

/** 测试可注入的 existsSync 替代 */
function checkExists(p: string): boolean {
  if (_test.mockExistsSync) return _test.mockExistsSync(p);
  return existsSync(p);
}

/**
 * 检测 CCSwitch（Claude Code 多账号切换工具）
 * 支持 CLI 版（npm 全局安装）和 GUI 版（桌面安装器）
 */
const scanner: Scanner = {
  id: 'ccswitch',
  name: 'CCSwitch 检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    // 1. 先检查 CLI 版本（ccswitch 命令在 PATH 中）
    if (commandExists('ccswitch')) {
      try {
        const { stdout } = runCommand('ccswitch --version', 8000);
        if (stdout.trim()) {
          return {
            id: this.id,
            name: this.name,
            category: this.category,
            status: 'pass',
            message: `CCSwitch 已安装 (${stdout.trim()}, CLI 版)`,
          };
        }
      } catch {
        // 版本获取失败，仍然标记为已安装
      }
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: 'CCSwitch 已安装 (CLI 版)',
      };
    }

    // 2. 检查 GUI 版本（文件路径检测）
    const guiPaths = [
      // GUI 桌面版（实际安装路径：CC Switch，带空格）
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'CC Switch', 'cc-switch.exe'),
      // CLI 安装器版本
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'CC-Switch-CLI', 'ccswitch.exe'),
      path.join(process.env['ProgramFiles'] || '', 'CC-Switch-CLI', 'ccswitch.exe'),
    ];

    for (const p of guiPaths) {
      if (checkExists(p)) {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          status: 'pass',
          message: 'CCSwitch 已安装 (图形版)',
        };
      }
    }

    // 3. 检查注册表（Uninstall 和 Run 键）
    try {
      const regPaths = [
        // 卸载信息（安装器可能写入）
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        // 自启动项（CC Switch GUI 实际写入位置）
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
      ];
      const keywords = ['CC Switch', 'ccswitch', 'CC-Switch', 'cc-switch'];
      for (const regPath of regPaths) {
        try {
          const output = runReg(regPath);
          for (const kw of keywords) {
            if (output.toLowerCase().includes(kw.toLowerCase())) {
              return {
                id: this.id,
                name: this.name,
                category: this.category,
                status: 'pass',
                message: 'CCSwitch 已安装 (图形版)',
              };
            }
          }
        } catch {
          // 该注册表路径不存在，跳过
        }
      }
    } catch {
      // 注册表查询全部失败，忽略
    }

    // 4. 未找到任何安装
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'warn',
      message: 'CCSwitch 未安装（可选，多账号管理工具）',
      detail:
        'CCSwitch 是 Claude Code 多账号/API Key 切换工具。分为 CLI 版和 GUI 版。\n\n' +
        '安装方法:\n' +
        '  CLI 版: npm install -g ccswitch\n' +
        '  国内镜像: npm install -g ccswitch --registry https://registry.npmmirror.com\n' +
        '  GUI 版: 从 CC-Switch-CLI 官方下载安装器\n\n' +
        '使用: ccswitch\n支持在多个 Anthropic 账号之间快速切换',
    };
  },
};

registerScanner(scanner);
