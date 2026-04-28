import { execSync } from 'child_process';
import { Buffer } from 'buffer';

const DEFAULT_TIMEOUT = 15_000;

/** 测试钩子：注入 mock 函数，避免 mock.module 的跨文件冲突 */
export const _test = {
  mockExecSync: null as ((cmd: string, opts: any) => Buffer) | null,
  mockExistsSync: null as ((path: string) => boolean) | null,
  mockReadFileSync: null as ((path: string) => string | null) | null,
};

/** 诊断钩子：观察命令执行过程（不干扰执行，与 _test 共存） */
export const _diag: {
  onCommand?: (cmd: string, result: CommandResult) => void;
  onReg?: (queryPath: string, output: string) => void;
  onPS?: (script: string, output: string) => void;
} = {};

/** 命令执行错误分类 */
export type ErrorCategory =
  | 'timeout'
  | 'command-not-found'
  | 'permission-denied'
  | 'network-error'
  | 'disk-full'
  | 'generic';

/** 分类后的命令结果 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** 失败时的错误分类 */
  errorCategory?: ErrorCategory;
  /** 中文错误提示和解决建议 */
  errorHint?: string;
}

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
 * 对命令执行失败进行精准分类
 */
export function classifyCommandError(
  result: { exitCode: number; stderr: string; stdout: string },
  _timeout?: number,
): { category: ErrorCategory; hint: string } {
  const { exitCode, stderr, stdout } = result;
  const combined = `${stderr} ${stdout}`.toLowerCase();

  // 1. 超时
  if (combined.includes('timeout') || combined.includes('timed out') || combined.includes('超时')) {
    return {
      category: 'timeout',
      hint: `操作超时。可能原因：网络慢或服务器响应慢。\n建议：检查网络连接，或稍后重试。`,
    };
  }

  // 2. 命令不存在：Windows cmd.exe 返回 9009
  if (exitCode === 9009 || combined.includes('not recognized') || combined.includes('找不到') || combined.includes('not found')) {
    return {
      category: 'command-not-found',
      hint: `命令不存在。可能该工具未安装或未加入 PATH。\n建议：先安装对应工具，或确认 PATH 环境变量配置正确。`,
    };
  }

  // 3. 权限不足
  if (
    combined.includes('access is denied') ||
    combined.includes('拒绝访问') ||
    combined.includes('permission denied') ||
    combined.includes('需要管理员') ||
    combined.includes('elevation') ||
    exitCode === 5
  ) {
    return {
      category: 'permission-denied',
      hint: `权限不足。此操作需要管理员权限。\n建议：右键本工具，选择"以管理员身份运行"。`,
    };
  }

  // 4. 网络错误
  if (
    combined.includes('etimedout') ||
    combined.includes('enotfound') ||
    combined.includes('econnrefused') ||
    combined.includes('econnreset') ||
    combined.includes('network') ||
    combined.includes('无法连接') ||
    combined.includes('连接被') ||
    combined.includes('ssl') ||
    combined.includes('certificate')
  ) {
    return {
      category: 'network-error',
      hint: `网络连接失败。可能原因：网络不通、DNS 解析失败、需要代理。\n建议：检查网络连接，或配置镜像源。`,
    };
  }

  // 5. 磁盘空间不足
  if (combined.includes('enospc') || combined.includes('磁盘空间不足') || combined.includes('no space left')) {
    return {
      category: 'disk-full',
      hint: `磁盘空间不足。\n建议：清理 TEMP 目录或卸载不需要的程序释放空间。`,
    };
  }

  // 6. 通用失败
  return {
    category: 'generic',
    hint: stderr || stdout || `命令执行失败 (exitCode: ${exitCode})`,
  };
}

/**
 * 为失败结果附加错误分类
 */
function attachErrorClassification(
  result: { stdout: string; stderr: string; exitCode: number },
  timeout?: number,
): CommandResult {
  if (result.exitCode === 0) return result;
  const classified = classifyCommandError(result, timeout);
  return {
    ...result,
    errorCategory: classified.category,
    errorHint: classified.hint,
  };
}

/**
 * 执行系统命令，带超时保护和错误分类
 */
export function runCommand(
  cmd: string,
  timeout = DEFAULT_TIMEOUT,
): CommandResult {
  // 测试钩子：mock 注入优先
  if (_test.mockExecSync) {
    try {
      const buf = _test.mockExecSync(cmd, { timeout });
      const theResult: CommandResult = { stdout: decodeOutput(buf).trim(), stderr: '', exitCode: 0 };
      if (_diag.onCommand) _diag.onCommand(cmd, theResult);
      return theResult;
    } catch (err: any) {
      const rawResult = {
        stdout: err.stdout ? decodeOutput(err.stdout).trim() : '',
        stderr: err.stderr ? String(err.stderr).trim() : '',
        exitCode: err.status ?? 1,
      };
      const theResult = attachErrorClassification(rawResult, timeout);
      if (_diag.onCommand) _diag.onCommand(cmd, theResult);
      return theResult;
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
    const theResult: CommandResult = { stdout, stderr: '', exitCode: 0 };
    if (_diag.onCommand) _diag.onCommand(cmd, theResult);
    return theResult;
  } catch (err: any) {
    const rawResult = {
      stdout: err.stdout ? decodeOutput(err.stdout as Buffer).trim() : '',
      stderr: err.stderr ? (err.stderr as Buffer).toString('utf-8').trim() : '',
      exitCode: err.status ?? 1,
    };
    const theResult = attachErrorClassification(rawResult, timeout);
    if (_diag.onCommand) _diag.onCommand(cmd, theResult);
    return theResult;
  }
}

/**
 * 执行注册表查询
 */
export function runReg(queryPath: string, valueName?: string): string {
  let cmd = `reg query "${queryPath}"`;
  if (valueName) cmd += ` /v "${valueName}"`;
  const output = runCommand(cmd, 10_000).stdout;
  if (_diag.onReg) _diag.onReg(queryPath, output);
  return output;
}

/**
 * 执行 PowerShell 命令
 */
export function runPS(script: string, timeout = DEFAULT_TIMEOUT): string {
  const cmd = `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`;
  const psOutput = runCommand(cmd, timeout).stdout;
  if (_diag.onPS) _diag.onPS(script, psOutput);
  return psOutput;
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
