#!/usr/bin/env bun
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { Welcome } from './tui/welcome';
import { ScanProgress } from './tui/scan-progress';
import { Results } from './tui/results';
import { FixDetail } from './tui/fix-detail';
import { calculateScore } from './scoring/calculator';
import { runAllScanners, getScanners } from './scanners/registry';
import { getFixSuggestions, executeFix } from './fixers/index';
import { generateJsonReport } from './report/json';
import { generateHtmlReport } from './report/html';
import { saveConsent, getConsent } from './privacy/consent';
import { createPayload, saveLocal } from './privacy/uploader';
import type { ScanResult, ScoreResult, FixSuggestion } from './scanners/types';
import type { FixResult } from './scanners/types';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

// 导入所有 scanner（触发注册）
import './scanners/index';

/** 解析命令行参数 */
function parseArgs() {
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
  --fix      扫描后提供交互式修复
  --report   生成报告文件
  --json     输出 JSON 格式报告
  --html     生成 HTML 格式报告
  --no-tui   不使用 TUI 界面
  --help     显示帮助信息
`);
}

// ==================== 主入口 ====================

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const flags = parseArgs();

  // 首次运行：默认不分享
  if (getConsent() === null) saveConsent(false);

  if (flags.noTui) {
    await runNoTui(flags);
  } else {
    await runTui(flags);
  }
}

// ==================== 无 TUI 模式 ====================

async function runNoTui(flags: ReturnType<typeof parseArgs>) {
  console.log('aicoevo v0.1.0 — 开始扫描...\n');

  const results = await runAllScanners(5, (completed, total, current) => {
    process.stdout.write(`\r[${completed}/${total}] ${current}...        `);
  });
  console.log('\r\n扫描完成！\n');

  const score = calculateScore(results);
  printResults(results, score);

  // 生成报告
  saveReports(results, score, flags);

  // 交互式修复
  if (flags.fix) {
    await interactiveFix(results);
  }

  // 保存脱敏数据
  const localPath = saveLocal(createPayload(results, score));
  console.log(`\n诊断数据已保存: ${localPath}`);
}

/** 交互式修复（无 TUI 版本，用 readline） */
async function interactiveFix(results: ScanResult[]) {
  const fixes = getFixSuggestions(results);
  if (fixes.length === 0) {
    console.log('\n所有检测项均通过，无需修复。');
    return;
  }

  // 按档位排序：green → yellow → red → black
  const tierOrder: Record<string, number> = { green: 0, yellow: 1, red: 2, black: 3 };
  fixes.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  const tierLabel: Record<string, string> = {
    green: '\x1b[32m[可自动修复]\x1b[0m',
    yellow: '\x1b[33m[需确认修复]\x1b[0m',
    red: '\x1b[31m[有指引]\x1b[0m',
    black: '\x1b[90m[仅告知]\x1b[0m',
  };

  console.log(`\n\x1b[1m修复建议 (${fixes.length} 项):\x1b[0m`);
  fixes.forEach((f, i) => {
    console.log(`  ${i + 1}. ${tierLabel[f.tier]} ${f.description.split('\n')[0]}`);
  });

  // 筛选可执行的修复（green + yellow）
  const executable = fixes.filter(f => f.tier === 'green' || f.tier === 'yellow');
  if (executable.length === 0) {
    console.log('\n没有可自动执行的修复项。以上为建议指引。');
    return;
  }

  console.log(`\n\x1b[36m可执行修复: ${executable.length} 项\x1b[0m`);
  console.log('输入编号执行对应修复（如 1），输入 a 全部执行，输入 q 跳过：');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (const fix of executable) {
    const idx = fixes.indexOf(fix) + 1;
    const tier = tierLabel[fix.tier];

    console.log(`\n\x1b[1m[${idx}] ${tier} ${fix.description.split('\n')[0]}\x1b[0m`);
    if (fix.commands) {
      fix.commands.forEach(cmd => console.log(`    $ ${cmd}`));
    }
    console.log(`    风险: ${fix.risk}`);

    const answer = await askYesNo(rl, `  执行此修复？(y/n/a/q) `);

    if (answer === 'q') break;
    if (answer === 'a') {
      // 执行所有剩余
      const remaining = executable.slice(executable.indexOf(fix));
      for (const f of remaining) {
        await runFix(f);
      }
      break;
    }
    if (answer === 'y') {
      await runFix(fix);
    }
  }

  rl.close();
}

function askYesNo(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function runFix(fix: FixSuggestion): Promise<void> {
  if (!fix.commands || fix.commands.length === 0) {
    console.log('  \x1b[33m此修复没有可执行的命令\x1b[0m');
    return;
  }

  console.log(`  \x1b[36m执行中...\x1b[0m`);
  const result = await executeFix(fix);
  if (result.success) {
    console.log(`  \x1b[32m成功: ${result.message}\x1b[0m`);
  } else {
    console.log(`  \x1b[31m失败: ${result.message}\x1b[0m`);
  }
}

// ==================== TUI 模式 ====================

type TuiPhase = 'welcome' | 'scanning' | 'results' | 'fixes';

function TuiApp({ flags }: { flags: ReturnType<typeof parseArgs> }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<TuiPhase>('welcome');
  const [results, setResults] = useState<ScanResult[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: getScanners().length, current: '初始化...' });
  const [fixResults, setFixResults] = useState<Map<string, FixResult>>(new Map());

  // 欢迎页 1.5 秒后自动进入扫描
  useEffect(() => {
    if (phase === 'welcome') {
      const timer = setTimeout(() => setPhase('scanning'), 1500);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // 扫描阶段
  useEffect(() => {
    if (phase !== 'scanning') return;

    let cancelled = false;
    runAllScanners(5, (completed, total, current) => {
      if (!cancelled) setProgress({ completed, total, current });
    }).then(scanResults => {
      if (!cancelled) {
        setResults(scanResults);
        setScore(calculateScore(scanResults));
        setPhase(flags.fix ? 'fixes' : 'results');
      }
    });

    return () => { cancelled = true; };
  }, [phase]);

  // 修复执行
  const handleFixExecute = async (fix: FixSuggestion) => {
    const result = await executeFix(fix);
    setFixResults(prev => new Map(prev).set(fix.id, result));
  };

  // 退出
  const handleExit = () => {
    if (results.length > 0) {
      const s = score || calculateScore(results);
      saveReports(results, s, flags);
      saveLocal(createPayload(results, s));
    }
    exit();
  };

  if (phase === 'welcome') {
    return <Welcome />;
  }

  if (phase === 'scanning') {
    return <ScanProgress {...progress} />;
  }

  if (phase === 'fixes' && score) {
    const fixes = getFixSuggestions(results);
    return (
      <FixDetail
        fixes={fixes}
        fixResults={fixResults}
        onExecute={handleFixExecute}
        onBack={() => setPhase('results')}
        onExit={handleExit}
      />
    );
  }

  if (score) {
    return (
      <ResultsView
        score={score}
        results={results}
        onExit={handleExit}
        showFix={flags.fix}
      />
    );
  }

  return <Text>加载中...</Text>;
}

/** 结果页（带退出快捷键） */
function ResultsView({
  score, results, onExit, showFix,
}: {
  score: ScoreResult;
  results: ScanResult[];
  onExit: () => void;
  showFix: boolean;
}) {
  useInput(input => {
    if (input === 'q' || input === 'Escape') onExit();
  });

  return (
    <Box flexDirection="column">
      <Results score={score} results={results} fixes={[]} />
      <Box marginTop={1}>
        <Text dimColor>按 q 退出 {showFix ? '| 按 f 查看修复建议' : ''}</Text>
      </Box>
    </Box>
  );
}

async function runTui(flags: ReturnType<typeof parseArgs>) {
  const { waitUntilExit } = render(<TuiApp flags={flags} />);
  await waitUntilExit();
}

// ==================== 通用工具 ====================

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

/** 保存报告文件 */
function saveReports(results: ScanResult[], score: ScoreResult, flags: ReturnType<typeof parseArgs>) {
  if (!flags.json && !flags.html && !flags.report) return;
  const dir = 'reports';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = Date.now();

  if (flags.json || flags.report) {
    const p = join(dir, `report-${ts}.json`);
    writeFileSync(p, generateJsonReport(results, score), 'utf-8');
    console.log(`JSON 报告已保存: ${p}`);
  }
  if (flags.html || flags.report) {
    const p = join(dir, `report-${ts}.html`);
    writeFileSync(p, generateHtmlReport(results, score), 'utf-8');
    console.log(`HTML 报告已保存: ${p}`);
  }
}

main().catch(err => {
  console.error('运行出错:', err);
  process.exit(1);
});
