import { calculateScore } from '../scoring/calculator';
import { getFixSuggestions } from '../fixers/index';
import { getInstallers } from '../installers/index';
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
.scan-btn{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;margin:0 auto 16px;display:block}
.scan-btn:hover{opacity:.9}
.scan-btn:disabled{opacity:.5;cursor:not-allowed}
.progress-bar{height:6px;background:#1e293b;border-radius:3px;overflow:hidden;margin:12px 0}
.progress-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:3px;transition:width .3s ease;width:0%}
#loading{display:none;text-align:center;padding:40px 0}
.spinner{width:36px;height:36px;border:3px solid #1e293b;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px}
@keyframes spin{to{transform:rotate(360deg)}}

/* 确认弹窗 */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;opacity:0;pointer-events:none;transition:opacity .2s}
.modal-overlay.active{opacity:1;pointer-events:auto}
.modal{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal h3{font-size:1.1rem;margin-bottom:12px}
.modal .modal-desc{font-size:.85rem;color:#94a3b8;margin-bottom:12px;white-space:pre-wrap;max-height:200px;overflow-y:auto}
.modal .modal-cmds{background:#0a0e1a;border-radius:8px;padding:10px 12px;font-family:monospace;font-size:.8rem;color:#64748b;margin-bottom:12px;white-space:pre-wrap}
.modal .modal-risk{font-size:.8rem;padding:8px 12px;border-radius:8px;margin-bottom:16px}
.modal .modal-risk.green-bg{background:#22c55e10;color:#22c55e}
.modal .modal-risk.yellow-bg{background:#eab30810;color:#eab308}
.modal .modal-risk.red-bg{background:#ef444410;color:#ef4444}
.modal .modal-checkbox{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:.85rem;color:#94a3b8}
.modal .modal-checkbox input{width:16px;height:16px;accent-color:#eab308}
.modal-actions{display:flex;gap:10px;justify-content:flex-end}
.modal-btn{padding:10px 20px;border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .15s}
.modal-btn.cancel{background:#334155;color:#94a3b8}.modal-btn.cancel:hover{background:#475569}
.modal-btn.confirm{background:#3b82f6;color:#fff}.modal-btn.confirm:hover{background:#2563eb}
.modal-btn.confirm:disabled{opacity:.4;cursor:not-allowed}
.modal-btn.danger{background:#ef444420;color:#ef4444}.modal-btn.danger:hover{background:#ef444430}

/* 修复后状态动画 */
.fix-updating{animation:pulse .6s ease}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}

/* Tab 导航 */
.tab-nav{display:flex;gap:28px;margin-bottom:32px;padding:16px 6px}
.tab-btn{font-size:2rem;font-weight:900;padding:18px 48px;border:none;border-radius:16px;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);position:relative;letter-spacing:2px;
  background:linear-gradient(145deg,#181d32,#0b0f1e);
  box-shadow:5px 5px 15px rgba(0,0,0,.7);
  color:#6b7280}
.tab-btn:hover{transform:translateY(-3px) scale(1.03);color:#d1d5db}
.tab-btn.active{transform:translateY(-4px) scale(1.08)}
/* 诊断Tab - 蓝色霓虹渐变文字 */
.tab-btn.active[onclick*="diag"]{
  background:linear-gradient(90deg,#3b82f6,#60a5fa,#93c5fd,#bfdbfe,#93c5fd,#60a5fa,#3b82f6);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 10px rgba(96,165,250,.9)) drop-shadow(0 0 25px rgba(59,130,246,.7)) drop-shadow(0 0 50px rgba(59,130,246,.4)) drop-shadow(0 4px 10px rgba(0,0,0,.9))}
.tab-btn.active[onclick*="diag"]::before{
  content:'';position:absolute;inset:0;border-radius:16px;z-index:-1;
  background:linear-gradient(145deg,#0d1a3a,#080f25);
  box-shadow:0 0 60px rgba(59,130,246,.5),0 0 120px rgba(59,130,246,.2),0 12px 40px rgba(0,0,0,.7);
  border:1px solid rgba(59,130,246,.35)}
/* 安装Tab - 紫色霓虹渐变文字 */
.tab-btn.active[onclick*="install"]{
  background:linear-gradient(90deg,#7c3aed,#a78bfa,#c4b5fd,#ddd6fe,#c4b5fd,#a78bfa,#7c3aed);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 10px rgba(167,139,250,.9)) drop-shadow(0 0 25px rgba(124,58,237,.7)) drop-shadow(0 0 50px rgba(124,58,237,.4)) drop-shadow(0 4px 10px rgba(0,0,0,.9))}
.tab-btn.active[onclick*="install"]::before{
  content:'';position:absolute;inset:0;border-radius:16px;z-index:-1;
  background:linear-gradient(145deg,#160d30,#0d0820);
  box-shadow:0 0 60px rgba(124,58,237,.5),0 0 120px rgba(124,58,237,.2),0 12px 40px rgba(0,0,0,.7);
  border:1px solid rgba(124,58,237,.35)}
.tab-content{display:none}
.tab-content.active{display:block}

/* 安装卡片 */
.install-card{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:16px;transition:border-color .2s}
.install-card:hover{border-color:#334155}
.install-header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.install-icon{font-size:2rem}
.install-title{font-size:1.05rem;font-weight:600}
.install-desc{font-size:.82rem;color:#94a3b8;margin-top:2px}
.install-meta{display:flex;gap:8px;margin-top:6px}
.install-tag{background:#1e293b;border-radius:4px;padding:2px 8px;font-size:.72rem;color:#64748b}
.install-tag.admin{color:#f97316;background:#f9731615}
.install-actions{margin-top:14px}
.install-btn{padding:10px 28px;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .15s;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff}
.install-btn:hover{opacity:.9}
.install-btn:disabled{opacity:.5;cursor:not-allowed}
.install-progress{margin-top:12px;display:none}
.install-progress.active{display:block}
.install-progress-bar{height:6px;background:#1e293b;border-radius:3px;overflow:hidden;margin-bottom:6px}
.install-progress-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:3px;transition:width .3s ease;width:0%}
.install-step{font-size:.82rem;color:#94a3b8}
.install-log{background:#0a0e1a;border-radius:8px;padding:10px 12px;margin-top:10px;max-height:200px;overflow-y:auto;font-family:'Cascadia Code','Consolas',monospace;font-size:.75rem;color:#64748b;display:none}
.install-log.active{display:block}
.install-log .log-line{margin-bottom:2px;white-space:pre-wrap}
.install-log .log-success{color:#22c55e}
.install-log .log-error{color:#ef4444}
.install-result{margin-top:10px;padding:10px 14px;border-radius:8px;font-size:.85rem;font-weight:500;display:none}
.install-result.success{display:block;background:#22c55e15;color:#22c55e;border:1px solid #22c55e30}
.install-result.fail{display:block;background:#ef444415;color:#ef4444;border:1px solid #ef444430}
</style>
</head>
<body>
<div class="container">
  <h1>aicoevo AI 环境诊断</h1>
  <p class="subtitle">扫描时间: ${new Date().toLocaleString('zh-CN')}</p>

  <!-- Tab 导航 -->
  <div class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('diag')">诊断结果</button>
    <button class="tab-btn" onclick="switchTab('install')">AI 工具安装</button>
  </div>

  <!-- 诊断结果 Tab -->
  <div id="tab-diag" class="tab-content active">
    <div id="results">
      ${renderScoreCard(score)}
      <button class="scan-btn" onclick="rescan()">重新扫描</button>
      ${renderFixSection(fixesByTier)}
      ${renderCategoryResults(grouped, score)}
    </div>

    <div id="loading">
      <div class="spinner"></div>
      <p style="color:#94a3b8">正在扫描...</p>
    </div>
  </div>

  <!-- AI 工具安装 Tab -->
  <div id="tab-install" class="tab-content">
    ${renderInstallTab()}
  </div>

  <div class="footer">aicoevo v0.1.0 — AI 环境诊断工具</div>
</div>

<!-- 确认弹窗 -->
<div id="modal-overlay" class="modal-overlay">
  <div class="modal">
    <h3 id="modal-title"></h3>
    <div id="modal-desc" class="modal-desc"></div>
    <div id="modal-cmds" class="modal-cmds"></div>
    <div id="modal-risk" class="modal-risk"></div>
    <label id="modal-checkbox-label" class="modal-checkbox" style="display:none">
      <input type="checkbox" id="modal-checkbox" onchange="toggleConfirmBtn()">
      我已了解风险，确认执行
    </label>
    <div class="modal-actions">
      <button class="modal-btn cancel" onclick="closeModal()">取消</button>
      <button id="modal-confirm" class="modal-btn confirm" onclick="confirmFix()">确认执行</button>
    </div>
  </div>
</div>

<script>
// --- Tab 切换 ---
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab-btn[onclick*="' + tab + '"]').classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

// --- 安装器数据 ---
const installers = ${JSON.stringify(getInstallers().map(i => ({
  id: i.id, name: i.name, description: i.description,
  icon: i.icon, needsAdmin: i.needsAdmin,
})))};

const installStates = {};
installers.forEach(i => { installStates[i.id] = 'idle'; });

async function startInstall(toolId) {
  if (installStates[toolId] !== 'idle') return;
  installStates[toolId] = 'installing';

  const card = document.getElementById('install-' + toolId);
  const btn = card.querySelector('.install-btn');
  const progressBar = card.querySelector('.install-progress-fill');
  const progressWrap = card.querySelector('.install-progress');
  const stepEl = card.querySelector('.install-step');
  const logEl = card.querySelector('.install-log');
  const resultEl = card.querySelector('.install-result');

  btn.disabled = true;
  btn.textContent = '安装中...';
  progressWrap.classList.add('active');
  logEl.classList.add('active');
  logEl.innerHTML = '';
  resultEl.className = 'install-result';
  resultEl.style.display = 'none';

  try {
    const res = await fetch('/api/install', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ tool: toolId }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          // store event type for next data line
          continue;
        }
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6));
            handleInstallEvent(evt, progressBar, stepEl, logEl);
          } catch(e) {}
        }
      }
    }
  } catch(e) {
    resultEl.textContent = '连接失败: ' + e.message;
    resultEl.className = 'install-result fail';
    btn.textContent = '重试';
    btn.disabled = false;
    installStates[toolId] = 'idle';
    progressWrap.classList.remove('active');
  }
}

function handleInstallEvent(evt, progressBar, stepEl, logEl) {
  if (evt.type === 'progress') {
    if (evt.pct != null) progressBar.style.width = evt.pct + '%';
    if (evt.step) stepEl.textContent = evt.step;
  }
  if (evt.type === 'log') {
    const div = document.createElement('div');
    div.className = 'log-line';
    if (evt.line.includes('[SUCCESS]')) div.classList.add('log-success');
    if (evt.line.includes('[ERROR]')) div.classList.add('log-error');
    div.textContent = evt.line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }
  if (evt.type === 'done') {
    const card = progressBar.closest('.install-card');
    const toolId = card.id.replace('install-', '');
    const btn = card.querySelector('.install-btn');
    const resultEl = card.querySelector('.install-result');
    const progressWrap = card.querySelector('.install-progress');

    if (evt.success) {
      progressBar.style.width = '100%';
      resultEl.textContent = '✓ ' + (evt.message || '安装完成');
      resultEl.className = 'install-result success';
      btn.textContent = '已安装';
      installStates[toolId] = 'done';
      setTimeout(() => { progressWrap.classList.remove('active'); }, 2000);
    } else {
      resultEl.textContent = '✗ ' + (evt.message || '安装失败');
      resultEl.className = 'install-result fail';
      btn.textContent = '重试';
      btn.disabled = false;
      installStates[toolId] = 'idle';
    }
  }
}

const fixes = ${JSON.stringify(
  [...fixesByTier.green, ...fixesByTier.yellow, ...fixesByTier.red, ...fixesByTier.black]
    .map(f => ({ ...f, executed: false, result: null }))
)};

let pendingFixIdx = null;

function openModal(idx) {
  const fix = fixes[idx];
  if (!fix || fix.executed) return;
  pendingFixIdx = idx;

  const tierConfig = ${JSON.stringify(TIER_CONFIG)};
  const tc = tierConfig[fix.tier] || {};

  document.getElementById('modal-title').textContent = tc.label + ': ' + (fix.description || '').split('\\n')[0];
  document.getElementById('modal-desc').textContent = fix.description || '';

  const cmdsEl = document.getElementById('modal-cmds');
  if (fix.commands && fix.commands.length > 0) {
    cmdsEl.textContent = fix.commands.map(c => '$ ' + c).join('\\n');
    cmdsEl.style.display = 'block';
  } else {
    cmdsEl.style.display = 'none';
  }

  const riskEl = document.getElementById('modal-risk');
  riskEl.textContent = '风险: ' + (fix.risk || '未知');
  riskEl.className = 'modal-risk ' + fix.tier + '-bg';

  const checkboxLabel = document.getElementById('modal-checkbox-label');
  const confirmBtn = document.getElementById('modal-confirm');

  if (fix.tier === 'green') {
    checkboxLabel.style.display = 'none';
    confirmBtn.className = 'modal-btn confirm';
    confirmBtn.disabled = false;
  } else if (fix.tier === 'yellow') {
    checkboxLabel.style.display = 'flex';
    document.getElementById('modal-checkbox').checked = false;
    confirmBtn.className = 'modal-btn confirm';
    confirmBtn.disabled = true;
  } else {
    checkboxLabel.style.display = 'none';
    confirmBtn.className = 'modal-btn danger';
    confirmBtn.disabled = false;
  }

  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  pendingFixIdx = null;
}

function toggleConfirmBtn() {
  const checked = document.getElementById('modal-checkbox').checked;
  document.getElementById('modal-confirm').disabled = !checked;
}

async function confirmFix() {
  if (pendingFixIdx === null) return;
  const idx = pendingFixIdx;
  const fix = fixes[idx];
  closeModal();

  const btn = document.getElementById('fix-btn-' + idx);
  if (btn) { btn.disabled = true; btn.textContent = '执行中...'; }

  try {
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(fix),
    });
    const data = await res.json();
    fix.executed = true;
    fix.result = data;

    // 显示执行结果
    const el = document.getElementById('fix-result-' + idx);
    if (el) {
      el.className = 'fix-result ' + (data.success ? 'success' : 'fail');
      el.textContent = (data.success ? '✓ ' : '✗ ') + data.message;
    }

    if (btn) {
      btn.textContent = data.success ? '已修复' : (data.rolledBack ? '已回滚' : '重试');
      btn.className = 'fix-btn ' + (data.success ? 'green' : 'yellow');
      if (!data.success) btn.disabled = false;
    }

    // 修复成功后，自动重扫对应 scanner 并更新 UI
    if (data.success && fix.scannerId) {
      await rescanOne(fix.scannerId);
    }
  } catch(e) {
    const el = document.getElementById('fix-result-' + idx);
    if (el) { el.className = 'fix-result fail'; el.textContent = '✗ 网络错误: ' + e.message; }
    if (btn) { btn.textContent = '重试'; btn.disabled = false; }
  }
}

async function rescanOne(scannerId) {
  try {
    const res = await fetch('/api/scan-one', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ scannerId }),
    });
    const newResult = await res.json();

    // 更新 scanner 状态
    const el = document.querySelector('[data-scanner-id="' + scannerId + '"]');
    if (el) {
      el.classList.add('fix-updating');
      const statusEl = el.querySelector('.status-icon');
      const msgEl = el.querySelector('.result-msg');
      const sc = ${JSON.stringify(STATUS_CONFIG)}[newResult.status] || ${JSON.stringify(STATUS_CONFIG)}.unknown;
      if (statusEl) {
        statusEl.style.background = sc.bg;
        statusEl.style.color = sc.color;
        statusEl.textContent = sc.icon;
      }
      if (msgEl) {
        msgEl.style.color = sc.color;
        msgEl.textContent = newResult.message;
      }
      setTimeout(() => el.classList.remove('fix-updating'), 600);
    }
  } catch(e) {
    // 单项重扫失败不影响主流程
    console.warn('重扫失败:', e);
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
  <div class="card score-card" id="score-card">
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
          <div class="result-item" data-scanner-id="${esc(r.id)}">
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
        ${(tier === 'green' || tier === 'yellow') ? `<button id="fix-btn-${f._idx}" class="fix-btn ${tier}" onclick="openModal(${f._idx})">${label}</button>` : ''}
      </div>`).join('')}
    </div>`);
  }

  return `
  <div class="card fix-section">
    <div class="section-title" style="color:#22c55e">修复建议 (${allFixes.length} 项)</div>
    ${sections.join('')}
  </div>`;
}

function renderInstallTab(): string {
  const installers = getInstallers();
  return `
  <div style="margin-bottom:16px">
    <div style="font-size:.92rem;color:#94a3b8;margin-bottom:4px">选择要安装的 AI 开发工具，点击安装按钮开始一键部署。</div>
    <div style="font-size:.78rem;color:#64748b">所有工具均使用国内镜像源加速下载</div>
  </div>
  ${installers.map(inst => `
  <div class="install-card" id="install-${esc(inst.id)}">
    <div class="install-header">
      <span class="install-icon">${inst.icon}</span>
      <div>
        <div class="install-title">${esc(inst.name)}</div>
        <div class="install-desc">${esc(inst.description)}</div>
        <div class="install-meta">
          ${inst.needsAdmin ? '<span class="install-tag admin">需要管理员权限</span>' : ''}
          <span class="install-tag">国内镜像加速</span>
        </div>
      </div>
    </div>
    <div class="install-actions">
      <button class="install-btn" onclick="startInstall('${esc(inst.id)}')">一键安装</button>
    </div>
    <div class="install-progress">
      <div class="install-progress-bar"><div class="install-progress-fill"></div></div>
      <div class="install-step">准备中...</div>
    </div>
    <div class="install-log"></div>
    <div class="install-result"></div>
  </div>`).join('')}
  <div class="card" style="border-color:#334155">
    <div style="font-size:.82rem;color:#64748b">
      <div style="font-weight:600;color:#94a3b8;margin-bottom:6px">安装说明</div>
      <div style="margin-bottom:4px">• Claude Code 安装包含: Chocolatey、Node.js、Git、npm 镜像、Claude Code CLI、MCP 服务器、CC Switch</div>
      <div style="margin-bottom:4px">• OpenClaw 是开源 Claude Code 替代品，通过 npmmirror.com 加速安装</div>
      <div style="margin-bottom:4px">• CCSwitch 通过 ghfast.top 镜像从 GitHub 下载</div>
      <div>• 需要管理员权限的工具会在安装时自动请求提权</div>
    </div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
