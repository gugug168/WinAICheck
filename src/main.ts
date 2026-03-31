#!/usr/bin/env bun
import { calculateScore } from './scoring/calculator';
import { runAllScanners, getScannerById } from './scanners/registry';
import { generateJsonReport } from './report/json';
import { generateHtmlReport } from './report/html';
import { getConsent, saveConsent } from './privacy/consent';
import { createPayload, saveLocal } from './privacy/uploader';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// 导入所有 scanner（触发注册）
import './scanners/index';

function showHelp() {
  console.log(`
aicoevo - AI 环境诊断工具 v0.1.0

用法: aicoevo [选项]

  （默认）启动 Web UI，自动打开浏览器查看诊断结果

选项:
  --cli           纯终端模式（不启动浏览器）
  --port=PORT     Web UI 端口（默认 3000）
  --json          输出 JSON 报告
  --html          生成 HTML 报告
  --report        同时生成 JSON + HTML 报告
  --help          显示帮助
`);
}

// ==================== 入口 ====================

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { showHelp(); return; }
  if (getConsent() === null) saveConsent(false);

  const useCli = args.includes('--cli');
  const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3000', 10);
  const wantJson = args.includes('--json') || args.includes('--report');
  const wantHtml = args.includes('--html') || args.includes('--report');

  if (useCli) {
    await cliMode(wantJson, wantHtml);
  } else {
    await webMode(port);
  }
}

// ==================== CLI 模式 ====================

async function cliMode(wantJson: boolean, wantHtml: boolean) {
  console.log('aicoevo v0.1.0 — 开始扫描...\n');

  const results = await runAllScanners(5);
  console.log('\n扫描完成！\n');

  const score = calculateScore(results);

  // 打印评分
  const gc = score.score >= 90 ? '\x1b[32m' : score.score >= 70 ? '\x1b[34m' : score.score >= 50 ? '\x1b[33m' : '\x1b[31m';
  console.log(`${gc}评分: ${score.score}/100 — ${score.label}\x1b[0m\n`);

  // 打印结果
  const icon: Record<string, string> = { pass: '✓', warn: '⚠', fail: '✗', unknown: '?' };
  const color: Record<string, string> = { pass: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', unknown: '\x1b[90m' };

  for (const r of results) {
    console.log(`  ${color[r.status]}${icon[r.status]}\x1b[0m ${r.name}: ${r.message}`);
    if (r.detail) console.log(`    \x1b[90m${r.detail.split('\n')[0]}\x1b[0m`);
  }

  // 报告
  if (wantJson || wantHtml) {
    if (!existsSync('reports')) mkdirSync('reports', { recursive: true });
    const ts = Date.now();
    if (wantJson) {
      const p = join('reports', `report-${ts}.json`);
      writeFileSync(p, generateJsonReport(results, score), 'utf-8');
      console.log(`\nJSON 报告: ${p}`);
    }
    if (wantHtml) {
      const p = join('reports', `report-${ts}.html`);
      writeFileSync(p, generateHtmlReport(results, score), 'utf-8');
      console.log(`HTML 报告: ${p}`);
    }
  }

  saveLocal(createPayload(results, score));
}

// ==================== Web UI 模式 ====================

async function webMode(port: number) {
  const { generateWebUI } = await import('./web/ui');
  const { executeFix } = await import('./fixers/index');

  let cached: any = null;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/') {
        if (!cached) cached = await runAllScanners(5);
        const score = calculateScore(cached);
        saveLocal(createPayload(cached, score));
        return new Response(generateWebUI(cached, score), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      if (url.pathname === '/api/fix' && req.method === 'POST') {
        const fix = await req.json();
        const result = await executeFix(fix);
        return Response.json(result);
      }

      if (url.pathname === '/api/scan' && req.method === 'POST') {
        cached = await runAllScanners(5);
        return Response.json({ ok: true });
      }

      if (url.pathname === '/api/scan-one' && req.method === 'POST') {
        const { scannerId } = await req.json() as { scannerId: string };
        const scanner = getScannerById(scannerId);
        if (!scanner) return Response.json({ error: '未找到 scanner' }, { status: 404 });
        const result = await scanner.scan();
        // 更新缓存中对应项
        if (cached) {
          const idx = cached.findIndex((r: any) => r.id === scannerId);
          if (idx >= 0) cached[idx] = result;
        }
        return Response.json(result);
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`\n  aicoevo Web UI 已启动`);
  console.log(`  浏览器访问: \x1b[36mhttp://localhost:${port}\x1b[0m\n`);

  try { execSync(`start http://localhost:${port}`, { windowsHide: true, timeout: 3000 }); } catch {}

  await new Promise(() => {});
}

main().catch(err => { console.error('运行出错:', err); process.exit(1); });
