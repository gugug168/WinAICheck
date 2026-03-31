#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { Welcome } from './tui/welcome.js';
import { ScanProgress } from './tui/scan-progress.js';
import { Results } from './tui/results.js';
import { calculateScore } from './scoring/calculator.js';
import { runAllScanners, getScanners } from './scanners/registry.js';
import { getFixSuggestions, executeFix } from './fixers/index.js';
import { generateJsonReport } from './report/json.js';
import { generateHtmlReport } from './report/html.js';
import { saveConsent, getConsent } from './privacy/consent.js';
import { createPayload, saveLocal } from './privacy/uploader.js';
import type { ScanResult, ScoreResult, FixSuggestion } from './scanners/types.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// 导入所有 scanner（触发注册）
import './scanners/index.js';

/** 解析命令行参数 */
function parseArgs(): {
  fix: boolean;
  json: boolean;
  html: boolean;
  report: boolean;
  noTui: boolean;
} {
  const args = process.argv.slice(2);
  return {
    fix: args.includes('--fix'),
    json: args.includes('--json'),
    html: args.includes('--html'),
    report: args.includes('--report'),
    noTui: args.includes('--no-tui') || args.includes('--json') || args.includes('--html'),
  };
}

/** 输出帮助信息 */
function showHelp() {
  console.log(`
aicoevo - AI 环境诊断工具 v0.1.0

用法: aicoevo [选项]

选项:
  --fix      扫描后提供修复建议
  --report   生成报告文件
  --json     输出 JSON 格式报告
  --html     生成 HTML 格式报告
  --no-tui   不使用 TUI 界面
  --help     显示帮助信息
`);
}

/** 主流程 */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const flags = parseArgs();

  // 首次运行询问数据分享
  const consent = getConsent();
  if (!consent) {
    // 默认不分享
    saveConsent(false);
  }

  // === TUI 模式 ===
  if (!flags.noTui) {
    await runTui(flags);
    return;
  }

  // === 无 TUI 模式 ===
  console.log('aicoevo v0.1.0 — 开始扫描...\n');

  const results = await runAllScanners(5, (completed, total, current) => {
    process.stdout.write(`\r[${completed}/${total}] ${current}...        `);
  });
  console.log('\r\n扫描完成！\n');

  const score = calculateScore(results);
  printResults(results, score);

  // 生成报告
  if (flags.json || flags.report) {
    const dir = 'reports';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const jsonPath = join(dir, `report-${Date.now()}.json`);
    writeFileSync(jsonPath, generateJsonReport(results, score), 'utf-8');
    console.log(`\nJSON 报告已保存: ${jsonPath}`);
  }

  if (flags.html || flags.report) {
    const dir = 'reports';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const htmlPath = join(dir, `report-${Date.now()}.html`);
    writeFileSync(htmlPath, generateHtmlReport(results, score), 'utf-8');
    console.log(`HTML 报告已保存: ${htmlPath}`);
  }

  // 修复
  if (flags.fix) {
    const fixes = getFixSuggestions(results);
    printFixes(fixes);
  }

  // 保存脱敏数据
  const payload = createPayload(results, score);
  const localPath = saveLocal(payload);
  console.log(`\n诊断数据已保存: ${localPath}`);
}

/** TUI 模式 */
async function runTui(flags: ReturnType<typeof parseArgs>) {
  // 显示欢迎界面
  const { waitUntilExit: waitWelcome } = render(<Welcome />);
  await new Promise(r => setTimeout(r, 1500));
  waitWelcome();

  // 扫描进度
  let progressInstance: ReturnType<typeof render> | null = null;
  let progressProps = { completed: 0, total: getScanners().length, current: '初始化...' };

  const results = await runAllScanners(5, (completed, total, current) => {
    progressProps = { completed, total, current };
  });

  const score = calculateScore(results);
  const fixes = flags.fix ? getFixSuggestions(results) : [];

  // 显示结果
  const { waitUntilExit } = render(
    <Results score={score} results={results} fixes={fixes} />,
  );
  await waitUntilExit();

  // 生成报告
  if (flags.report || flags.json || flags.html) {
    if (!existsSync('reports')) mkdirSync('reports', { recursive: true });

    if (flags.json || flags.report) {
      writeFileSync(
        join('reports', `report-${Date.now()}.json`),
        generateJsonReport(results, score),
        'utf-8',
      );
    }
    if (flags.html || flags.report) {
      writeFileSync(
        join('reports', `report-${Date.now()}.html`),
        generateHtmlReport(results, score),
        'utf-8',
      );
    }
  }

  // 保存脱敏数据
  saveLocal(createPayload(results, score));
}

/** 纯文本输出结果 */
function printResults(results: ScanResult[], score: ScoreResult) {
  const gradeColor = score.score >= 90 ? '\x1b[32m' : score.score >= 70 ? '\x1b[34m' : score.score >= 50 ? '\x1b[33m' : '\x1b[31m';
  console.log(`${gradeColor}评分: ${score.score}/100 — ${score.label}\x1b[0m\n`);

  const statusIcon: Record<string, string> = { pass: '✓', warn: '⚠', fail: '✗', unknown: '?' };
  const statusColor: Record<string, string> = { pass: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', unknown: '\x1b[90m' };

  for (const r of results) {
    const icon = statusIcon[r.status];
    const color = statusColor[r.status];
    console.log(`  ${color}${icon}\x1b[0m ${r.name}: ${r.message}`);
    if (r.detail) {
      console.log(`    \x1b[90m${r.detail.split('\n')[0]}\x1b[0m`);
    }
  }
}

/** 纯文本输出修复建议 */
function printFixes(fixes: FixSuggestion[]) {
  if (fixes.length === 0) {
    console.log('\n没有需要修复的项。');
    return;
  }

  const tierLabel: Record<string, string> = {
    green: '\x1b[32m[可自动修复]\x1b[0m',
    yellow: '\x1b[33m[需确认修复]\x1b[0m',
    red: '\x1b[31m[有指引]\x1b[0m',
    black: '\x1b[90m[仅告知]\x1b[0m',
  };

  console.log(`\n修复建议 (${fixes.length} 项):`);
  for (const f of fixes) {
    console.log(`\n  ${tierLabel[f.tier]} ${f.description.split('\n')[0]}`);
    if (f.commands) {
      for (const cmd of f.commands) {
        console.log(`    $ ${cmd}`);
      }
    }
  }
}

main().catch(err => {
  console.error('运行出错:', err);
  process.exit(1);
});
