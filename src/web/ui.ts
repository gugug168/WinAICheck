import { calculateScore } from '../scoring/calculator';
import { getFixSuggestions, executeFix } from '../fixers/index';
import type { ScanResult, ScoreResult, FixSuggestion, ScannerCategory } from '../scanners/types';
import type { FixResult } from '../scanners/types';

const CATEGORY_LABELS: Record<ScannerCategory, string> = {
  path: '路径与系统环境',
  toolchain: '核心工具链',
  gpu: '显卡与子系统',
  permission: '权限与安全',
  network: '网络与镜像',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pass: { label: '通过', color: '#22c55e', bg: '#22c55e15', icon: '✓' },
  warn: { label: '警告', color: '#eab308', bg: '#eab30815', icon: '⚠' },
  fail: { label: '失败', color: '#ef4444', bg: '#ef444415', icon: '✗' },
  unknown: { label: '未知', color: '#94a3b8', bg: '#94a3b815', icon: '?' },
};

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  green: { label: '一键修复', color: '#22c55e', bg: '#22c55e15', icon: '🟢' },
  yellow: { label: '确认修复', color: '#eab308', bg: '#eab30815', icon: '🟡' },
  red: { label: '操作指引', color: '#f97316', bg: '#f9731615', icon: '🔴' },
  black: { label: '仅供参考', color: '#94a3b8', bg: '#94a3b815', icon: '⚫' },
};

function gradeColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 70) return '#3b82f6';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}

function gradeGradient(score: number): string {
  const c = gradeColor(score);
  return `linear-gradient(135deg, ${c}22, ${c}08)`;
}

/**
 * 生成完整的 Web UI HTML 页面
 */
