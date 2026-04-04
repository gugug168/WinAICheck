/**
 * 系统环境信息收集（非 Scanner，仅供 stash payload 使用）
 */
import { runCommand, runPS } from '../executor';

export interface SystemInfo {
  os: string;
  cpu: string;
  ramGB: number;
  gpu: string;
  diskFreeGB: number;
}

/** 收集系统环境摘要 */
export function collectSystemInfo(): SystemInfo {
  return {
    os: collectOS(),
    cpu: collectCPU(),
    ramGB: collectRAM(),
    gpu: collectGPU(),
    diskFreeGB: collectDiskFree(),
  };
}

function collectOS(): string {
  const { stdout } = runCommand(
    'powershell -NoProfile -Command "[Environment]::OSVersion.VersionString; (Get-ItemProperty \'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\').DisplayVersion"',
    8000,
  );
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  const base = lines[0] || 'Windows';
  const build = lines[1] || '';
  return build ? `${base} ${build}` : base;
}

function collectCPU(): string {
  const stdout = runPS(
    '(Get-CimInstance Win32_Processor | Select-Object -First 1).Name',
    8000,
  );
  return stdout.trim() || '未知';
}

function collectRAM(): number {
  const stdout = runPS(
    '[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)',
    8000,
  );
  const gb = parseInt(stdout.trim(), 10);
  return Number.isNaN(gb) ? 0 : gb;
}

function collectGPU(): string {
  const { stdout, exitCode } = runCommand(
    'nvidia-smi --query-gpu=name --format=csv,noheader',
    5000,
  );
  if (exitCode === 0 && stdout.trim()) return stdout.split('\n')[0].trim();
  return '未检测到';
}

function collectDiskFree(): number {
  const stdout = runPS(
    '[math]::Round((Get-PSDrive C).Free / 1GB)',
    5000,
  );
  const gb = parseInt(stdout.trim(), 10);
  return Number.isNaN(gb) ? 0 : gb;
}
