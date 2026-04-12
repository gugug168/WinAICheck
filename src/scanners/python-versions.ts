import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

function normalizePath(p: string): string {
  return p.trim().toLowerCase().replace(/\//g, '\\');
}

function parseVersion(stdout: string, stderr?: string): string {
  const combined = `${stdout || ''} ${stderr || ''}`;
  return combined.match(/Python (\d+\.\d+\.\d+)/)?.[1] || 'unknown';
}

function resolvePyDefaultPath(): string {
  const launcher = runCommand('py -0p', 3000);
  if (launcher.exitCode !== 0) return '';
  const lines = launcher.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // py -0p format: "-V:3.11 *        C:\Python311\python.exe"
  // Match only lines where * is a column marker (preceded by whitespace or -V: prefix)
  const starred = lines.find(line => /(?:^|\s)\*(?:\s|$)/.test(line));
  if (!starred) return lines[0]?.replace(/^-V:\S+\s+/, '').trim() || '';
  // Extract path after the * marker
  const match = starred.match(/\*\s+([A-Za-z]:\\.+)$/);
  if (match) return match[1].trim();
  // Fallback: take everything after the last whitespace run following *
  const afterStar = starred.split(/\*/).slice(1).join('*').trim();
  return afterStar || '';
}

/** 检测 Python 版本及多版本冲突 */
const scanner: Scanner = {
  id: 'python-versions',
  name: 'Python 版本检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const found = new Map<string, { command: string; version: string; path: string }>();
    const candidates = [
      { command: 'python', versionCmd: 'python --version', whereCmd: 'where.exe python' },
      { command: 'python3', versionCmd: 'python3 --version', whereCmd: 'where.exe python3' },
      { command: 'py', versionCmd: 'py -V', whereCmd: 'where.exe py' },
    ];

    for (const candidate of candidates) {
      const ver = runCommand(candidate.versionCmd, 5000);
      if (ver.exitCode === 0) {
        const where = runCommand(candidate.whereCmd, 3000);
        const resolvedPath = candidate.command === 'py'
          ? resolvePyDefaultPath() || where.stdout.split(/\r?\n/)[0].trim()
          : where.stdout.split(/\r?\n/)[0].trim();
        const version = parseVersion(ver.stdout, ver.stderr);
        const key = normalizePath(resolvedPath || `${candidate.command}:${version}`);
        if (!found.has(key)) {
          found.set(key, {
            command: candidate.command,
            version,
            path: resolvedPath,
          });
        }
      }
    }

    const versionsFound = [...found.values()];

    if (versionsFound.length === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Python 未安装或未加入当前命令环境',
      };
    }

    // 检查多版本冲突
    if (versionsFound.length > 1) {
      const versions = versionsFound.map(f => `${f.command} = ${f.version} (${f.path || '路径未知'})`);
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `检测到多个 Python 版本，可能存在冲突`,
        detail: versions.join('\n'),
      };
    }

    // 检查版本是否过旧
    const ver = versionsFound[0].version;
    const [major, minor] = ver.split('.').map(Number);
    if (major < 3 || (major === 3 && minor < 8)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `Python 版本过旧 (${ver})，建议 3.8+`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `Python 正常 (${ver})`,
    };
  },
};

registerScanner(scanner);
