import type { ScanResult, ScoreResult, ScannerCategory } from '../scanners/types';
import { sanitize } from '../privacy/sanitizer';

const CATEGORY_LABELS: Record<ScannerCategory, string> = {
  path: '路径与系统环境',
  toolchain: '核心工具链',
  gpu: '显卡与子系统',
  permission: '权限与安全',
  network: '网络与镜像',
};

const STATUS_COLORS: Record<string, string> = {
  pass: '#22c55e',
  warn: '#eab308',
  fail: '#ef4444',
  unknown: '#94a3b8',
};

const STATUS_LABELS: Record<string, string> = {
  pass: '通过',
  warn: '警告',
  fail: '失败',
  unknown: '未知',
};

/** 生成 HTML 报告 */
export function generateHtmlReport(results: ScanResult[], score: ScoreResult): string {
  const grouped = new Map<ScannerCategory, ScanResult[]>();
  for (const r of results) {
    const list = grouped.get(r.category) || [];
    list.push(r);
    grouped.set(r.category, list);
  }

  const categoriesHtml = [...grouped.entries()].map(([cat, items]) => {
    const label = CATEGORY_LABELS[cat];
    const passed = items.filter(r => r.status === 'pass').length;
    const total = items.filter(r => r.status !== 'unknown').length;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

    const itemsHtml = items.map(r => {
      const color = STATUS_COLORS[r.status];
      const statusLabel = STATUS_LABELS[r.status];
      return `<tr>
        <td>${sanitize(r.name)}</td>
        <td style="color:${color};font-weight:bold">${statusLabel}</td>
        <td>${sanitize(r.message)}</td>
        ${r.detail ? `<td><details><summary>详情</summary><pre>${sanitize(r.detail)}</pre></details></td>` : '<td>-</td>'}
      </tr>`;
    }).join('\n');

    return `
    <div class="category">
      <h3>${label} <span class="badge">${passed}/${total} (${pct}%)</span></h3>
      <table>
        <thead><tr><th>检测项</th><th>状态</th><th>说明</th><th>详情</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>`;
  }).join('\n');

  const gradeColor = score.score >= 90 ? '#22c55e' : score.score >= 70 ? '#3b82f6' : score.score >= 50 ? '#eab308' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>aicoevo - AI 环境诊断报告</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  .container { max-width: 960px; margin: 0 auto; }
  h1 { text-align: center; font-size: 1.8rem; margin-bottom: 0.5rem; }
  .subtitle { text-align: center; color: #94a3b8; margin-bottom: 2rem; }
  .score-card { text-align: center; background: #1e293b; border-radius: 12px; padding: 2rem; margin-bottom: 2rem; }
  .score-number { font-size: 4rem; font-weight: bold; color: ${gradeColor}; }
  .score-label { font-size: 1.2rem; color: #94a3b8; margin-top: 0.5rem; }
  .breakdown { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; margin-top: 1rem; }
  .breakdown-item { background: #334155; padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9rem; }
  .category { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
  .category h3 { margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
  .badge { background: #334155; padding: 0.2rem 0.6rem; border-radius: 6px; font-size: 0.8rem; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 0.5rem; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 0.85rem; }
  td { padding: 0.5rem; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
  details summary { cursor: pointer; color: #60a5fa; }
  pre { background: #0f172a; padding: 0.5rem; border-radius: 6px; margin-top: 0.3rem; font-size: 0.85rem; white-space: pre-wrap; }
  .footer { text-align: center; color: #475569; margin-top: 2rem; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="container">
  <h1>aicoevo AI 环境诊断报告</h1>
  <p class="subtitle">生成时间: ${new Date().toLocaleString('zh-CN')}</p>

  <div class="score-card">
    <div class="score-number">${score.score}</div>
    <div class="score-label">${score.label}</div>
    <div class="breakdown">
      ${score.breakdown.map(b => `<div class="breakdown-item">${CATEGORY_LABELS[b.category]}: ${b.passed}/${b.total}</div>`).join('\n')}
    </div>
  </div>

  ${categoriesHtml}

  <div class="footer">aicoevo v0.1.0 — AI 环境诊断工具</div>
</div>
</body>
</html>`;
}