export function generateWebUI(
  results: ScanResult[],
  score: ScoreResult,
): string {
  const fixes = getFixSuggestions(results);
  const fixesByTier = { green: fixes.filter(f => f.tier === 'green'), yellow: fixes.filter(f => f.tier === 'yellow'), red: fixes.filter(f => f.tier === 'red'), black: fixes.filter(f => f.tier === 'black') };
  const grouped = new Map<ScannerCategory, ScanResult[]>();
  for (const r of results) grouped.set(r.category, (grouped.get(r.category) || []).concat(r));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>aicoevo - AI 环境诊断</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',-apple-system,'Microsoft YaHei',sans-serif;background:#0a0e1a;color:#e2e8f0;min-height:100vh}
.container{max-width:960px;margin:0 auto;padding:24px 20px}
h1{font-size:1.6rem;font-weight:700;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}
.subtitle{color:#64748b;font-size:.85rem;margin-bottom:24px}
.card{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:16px}
.score-card{text-align:center;padding:32px 20px;border:1px solid ${gradeColor(score.score)}40;background:${gradeGradient(score.score)}}
.score-number{font-size:4.5rem;font-weight:800;color:${gradeColor(score.score)};line-height:1}
.score-label{font-size:1.1rem;color:#94a3b8;margin-top:8px}
.score-detail{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px}
.score-tag{background:#1e293b;border-radius:6px;padding:4px 10px;font-size:.78rem;color:#94a3b8}
.score-tag .pass-count{color:#22c55e;font-weight:600}
.section-title{font-size:1rem;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.section-title .badge{font-size:.72rem;font-weight:500;background:#1e293b;padding:2px 8px;border-radius:4px;color:#94a3b8}
.result-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;transition:background .15s}
.result-item:hover{background:#ffffff08}
.status-icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0;margin-top:2px}
.result-name{font-weight:500;font-size:.88rem}
.result-msg{font-size:.82rem;color:#94a3b8;margin-top:2px}
.result-detail{font-size:.75rem;color:#64748b;margin-top:4px;white-space:pre-wrap;background:#0a0e1a;border-radius:6px;padding:6px 8px}
.fix-section{border:1px solid #22c55e30}
.fix-item{display:flex;align-items:center;gap:12px;padding:12px;border-radius:8px;margin-bottom:8px;background:#111827}
.fix-info{flex:1}
.fix-title{font-weight:500;font-size:.88rem}
.fix-desc{font-size:.78rem;color:#94a3b8;margin-top:4px;white-space:pre-wrap}
.fix-risk{font-size:.72rem;color:#64748b;margin-top:4px}
.fix-btn{padding:8px 18px;border:none;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
.fix-btn.green{background:#22c55e20;color:#22c55e}.fix-btn.green:hover{background:#22c55e35}
.fix-btn.yellow{background:#eab30820;color:#eab308}.fix-btn.yellow:hover{background:#eab30835}
.fix-btn:disabled{opacity:.5;cursor:not-allowed}
.fix-result{font-size:.78rem;margin-top:6px;padding:4px 8px;border-radius:4px}
.fix-result.success{background:#22c55e15;color:#22c55e}
.fix-result.fail{background:#ef444415;color:#ef4444}
.category-bar{height:4px;border-radius:2px;background:#1e293b;overflow:hidden;margin-top:6px}
.category-fill{height:100%;border-radius:2px;transition:width .6s ease}
.footer{text-align:center;color:#334155;font-size:.75rem;margin-top:24px;padding:16px 0}
.scan-btn{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;margin:8px auto;display:block}
.scan-btn:hover{opacity:.9}
.scan-btn:disabled{opacity:.5;cursor:not-allowed}
.progress-bar{height:6px;background:#1e293b;border-radius:3px;overflow:hidden;margin:12px 0}
.progress-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:3px;transition:width .3s ease;width:0%}
#loading{display:none;text-align:center;padding:40px 0}
.spinner{width:36px;height:36px;border:3px solid #1e293b;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <h1>aicoevo AI 环境诊断</h1>
  <p class="subtitle">扫描时间: ${new Date().toLocaleString('zh-CN')}</p>

  <div id="results">
    ${renderScoreCard(score)}
    ${renderFixSection(fixesByTier)}
    ${renderCategoryResults(grouped, score)}
  </div>

  <div class="footer">aicoevo v0.1.0 — AI 环境诊断工具</div>
</div>

<script>
const fixes = ${JSON.stringify(
  [...fixesByTier.green, ...fixesByTier.yellow, ...fixesByTier.red, ...fixesByTier.black]
    .map(f => ({ ...f, executed: false, result: null }))
)};

async function doFix(idx) {
  const fix = fixes[idx];
  if (!fix || fix.executed) return;
  const btn = document.getElementById('fix-btn-' + idx);
  btn.disabled = true;
  btn.textContent = '执行中...';
  try {
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(fix),
    });
    const data = await res.json();
    fix.executed = true;
    fix.result = data;
    const el = document.getElementById('fix-result-' + idx);
    el.className = 'fix-result ' + (data.success ? 'success' : 'fail');
    el.textContent = (data.success ? '✓ ' : '✗ ') + data.message;
    btn.textContent = data.success ? '已修复' : '失败';
    btn.className = 'fix-btn ' + (data.success ? 'green' : 'yellow');
  } catch(e) {
    const el = document.getElementById('fix-result-' + idx);
    el.className = 'fix-result fail';
    el.textContent = '✗ 网络错误: ' + e.message;
    btn.textContent = '重试';
    btn.disabled = false;
  }
}

async function rescan() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('results').style.display = 'none';
  const btn = document.querySelector('.scan-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/scan', {method:'POST'});
    if (res.ok) location.reload();
  } catch(e) { location.reload(); }
}
</script>
</body>
</html>`;
}

function renderScoreCard(score: ScoreResult): string {
  return `
  <div class="card score-card">
    <div class="score-number">${score.score}</div>
    <div class="score-label">${score.label}</div>
    <div class="score-detail">
      ${score.breakdown.map(b => `<div class="score-tag">${CATEGORY_LABELS[b.category]}: <span class="pass-count">${b.passed}/${b.total}</span></div>`).join('')}
    </div>
  </div>`;
}

function renderCategoryResults(grouped: Map<ScannerCategory, ScanResult[]>, score: ScoreResult): string {
  const html: string[] = [];
  for (const [cat, items] of grouped) {
    const bd = score.breakdown.find(b => b.category === cat);
    const passed = bd?.passed || 0;
    const total = bd?.total || items.length;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const barColor = pct === 100 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';

    html.push(`
    <div class="card">
      <div class="section-title">
        ${CATEGORY_LABELS[cat]}
        <span class="badge">${passed}/${total} 通过</span>
      </div>
      <div class="category-bar"><div class="category-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div style="margin-top:12px">
        ${items.map(r => {
          const sc = STATUS_CONFIG[r.status];
          return `
          <div class="result-item">
            <div class="status-icon" style="background:${sc.bg};color:${sc.color}">${sc.icon}</div>
            <div>
              <div class="result-name">${esc(r.name)}</div>
              <div class="result-msg" style="color:${sc.color}">${esc(r.message)}</div>
              ${r.detail ? `<div class="result-detail">${esc(r.detail)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`);
  }
  return html.join('\n');
}

function renderFixSection(fixesByTier: Record<string, FixSuggestion[]>): string {
  const allFixes = [...fixesByTier.green, ...fixesByTier.yellow, ...fixesByTier.red, ...fixesByTier.black];
  if (allFixes.length === 0) return '';

  const sections: string[] = [];
  const allFixesWithIdx = allFixes.map((f, i) => ({ ...f, _idx: i }));

  for (const [tier, label] of [['green', '一键修复'], ['yellow', '确认修复'], ['red', '操作指引'], ['black', '仅供参考']] as const) {
    const items = allFixesWithIdx.filter(f => f.tier === tier);
    if (items.length === 0) continue;
    const tc = TIER_CONFIG[tier];
    sections.push(`
    <div style="margin-bottom:8px">
      <div style="font-size:.82rem;font-weight:600;color:${tc.color};margin-bottom:8px">${tc.icon} ${label} (${items.length})</div>
      ${items.map(f => `
      <div class="fix-item">
        <div class="fix-info">
          <div class="fix-title">${esc(f.description.split('\n')[0])}</div>
          ${f.description.includes('\n') ? `<div class="fix-desc">${esc(f.description.split('\n').slice(1).join('\n'))}</div>` : ''}
          ${f.commands ? `<div class="fix-desc" style="color:#64748b;font-family:monospace">${f.commands.map(c => '$ ' + esc(c)).join('\n')}</div>` : ''}
          <div class="fix-risk">风险: ${esc(f.risk)}</div>
          <div id="fix-result-${f._idx}"></div>
        </div>
        ${(tier === 'green' || tier === 'yellow') ? `<button id="fix-btn-${f._idx}" class="fix-btn ${tier}" onclick="doFix(${f._idx})">${label}</button>` : ''}
      </div>`).join('')}
    </div>`);
  }

  return `
  <div class="card fix-section">
    <div class="section-title" style="color:#22c55e">修复建议 (${allFixes.length} 项)</div>
    ${sections.join('')}
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
