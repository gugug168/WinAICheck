// scripts/audit.ts
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { _test } from '../src/executor/index';
import { createCommandMock } from '../tests/integration/mock-helper';
import { discoverValidators, runAllValidators, formatReport } from './ground-truth/runner';
import type { ValidationReport } from './ground-truth/types';

export interface AuditConfig {
  mode: 'scanners' | 'fixers';
  ci: boolean;
  json: boolean;
  outputPath?: string;
}

export function parseArgs(args: string[]): AuditConfig {
  return {
    mode: (args.find(a => a.startsWith('--mode='))?.split('=')[1] as AuditConfig['mode']) || 'scanners',
    ci: args.includes('--ci'),
    json: args.includes('--json'),
    outputPath: args[args.indexOf('--output') + 1],
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  if (config.mode === 'fixers') {
    console.log('修复器审计模式尚未实现（阶段 4+）');
    process.exit(0);
  }

  // 发现验证器
  const validators = await discoverValidators();
  if (validators.length === 0) {
    console.error('未找到任何验证器');
    process.exit(1);
  }

  console.log(`发现 ${validators.length} 个验证器\n`);

  // CI 模式: 加载 fixture 并设置 mock
  if (config.ci) {
    const fixtureDir = join(dirname(import.meta.url.replace('file:///', '').replace(/\//g, '\\')), 'ground-truth', 'fixtures');
    try {
      const files = readdirSync(fixtureDir).filter(f => f.endsWith('.json'));
      const commands = new Map<string, { stdout: string; exitCode: number }>();
      for (const file of files) {
        const fixture = JSON.parse(readFileSync(join(fixtureDir, file), 'utf-8'));
        for (const [cmd, resp] of Object.entries(fixture.commands || {})) {
          commands.set(cmd, resp as { stdout: string; exitCode: number });
        }
      }
      _test.mockExecSync = createCommandMock(commands);
      console.log(`CI 模式: 已加载 ${files.length} 个 fixture，${commands.size} 个 mock 命令\n`);
    } catch (err) {
      console.warn(`CI 模式: 无法加载 fixture: ${err}`);
    }
  }

  // 运行
  const reports = await runAllValidators(validators);

  // 清理 mock
  if (config.ci) {
    _test.mockExecSync = null;
    _test.mockReadFileSync = null;
    _test.mockExistsSync = null;
  }

  // 输出
  if (config.json) {
    const jsonOutput = JSON.stringify(reports, null, 2);
    if (config.outputPath) {
      mkdirSync(dirname(config.outputPath), { recursive: true });
      writeFileSync(config.outputPath, jsonOutput);
      console.log(`报告已保存: ${config.outputPath}`);
    } else {
      console.log(jsonOutput);
    }
  } else {
    const textOutput = formatReport(reports);
    console.log(textOutput);
    if (config.outputPath) {
      mkdirSync(dirname(config.outputPath), { recursive: true });
      writeFileSync(config.outputPath, textOutput);
      console.log(`\n报告已保存: ${config.outputPath}`);
    }
  }

  // 退出码: 有 incorrect 时返回 1
  const hasIssues = reports.some(r => r.overallVerdict === 'incorrect');
  process.exit(hasIssues ? 1 : 0);
}

// 仅在直接运行时执行 main，import 时不执行
if (import.meta.main) {
  main().catch(err => {
    console.error('审计失败:', err);
    process.exit(2);
  });
}
