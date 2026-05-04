import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { getHomeDir, getProjectDir, parseJsonLoose } from './config-utils';

interface HookCommand {
  file: string;
  event: string;
  matcher: string;
  command: string;
}

interface HookConfig {
  path: string;
  data?: any;
  error?: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function getProjectHookJsonCandidates(projectClaudeDir: string): string[] {
  if (!existsSync(projectClaudeDir)) return [];
  try {
    return readdirSync(projectClaudeDir)
      .filter(name => /^hooks.*\.json$/i.test(name))
      .map(name => join(projectClaudeDir, name))
      .filter(path => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export function getClaudeHookConfigCandidates(): string[] {
  const homeClaudeDir = join(getHomeDir(), '.claude');
  const projectClaudeDir = join(getProjectDir(), '.claude');
  return unique([
    join(homeClaudeDir, 'settings.json'),
    join(homeClaudeDir, 'settings.local.json'),
    join(projectClaudeDir, 'settings.json'),
    join(projectClaudeDir, 'settings.local.json'),
    ...getProjectHookJsonCandidates(projectClaudeDir),
  ]);
}

function readHookConfigs(paths: string[]): HookConfig[] {
  return paths
    .filter(path => existsSync(path))
    .map(path => {
      try {
        return { path, data: parseJsonLoose(readFileSync(path, 'utf-8')) };
      } catch (error) {
        return {
          path,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
}

function matcherToText(matcher: unknown): string {
  if (typeof matcher === 'string') return matcher;
  if (!matcher || typeof matcher !== 'object') return '';
  const data = matcher as Record<string, unknown>;
  const event = typeof data.event === 'string' ? data.event : '';
  const tool = typeof data.tool === 'string'
    ? data.tool
    : Array.isArray(data.tools)
      ? data.tools.filter(item => typeof item === 'string').join('|')
      : '';
  return [event, tool].filter(Boolean).join(':') || JSON.stringify(data);
}

function collectFromEntry(file: string, entry: any, eventHint = ''): HookCommand[] {
  if (!entry || typeof entry !== 'object') return [];
  const matcher = matcherToText(entry.matcher);
  const event = eventHint || (matcher.startsWith('PostToolUse') ? 'PostToolUse' : '');
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
  return hooks
    .filter((hook: any) => hook && typeof hook === 'object' && typeof hook.command === 'string')
    .map((hook: any) => ({
      file,
      event,
      matcher,
      command: hook.command,
    }));
}

export function collectClaudeHookCommands(configs: HookConfig[]): HookCommand[] {
  const commands: HookCommand[] = [];
  for (const config of configs) {
    if (!config.data || typeof config.data !== 'object') continue;
    const hooks = config.data.hooks;
    if (Array.isArray(hooks)) {
      for (const entry of hooks) commands.push(...collectFromEntry(config.path, entry));
      continue;
    }
    if (hooks && typeof hooks === 'object') {
      for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) commands.push(...collectFromEntry(config.path, entry, event));
      }
    }
  }
  return commands;
}

function isPowerShellEnvCommandRisk(command: string): boolean {
  return /(powershell(?:\.exe)?|pwsh(?:\.exe)?)/i.test(command)
    && /(^|\s)-Command(\s|$)/i.test(command)
    && /\$env:/i.test(command);
}

function summarizeCommand(command: string): string {
  const shell = command.match(/\b(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i)?.[0] || 'PowerShell';
  const envRefCount = unique([...command.matchAll(/\$env:([A-Z0-9_]+)/gi)].map(match => match[1].toUpperCase())).length;
  const script = command.match(/[&]\s+([^\s"']+\.ps1)\b/i)?.[1];
  return [
    shell,
    '-Command',
    envRefCount > 0 ? `检测到 ${envRefCount} 个 $env 引用` : '检测到 $env 引用',
    script ? `script=${script}` : '',
  ].filter(Boolean).join(' ');
}

function formatRisk(item: HookCommand): string {
  const event = item.event || '(未声明事件)';
  const matcher = item.matcher || '(未声明 matcher)';
  return [
    `文件: ${item.file}`,
    `事件: ${event}`,
    `匹配: ${matcher}`,
    `命令摘要: ${summarizeCommand(item.command)}`,
  ].join('\n');
}

const scanner: Scanner = {
  id: 'claude-hook-compatibility',
  name: 'Claude Code Hook Windows 兼容性检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    const configs = readHookConfigs(getClaudeHookConfigCandidates());
    const parseErrors = configs.filter(config => config.error);

    if (parseErrors.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'misconfigured',
        message: 'Claude Code hook 配置文件无法解析',
        detail: parseErrors.map(config => `文件: ${config.path}\n错误: ${config.error}`).join('\n\n'),
      };
    }

    const commands = collectClaudeHookCommands(configs);
    const risks = commands.filter(item => isPowerShellEnvCommandRisk(item.command));

    if (risks.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'misconfigured',
        message: `发现 ${risks.length} 条 Claude Code hook 可能在 Windows 下误解析 $env 变量`,
        detail: [
          ...risks.map(formatRisk),
          '建议: 将 PowerShell hook 改成 -File 脚本.ps1 -参数 值，例如:',
          'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/post-edit-verify.ps1 -OutputDir .tmp/auto-loop -WebsiteUrl http://aicoevo.net',
          '原因: JSON 双引号命令中嵌套 -Command "$env:..." 时，外层 shell 可能先展开 $env，最终触发 :AUTO_LOOP_URL 这类 CommandNotFoundException。',
        ].join('\n\n'),
      };
    }

    const checked = configs.map(config => config.path);
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '未发现 Claude Code hook Windows 兼容性风险',
      detail: checked.length > 0
        ? `已检查:\n${checked.map(path => `${basename(path)}: ${path}`).join('\n')}`
        : '未发现 Claude Code hook 配置文件。',
    };
  },
};

registerScanner(scanner);
