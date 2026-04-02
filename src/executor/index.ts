import { execSync } from 'child_process';
import { Buffer } from 'buffer';

const DEFAULT_TIMEOUT = 15_000;

/** 测试钩子：注入 mock 函数，避免 mock.module 的跨文件冲突 */
export const _test = {
  mockExecSync: null as ((cmd: string, opts: any) => Buffer) | null,
  mockExistsSync: null as ((path: string) => boolean) | null,
};

/**
 * 尝试将 Buffer 解码为 UTF-8 文本
 * 某些 Windows 命令（如 wsl）输出 UTF-16LE
 */
function decodeOutput(buf: Buffer | string): string {
  if (typeof buf === 'string') return buf;
  // 如果前几个字节含 UTF-16LE BOM 或看起来像 UTF-16（大量 0x00）
  if (buf.length >= 2) {
    const hasBom = buf[0] === 0xff && buf[1] === 0xfe;
    const looksLikeUtf16 = buf.length > 10 && buf.reduce((acc, b, i) => acc + (i % 2 === 1 && b === 0 ? 1 : 0), 0) > buf.length * 0.3;
    if (hasBom || looksLikeUtf16) {
      return buf.toString('utf16le');
    }
  }
  return buf.toString('utf-8');
}

/**
 * 执行系统命令，带超时保护
 */
export function runCommand(
  cmd: string,
  timeout = DEFAULT_TIMEOUT,
): { stdout: string; stderr: string; exitCode: number } {
  // 测试钩子：mock 注入优先
  if (_test.mockExecSync) {
    try {
      const buf = _test.mockExecSync(cmd, { timeout });
      return { stdout: decodeOutput(buf).trim(), stderr: '', exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ? decodeOutput(err.stdout).trim() : '',
        stderr: err.stderr ? String(err.stderr).trim() : '',
        exitCode: err.status ?? 1,
      };
    }
  }
  try {
    const buf = execSync(cmd, {
      timeout,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'buffer',
    }) as Buffer;
    const stdout = decodeOutput(buf).trim();
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ? decodeOutput(err.stdout as Buffer).trim() : '',
      stderr: err.stderr ? (err.stderr as Buffer).toString('utf-8').trim() : '',
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * 执行注册表查询
 */
export function runReg(queryPath: string, valueName?: string): string {
  let cmd = `reg query "${queryPath}"`;
  if (valueName) cmd += ` /v "${valueName}"`;
  return runCommand(cmd, 10_000).stdout;
}

/**
 * 执行 PowerShell 命令
 */
export function runPS(script: string, timeout = DEFAULT_TIMEOUT): string {
  const cmd = `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`;
  return runCommand(cmd, timeout).stdout;
}

/**
 * 检查命令是否可用
 */
export function commandExists(cmd: string): boolean {
  return runCommand(`where.exe ${cmd}`, 5_000).exitCode === 0;
}

/**
 * 检查当前是否以管理员权限运行
 */
export function isAdmin(): boolean {
  return runCommand('net session', 5_000).exitCode === 0;
}
