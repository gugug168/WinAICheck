/**
 * Error classification system for fixer diagnostics (D-07, FIX-03).
 * Mirrors the architecture from mac-aicheck src/fixers/errors.ts
 */

import type { ScanResult } from '../scanners/types';

// Six error categories (D-07)
export type ErrorCategory =
  | 'timeout'
  | 'command-not-found'
  | 'permission-denied'
  | 'network-error'
  | 'disk-full'
  | 'generic';

// Error classification result
export interface ClassifiedError {
  category: ErrorCategory;
  code: string;           // e.g., "ERR_TIMEOUT_001" (D-18)
  recoverable: boolean;  // true if fixer should retry
  message: string;
  context?: string;       // additional diagnostic context (D-18)
}

/**
 * Classify a command execution failure into an ErrorCategory.
 * Examines exit code, stderr content, and error message patterns.
 */
export function classifyError(
  exitCode: number,
  stderr: string,
  errorMessage?: string
): ClassifiedError {
  const combined = `${stderr} ${errorMessage || ''}`.toLowerCase();

  // Error code mapping (D-18)
  const codeSuffix: Record<ErrorCategory, string> = {
    'timeout': '001',
    'command-not-found': '002',
    'permission-denied': '003',
    'network-error': '004',
    'disk-full': '005',
    'generic': '006',
  };

  // command-not-found: exit 127 or 9009, "not found", "not recognized"
  if (
    exitCode === 127 ||
    exitCode === 9009 ||
    combined.includes('command not found') ||
    combined.includes('not found') ||
    combined.includes('not recognized') ||
    combined.includes('找不到')
  ) {
    const code = `ERR_COMMAND_NOT_FOUND_${codeSuffix['command-not-found']}`;
    return { category: 'command-not-found', code, recoverable: false, message: `Command not found: ${stderr}`, context: stderr };
  }

  // permission-denied: exit 126, "permission denied", "eacces", "拒绝访问", "access is denied"
  if (
    exitCode === 126 ||
    combined.includes('permission denied') ||
    combined.includes('eacces') ||
    combined.includes('拒绝访问') ||
    combined.includes('access is denied') ||
    combined.includes('需要管理员')
  ) {
    const code = `ERR_PERMISSION_DENIED_${codeSuffix['permission-denied']}`;
    return { category: 'permission-denied', code, recoverable: false, message: `Permission denied: ${stderr}`, context: stderr };
  }

  // disk-full: "no space left", "disk full", "enospc"
  if (combined.includes('no space left') || combined.includes('disk full') || combined.includes('enospc')) {
    const code = `ERR_DISK_FULL_${codeSuffix['disk-full']}`;
    return { category: 'disk-full', code, recoverable: false, message: `Disk full: ${stderr}`, context: stderr };
  }

  // network-error: "connection refused", "network", "ename resolution", "http error", "eai_again"
  if (
    combined.includes('connection refused') ||
    combined.includes('network') ||
    combined.includes('ename resolution') ||
    combined.includes('http error') ||
    combined.includes('eai_again')
  ) {
    const code = `ERR_NETWORK_ERROR_${codeSuffix['network-error']}`;
    return { category: 'network-error', code, recoverable: true, message: `Network error: ${stderr}`, context: stderr };
  }

  // timeout: exit 124 (timeout command), "timed out"
  if (exitCode === 124 || combined.includes('timeout') || combined.includes('timed out') || combined.includes('超时')) {
    const code = `ERR_TIMEOUT_${codeSuffix['timeout']}`;
    return { category: 'timeout', code, recoverable: true, message: `Command timed out: ${stderr}`, context: stderr };
  }

  // generic: everything else
  const code = `ERR_GENERIC_${codeSuffix['generic']}`;
  return { category: 'generic', code, recoverable: false, message: errorMessage || `Command failed: ${stderr}`, context: stderr };
}

/**
 * Human-readable Chinese messages for each error category (DIA-01 foundation).
 */
export const ERROR_MESSAGES: Record<ErrorCategory, { title: string; suggestion: string }> = {
  'timeout': {
    title: '命令执行超时',
    suggestion: '网络连接不稳定或目标服务器响应慢，请检查网络后重试',
  },
  'command-not-found': {
    title: '命令未找到',
    suggestion: '请先安装对应工具，或检查 PATH 环境变量配置',
  },
  'permission-denied': {
    title: '权限不足',
    suggestion: '需要管理员权限，请使用 sudo 或联系系统管理员',
  },
  'network-error': {
    title: '网络错误',
    suggestion: '网络连接异常，请检查网络设置或代理配置',
  },
  'disk-full': {
    title: '磁盘空间不足',
    suggestion: '请清理磁盘空间后重试，使用 df -h 查看磁盘状态',
  },
  'generic': {
    title: '执行失败',
    suggestion: '命令执行失败，请查看详细错误信息',
  },
};
