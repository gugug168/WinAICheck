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

type CommunityPayload = {
  results?: Array<{ status: string; category: string }>;
  score?: number;
  system?: Record<string, unknown>;
  pathEntries?: string[];
  envKeys?: Record<string, string>;
};

type CommunitySolution = {
  title: string;
  tags?: string[];
  votes?: number;
  author_name?: string;
};

declare global {
  interface Window {
    __scanPayload?: CommunityPayload;
  }
}

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
  prevScore: number | null = null,
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg-deep:#050810;
  --bg-card:rgba(12,18,35,.85);
  --bg-card-hover:rgba(18,26,50,.9);
  --border:rgba(0,240,255,.08);
  --border-hover:rgba(0,240,255,.18);
  --cyan:#00f0ff;
  --cyan-dim:#0891b2;
  --cyan-glow:rgba(0,240,255,.35);
  --amber:#ff6b35;
  --green:#00ff88;
  --red:#ff3355;
  --yellow:#ffc107;
  --text:#e0f0ff;
  --text-dim:#5a7a9a;
  --text-mid:#8aa8c8;
  --mono:'JetBrains Mono','Cascadia Code','Consolas',monospace;
  --display:'Orbitron','Segoe UI',sans-serif;
  --body:'Segoe UI',-apple-system,'Microsoft YaHei',sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--body);background:var(--bg-deep);color:var(--text);min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%,rgba(0,240,255,.06),transparent),
    radial-gradient(ellipse 60% 50% at 80% 100%,rgba(124,58,237,.04),transparent),
    linear-gradient(180deg,#050810,#080d1a 50%,#050810)}
body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:
    linear-gradient(rgba(0,240,255,.03) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,240,255,.03) 1px,transparent 1px);
  background-size:60px 60px;
  mask-image:radial-gradient(ellipse 70% 70% at 50% 30%,black,transparent)}
.container{max-width:960px;margin:0 auto;padding:28px 20px;position:relative;z-index:1}
h1{font-family:var(--display);font-size:1.5rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;
  background:linear-gradient(135deg,var(--cyan),#a78bfa,var(--cyan));
  background-size:200% 200%;
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  animation:gradShift 4s ease infinite}
@keyframes gradShift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.subtitle{color:var(--text-dim);font-size:.8rem;margin-bottom:28px;letter-spacing:1px}
/* 卡片 */
.card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px;
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  transition:border-color .25s,box-shadow .25s}
.card:hover{border-color:var(--border-hover);box-shadow:0 0 30px rgba(0,240,255,.04)}
/* 评分卡 */
.score-card{text-align:center;padding:36px 20px;position:relative;overflow:hidden;
  border:1px solid ${gradeColor(score.score)}30;background:${gradeGradient(score.score)}}
.score-card::before{content:'';position:absolute;top:0;left:-100%;width:200%;height:2px;
  background:linear-gradient(90deg,transparent,${gradeColor(score.score)}80,transparent);
  animation:scanLine 3s ease-in-out infinite}
@keyframes scanLine{0%{left:-100%}100%{left:100%}}
.score-number{font-family:var(--display);font-size:5rem;font-weight:900;color:${gradeColor(score.score)};
  line-height:1;text-shadow:0 0 30px ${gradeColor(score.score)}40,0 0 60px ${gradeColor(score.score)}15}
.score-label{font-family:var(--display);font-size:.85rem;letter-spacing:4px;text-transform:uppercase;color:var(--text-mid);margin-top:10px}
.score-detail{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px}
.score-tag{background:rgba(0,240,255,.06);border:1px solid rgba(0,240,255,.1);border-radius:6px;padding:4px 12px;font-size:.75rem;color:var(--text-dim);font-family:var(--mono)}
.score-tag .pass-count{color:var(--green);font-weight:600}
/* 区域标题 */
.section-title{font-family:var(--display);font-size:.85rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:10px;color:var(--cyan)}
.section-title .badge{font-family:var(--mono);font-size:.68rem;font-weight:400;background:rgba(0,240,255,.08);border:1px solid rgba(0,240,255,.12);padding:2px 10px;border-radius:4px;color:var(--text-mid)}
/* 扫描结果 */
.result-item{display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-radius:10px;margin-bottom:4px;transition:background .15s}
.result-item:hover{background:rgba(0,240,255,.03)}
.status-icon{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0;margin-top:1px;transition:box-shadow .2s}
.result-item:hover .status-icon{box-shadow:0 0 12px currentColor}
.result-name{font-weight:500;font-size:.88rem;letter-spacing:.3px}
.result-msg{font-size:.82rem;color:var(--text-mid);margin-top:2px}
.result-detail{font-size:.75rem;color:var(--text-dim);margin-top:6px;white-space:pre-wrap;background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-family:var(--mono)}
/* 修复区 */
.fix-section{border:1px solid rgba(0,255,136,.15)}
.fix-item{display:flex;align-items:center;gap:14px;padding:14px;border-radius:10px;margin-bottom:8px;background:var(--bg-card);border:1px solid var(--border);transition:border-color .2s}
.fix-item:hover{border-color:var(--border-hover)}
.fix-info{flex:1}
.fix-title{font-weight:500;font-size:.88rem}
.fix-desc{font-size:.78rem;color:var(--text-mid);margin-top:4px;white-space:pre-wrap}
.fix-risk{font-size:.72rem;color:var(--text-dim);margin-top:4px}
.fix-btn{padding:8px 20px;border:1px solid;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:var(--mono)}
.fix-btn.green{background:rgba(0,255,136,.08);color:var(--green);border-color:rgba(0,255,136,.2)}.fix-btn.green:hover{background:rgba(0,255,136,.15);box-shadow:0 0 20px rgba(0,255,136,.15)}
.fix-btn.yellow{background:rgba(255,193,7,.08);color:var(--yellow);border-color:rgba(255,193,7,.2)}.fix-btn.yellow:hover{background:rgba(255,193,7,.15);box-shadow:0 0 20px rgba(255,193,7,.15)}
.fix-btn:disabled{opacity:.4;cursor:not-allowed}
.fix-result{font-size:.78rem;margin-top:8px;padding:6px 10px;border-radius:6px}
.fix-result.success{background:rgba(0,255,136,.08);color:var(--green)}
.fix-result.fail{background:rgba(255,51,85,.08);color:var(--red)}
/* 分类进度条 */
.category-bar{height:3px;border-radius:2px;background:rgba(0,240,255,.08);overflow:hidden;margin-top:8px}
.category-fill{height:100%;border-radius:2px;transition:width .6s ease;box-shadow:0 0 8px currentColor}
/* 底部 */
.footer{text-align:center;color:var(--text-dim);font-size:.72rem;margin-top:32px;padding:20px 0;letter-spacing:2px;font-family:var(--mono)}
.footer::before{content:'';display:block;width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--cyan-dim),transparent);margin:0 auto 12px}
/* 扫描按钮 */
.scan-btn{background:linear-gradient(135deg,var(--cyan),#7c3aed);color:#fff;border:none;padding:10px 28px;border-radius:10px;font-size:.85rem;font-weight:600;cursor:pointer;margin:0 auto 20px;display:block;font-family:var(--mono);letter-spacing:1px;transition:all .2s;box-shadow:0 0 20px rgba(0,240,255,.15)}
.scan-btn:hover{transform:translateY(-1px);box-shadow:0 0 30px rgba(0,240,255,.25)}
.scan-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
/* 进度条 */
.progress-bar{height:4px;background:rgba(0,240,255,.08);border-radius:2px;overflow:hidden;margin:12px 0}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--cyan),#7c3aed);border-radius:2px;transition:width .3s ease;width:0%;box-shadow:0 0 10px var(--cyan-glow)}
#loading{display:none;text-align:center;padding:40px 0}
.spinner{width:36px;height:36px;border:3px solid rgba(0,240,255,.1);border-top-color:var(--cyan);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px}
.scan-progress-wrap{max-width:400px;margin:0 auto}
.scan-progress-bar{height:6px;background:rgba(0,240,255,.08);border-radius:3px;overflow:hidden;margin:12px 0 8px}
.scan-progress-fill{height:100%;background:linear-gradient(90deg,var(--cyan),#7c3aed);border-radius:3px;transition:width .3s ease;width:0%;box-shadow:0 0 10px var(--cyan-glow)}
.scan-progress-text{color:#94a3b8;font-size:14px;margin:0}
@keyframes spin{to{transform:rotate(360deg)}}
/* ====== Tab 导航 - 赛博朋克风格 ====== */
.tab-nav{display:flex;gap:16px;margin-bottom:32px;padding:8px}
.tab-btn{font-family:var(--display);font-size:1.15rem;font-weight:700;padding:14px 40px;border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:all .35s cubic-bezier(.4,0,.2,1);position:relative;letter-spacing:2px;text-transform:uppercase;
  background:rgba(8,12,24,.6);color:var(--text-dim);backdrop-filter:blur(8px);overflow:hidden}
.tab-btn::after{content:'';position:absolute;bottom:0;left:50%;width:0;height:2px;background:var(--cyan);transition:all .35s;transform:translateX(-50%);border-radius:1px}
.tab-btn:hover{border-color:rgba(0,240,255,.15);color:var(--text-mid);background:rgba(8,12,24,.8)}
.tab-btn:hover::after{width:40%}
.tab-btn.active{transform:translateY(-2px);color:var(--cyan)}
.tab-btn.active::after{width:80%;box-shadow:0 0 12px var(--cyan-glow)}
/* 诊断Tab - 青色霓虹 */
.tab-btn.active[onclick*="diag"]{
  background:rgba(0,240,255,.05);border-color:rgba(0,240,255,.25);
  box-shadow:0 0 30px rgba(0,240,255,.12),0 0 60px rgba(0,240,255,.06),inset 0 0 20px rgba(0,240,255,.04);
  color:var(--cyan);
  text-shadow:0 0 8px rgba(0,240,255,.6),0 0 20px rgba(0,240,255,.3)}
.tab-btn.active[onclick*="diag"]::after{background:var(--cyan);box-shadow:0 0 15px var(--cyan-glow),0 0 30px rgba(0,240,255,.2)}
.tab-btn.active[onclick*="diag"]::before{content:'';position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(135deg,rgba(0,240,255,.03),transparent 50%,rgba(0,240,255,.02));pointer-events:none}
/* 安装Tab - 紫色霓虹 */
.tab-btn.active[onclick*="install"]{
  background:rgba(124,58,237,.05);border-color:rgba(124,58,237,.25);
  box-shadow:0 0 30px rgba(124,58,237,.12),0 0 60px rgba(124,58,237,.06),inset 0 0 20px rgba(124,58,237,.04);
  color:#c4b5fd;
  text-shadow:0 0 8px rgba(167,139,250,.6),0 0 20px rgba(167,139,250,.3)}
.tab-btn.active[onclick*="install"]::after{background:#a78bfa;box-shadow:0 0 15px rgba(167,139,250,.35),0 0 30px rgba(124,58,237,.2)}
.tab-btn.active[onclick*="install"]::before{content:'';position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(135deg,rgba(124,58,237,.03),transparent 50%,rgba(124,58,237,.02));pointer-events:none}
/* 教学Tab - 绿色霓虹 */
.tab-btn.active[onclick*="learn"]{
  background:rgba(0,255,136,.05);border-color:rgba(0,255,136,.25);
  box-shadow:0 0 30px rgba(0,255,136,.12),0 0 60px rgba(0,255,136,.06),inset 0 0 20px rgba(0,255,136,.04);
  color:#6ee7b7;
  text-shadow:0 0 8px rgba(0,255,136,.6),0 0 20px rgba(0,255,136,.3)}
.tab-btn.active[onclick*="learn"]::after{background:var(--green);box-shadow:0 0 15px rgba(0,255,136,.35),0 0 30px rgba(0,255,136,.2)}
.tab-btn.active[onclick*="learn"]::before{content:'';position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(135deg,rgba(0,255,136,.03),transparent 50%,rgba(0,255,136,.02));pointer-events:none}
/* 资源Tab - 琥珀/橙色霓虹 */
.tab-btn.active[onclick*="resources"]{
  background:rgba(255,107,53,.05);border-color:rgba(255,107,53,.25);
  box-shadow:0 0 30px rgba(255,107,53,.12),0 0 60px rgba(255,107,53,.06),inset 0 0 20px rgba(255,107,53,.04);
  color:#fdba74;
  text-shadow:0 0 8px rgba(255,107,53,.6),0 0 20px rgba(255,107,53,.3)}
.tab-btn.active[onclick*="resources"]::after{background:var(--amber);box-shadow:0 0 15px rgba(255,107,53,.35),0 0 30px rgba(255,107,53,.2)}
.tab-btn.active[onclick*="resources"]::before{content:'';position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(135deg,rgba(255,107,53,.03),transparent 50%,rgba(255,107,53,.02));pointer-events:none}
/* 学习链接 */
.learn-link{display:flex;align-items:center;gap:14px;padding:14px;border-radius:10px;border:1px solid var(--border);text-decoration:none;color:var(--text);transition:all .2s}
.learn-link:hover{border-color:var(--border-hover);background:rgba(0,240,255,.03)}
.learn-link-icon{font-size:1.5rem;flex-shrink:0}
.learn-link-title{font-weight:600;font-size:.88rem;margin-bottom:2px}
.learn-link-desc{font-size:.78rem;color:var(--text-dim)}
.tab-content{display:none}
.tab-content.active{display:block}
/* ====== 安装卡片 ====== */
.install-card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px;transition:border-color .25s,box-shadow .25s;backdrop-filter:blur(12px)}
.install-card:hover{border-color:var(--border-hover);box-shadow:0 0 30px rgba(0,240,255,.04)}
.install-header{display:flex;align-items:center;gap:14px;margin-bottom:10px}
.install-icon{font-size:2.2rem}
.install-title{font-family:var(--display);font-size:.95rem;font-weight:700;letter-spacing:1px}
.install-desc{font-size:.82rem;color:var(--text-mid);margin-top:4px}
.install-meta{display:flex;gap:8px;margin-top:8px}
.install-tag{background:rgba(0,240,255,.06);border:1px solid rgba(0,240,255,.1);border-radius:5px;padding:2px 10px;font-size:.72rem;color:var(--text-dim);font-family:var(--mono)}
.install-tag.admin{color:var(--amber);background:rgba(255,107,53,.08);border-color:rgba(255,107,53,.15)}
.install-actions{margin-top:16px}
.install-btn{padding:10px 28px;border:1px solid rgba(0,240,255,.2);border-radius:10px;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:var(--mono);letter-spacing:1px;
  background:linear-gradient(135deg,rgba(0,240,255,.1),rgba(124,58,237,.1));color:var(--cyan)}
.install-btn:hover{background:linear-gradient(135deg,rgba(0,240,255,.18),rgba(124,58,237,.18));box-shadow:0 0 25px rgba(0,240,255,.15);transform:translateY(-1px)}
.install-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.install-progress{margin-top:14px;display:none}
.install-progress.active{display:block}
.install-progress-bar{height:4px;background:rgba(0,240,255,.08);border-radius:2px;overflow:hidden;margin-bottom:8px}
.install-progress-fill{height:100%;background:linear-gradient(90deg,var(--cyan),#7c3aed);border-radius:2px;transition:width .3s ease;width:0%;box-shadow:0 0 10px var(--cyan-glow)}
.install-step{font-size:.82rem;color:var(--text-mid);font-family:var(--mono)}
.install-log{background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:12px;max-height:200px;overflow-y:auto;font-family:var(--mono);font-size:.75rem;color:var(--text-dim);display:none}
.install-log.active{display:block}
.install-log .log-line{margin-bottom:2px;white-space:pre-wrap}
.install-log .log-success{color:var(--green)}
.install-log .log-error{color:var(--red)}
.install-result{margin-top:12px;padding:10px 14px;border-radius:8px;font-size:.85rem;font-weight:500;display:none}
.install-result.success{display:block;background:rgba(0,255,136,.06);color:var(--green);border:1px solid rgba(0,255,136,.15)}
.install-result.fail{display:block;background:rgba(255,51,85,.06);color:var(--red);border:1px solid rgba(255,51,85,.15)}
/* ====== 弹窗 ====== */
.modal-overlay{position:fixed;inset:0;background:rgba(5,8,16,.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100;opacity:0;pointer-events:none;transition:opacity .25s}
.modal-overlay.active{opacity:1;pointer-events:auto}
.modal{background:rgba(12,18,35,.95);border:1px solid var(--border-hover);border-radius:16px;padding:28px;max-width:500px;width:90%;box-shadow:0 20px 80px rgba(0,0,0,.6),0 0 40px rgba(0,240,255,.06)}
.modal h3{font-family:var(--display);font-size:1rem;letter-spacing:1px;margin-bottom:14px}
.modal .modal-desc{font-size:.85rem;color:var(--text-mid);margin-bottom:14px;white-space:pre-wrap;max-height:200px;overflow-y:auto}
.modal .modal-cmds{background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:var(--mono);font-size:.8rem;color:var(--text-dim);margin-bottom:14px;white-space:pre-wrap}
.modal .modal-risk{font-size:.8rem;padding:8px 12px;border-radius:8px;margin-bottom:16px}
.modal .modal-risk.green-bg{background:rgba(0,255,136,.06);color:var(--green)}
.modal .modal-risk.yellow-bg{background:rgba(255,193,7,.06);color:var(--yellow)}
.modal .modal-risk.red-bg{background:rgba(255,51,85,.06);color:var(--red)}
.modal .modal-checkbox{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:.85rem;color:var(--text-mid)}
.modal .modal-checkbox input{width:16px;height:16px;accent-color:var(--cyan)}
.modal-actions{display:flex;gap:10px;justify-content:flex-end}
.modal-btn{padding:10px 22px;border:1px solid;border-radius:10px;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .15s;font-family:var(--mono)}
.modal-btn.cancel{background:transparent;color:var(--text-dim);border-color:var(--border-hover)}.modal-btn.cancel:hover{background:rgba(0,240,255,.05);color:var(--text-mid)}
.modal-btn.confirm{background:rgba(0,240,255,.1);color:var(--cyan);border-color:rgba(0,240,255,.25)}.modal-btn.confirm:hover{background:rgba(0,240,255,.18);box-shadow:0 0 20px rgba(0,240,255,.15)}
.modal-btn.confirm:disabled{opacity:.3;cursor:not-allowed}
.modal-btn.danger{background:rgba(255,51,85,.08);color:var(--red);border-color:rgba(255,51,85,.2)}.modal-btn.danger:hover{background:rgba(255,51,85,.15)}
/* 动画 */
.fix-updating{animation:pulse .6s ease}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
/* 版本横幅 */
.version-banner{display:none;background:linear-gradient(135deg,rgba(0,240,255,.1),rgba(167,139,250,.1));border:1px solid rgba(0,240,255,.2);border-radius:10px;padding:12px 20px;margin-bottom:16px;text-align:center;font-size:.85rem;color:var(--cyan);cursor:pointer;transition:all .2s}
.version-banner:hover{background:linear-gradient(135deg,rgba(0,240,255,.15),rgba(167,139,250,.15));box-shadow:0 0 20px rgba(0,240,255,.1)}
/* 分数 delta */
.score-delta{font-family:var(--display);font-size:.9rem;margin-top:8px;letter-spacing:1px}
.score-delta.up{color:var(--green)}
.score-delta.down{color:var(--red)}
.score-delta.same{color:var(--text-dim)}
/* 社区方案 */
.solutions-panel{display:none}
.solutions-panel.visible{display:block}
.solution-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:8px;transition:border-color .2s}
.solution-card:hover{border-color:var(--border-hover)}
.solution-title{font-weight:600;font-size:.88rem;color:var(--text)}
.solution-meta{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}
.solution-tag{background:rgba(0,240,255,.06);border:1px solid rgba(0,240,255,.1);border-radius:4px;padding:2px 8px;font-size:.7rem;color:var(--text-dim);font-family:var(--mono)}
.solution-votes{font-size:.75rem;color:var(--amber)}
.solution-author{font-size:.72rem;color:var(--text-dim)}
.solution-empty{text-align:center;color:var(--text-dim);font-size:.82rem;padding:20px}

/* ====== Hero 封面区域 ====== */
:root{
  --magenta:#ff2d95;
  --purple:#7c3aed;
}
.hero{position:relative;min-height:min(55vh,480px);display:flex;align-items:center;justify-content:center;padding:40px 20px 32px;overflow:hidden;margin:-28px -20px 0;
  background:radial-gradient(ellipse 50% 50% at 50% 45%,rgba(0,240,255,.04) 0%,transparent 70%);
  border-bottom:1px solid rgba(0,240,255,.06)}
.hero-content{position:relative;z-index:2;text-align:center;max-width:640px;width:100%}

/* 矩阵雨背景 */
.hero-rain{position:absolute;inset:0;z-index:0;opacity:.35;pointer-events:none;
  background:
    repeating-linear-gradient(90deg,transparent,transparent 38px,rgba(0,240,255,.025) 38px,rgba(0,240,255,.025) 39px),
    repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(0,240,255,.012) 18px,rgba(0,240,255,.012) 19px);
  animation:rainDrift 8s linear infinite;
  mask-image:radial-gradient(ellipse 60% 60% at 50% 40%,rgba(0,0,0,.6),transparent)}
@keyframes rainDrift{0%{transform:translateY(0)}100%{transform:translateY(19px)}}

/* HUD 角落装饰 */
.hud-corner{position:absolute;width:28px;height:28px;opacity:.5;z-index:3;
  animation:hudPulse 6s ease-in-out infinite}
.hud-corner.tl{top:16px;left:16px;border-top:1px solid var(--cyan);border-left:1px solid var(--cyan);box-shadow:-2px -2px 6px rgba(0,240,255,.15)}
.hud-corner.tr{top:16px;right:16px;border-top:1px solid var(--cyan);border-right:1px solid var(--cyan);box-shadow:2px -2px 6px rgba(0,240,255,.15)}
.hud-corner.bl{bottom:16px;left:16px;border-bottom:1px solid var(--cyan);border-left:1px solid var(--cyan);box-shadow:-2px 2px 6px rgba(0,240,255,.15)}
.hud-corner.br{bottom:16px;right:16px;border-bottom:1px solid var(--cyan);border-right:1px solid var(--cyan);box-shadow:2px 2px 6px rgba(0,240,255,.15)}
@keyframes hudPulse{0%,100%{opacity:.35}50%{opacity:.7}}

/* CRT 扫描线叠加 */
.hero::before{content:'';position:absolute;inset:0;z-index:1;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.008) 2px,rgba(0,240,255,.008) 4px)}

/* Glitch 故障标题 */
.hero-title{font-family:var(--display);font-size:clamp(2.2rem,6vw,3.4rem);font-weight:900;letter-spacing:10px;text-transform:uppercase;position:relative;
  background:linear-gradient(135deg,var(--cyan),#a78bfa,var(--cyan));
  background-size:200% 200%;
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  animation:gradShift 4s ease infinite;margin-bottom:6px}
.hero-title::before,.hero-title::after{content:attr(data-text);position:absolute;top:0;left:0;width:100%;height:100%;
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  background:inherit;background-size:inherit;animation:inherit}
.hero-title::before{text-shadow:-3px 0 rgba(0,240,255,.5);animation:glitch1 3.5s infinite linear}
.hero-title::after{text-shadow:3px 0 rgba(255,45,149,.5);animation:glitch2 2.8s infinite linear}
@keyframes glitch1{
  0%,87%,100%{clip-path:inset(0 0 100% 0);transform:translate(0)}
  88%{clip-path:inset(12% 0 68% 0);transform:translate(-5px,1px)}
  89%{clip-path:inset(45% 0 30% 0);transform:translate(4px,-1px)}
  90%{clip-path:inset(70% 0 10% 0);transform:translate(-3px,2px)}
  91%{clip-path:inset(0 0 100% 0);transform:translate(0)}
}
@keyframes glitch2{
  0%,91%,100%{clip-path:inset(0 0 100% 0);transform:translate(0)}
  92%{clip-path:inset(25% 0 55% 0);transform:translate(5px,-1px)}
  93%{clip-path:inset(55% 0 20% 0);transform:translate(-4px,2px)}
  94%{clip-path:inset(80% 0 5% 0);transform:translate(3px,-1px)}
  95%{clip-path:inset(0 0 100% 0);transform:translate(0)}
}

/* 副标题 */
.hero-subtitle{font-family:var(--mono);font-size:.72rem;letter-spacing:4px;text-transform:uppercase;color:var(--text-dim);margin-bottom:36px}

/* SVG 分数环 */
.hero-score-ring{position:relative;width:200px;height:200px;margin:0 auto 20px}
.score-svg{width:100%;height:100%;transform:rotate(-90deg);filter:drop-shadow(0 0 12px ${gradeColor(score.score)}40)}
.score-ring-bg{fill:none;stroke:rgba(0,240,255,.06);stroke-width:3}
.score-ring-fill{fill:none;stroke:${gradeColor(score.score)};stroke-width:3;stroke-linecap:round;
  stroke-dasharray:553;stroke-dashoffset:553;transition:stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1)}
.score-ring-glow{fill:none;stroke:${gradeColor(score.score)};stroke-width:8;stroke-linecap:round;
  stroke-dasharray:553;stroke-dashoffset:553;transition:stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1);opacity:.15;filter:blur(4px)}
.score-ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.score-number-hero{font-family:var(--display);font-size:4rem;font-weight:900;color:${gradeColor(score.score)};line-height:1;
  text-shadow:0 0 30px ${gradeColor(score.score)}40,0 0 60px ${gradeColor(score.score)}15;
  animation:scoreGlow 3s ease-in-out infinite}
.score-label-hero{font-family:var(--display);font-size:.75rem;letter-spacing:4px;text-transform:uppercase;color:var(--text-mid);margin-top:6px}
@keyframes scoreGlow{0%,100%{text-shadow:0 0 30px ${gradeColor(score.score)}40,0 0 60px ${gradeColor(score.score)}15}50%{text-shadow:0 0 40px ${gradeColor(score.score)}60,0 0 80px ${gradeColor(score.score)}25}}

/* 分类标签 */
.hero-tags{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:8px}
.hero-tag{font-family:var(--mono);font-size:.68rem;background:rgba(0,240,255,.05);border:1px solid rgba(0,240,255,.1);border-radius:4px;padding:3px 10px;color:var(--text-dim)}
.hero-tag em{color:var(--green);font-style:normal;font-weight:600}

/* 分数 delta */
.hero-delta{font-family:var(--display);font-size:.82rem;margin-top:10px;letter-spacing:1px}
.hero-delta.up{color:var(--green)}
.hero-delta.down{color:var(--red)}
.hero-delta.same{color:var(--text-dim)}

/* Hero 底部扫描线 */
.hero-scanline{position:absolute;bottom:0;left:0;right:0;height:2px;z-index:3;
  background:linear-gradient(90deg,transparent,var(--cyan),transparent);
  animation:scanPulse 3s ease-in-out infinite;opacity:.5}
@keyframes scanPulse{0%,100%{opacity:.3}50%{opacity:.7}}

/* Hero 呼吸脉冲 */
.hero::after{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;
  box-shadow:inset 0 0 80px rgba(0,240,255,.02);
  animation:heroBreath 5s ease-in-out infinite}
@keyframes heroBreath{0%,100%{box-shadow:inset 0 0 60px rgba(0,240,255,.02)}50%{box-shadow:inset 0 0 100px rgba(0,240,255,.05),inset 0 0 60px rgba(124,58,237,.02)}}

/* 响应式 */
@media(max-width:640px){
  .hero{min-height:55vh;padding:36px 16px 28px}
  .hero-title{letter-spacing:5px}
  .hero-score-ring{width:160px;height:160px}
  .score-number-hero{font-size:3rem}
  .hud-corner{width:20px;height:20px}
}

/* 无障碍：减少动画 */
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
</style>
</head>
<body>
<div class="container">

  <!-- Hero 封面 -->
  <header class="hero">
    <div class="hero-rain"></div>
    <div class="hud-corner tl"></div>
    <div class="hud-corner tr"></div>
    <div class="hud-corner bl"></div>
    <div class="hud-corner br"></div>
    <div class="hero-content">
      <h1 class="hero-title" data-text="AICOEVO">AICOEVO</h1>
      <p class="hero-subtitle">AI Environment Diagnostic System &mdash; ${new Date().toLocaleString('zh-CN')}</p>
      <div class="hero-score-ring">
        <svg viewBox="0 0 200 200" class="score-svg">
          <circle cx="100" cy="100" r="88" class="score-ring-bg"/>
          <circle cx="100" cy="100" r="88" class="score-ring-glow" id="score-ring-glow"
                  style="stroke-dashoffset:${553 - 553 * score.score / 100}"/>
          <circle cx="100" cy="100" r="88" class="score-ring-fill" id="score-ring-fill"
                  style="stroke-dashoffset:${553 - 553 * score.score / 100}"/>
        </svg>
        <div class="score-ring-inner">
          <div class="score-number-hero">${score.score}</div>
          <div class="score-label-hero">${score.label}</div>
        </div>
      </div>
      ${prevScore !== null ? renderScoreDelta(score.score, prevScore).replace('score-delta', 'hero-delta') : ''}
      <div class="hero-tags">
        ${score.breakdown.map(b => `<span class="hero-tag">${CATEGORY_LABELS[b.category]} <em>${b.passed}/${b.total}</em></span>`).join('')}
      </div>
    </div>
    <div class="hero-scanline"></div>
  </header>

  <!-- 版本更新横幅 -->
  <div id="version-banner" class="version-banner"></div>

  <!-- Tab 导航 -->
  <div class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('diag')">诊断结果</button>
    <button class="tab-btn" onclick="switchTab('install')">AI 工具安装</button>
    <button class="tab-btn" onclick="switchTab('learn')">教学中心</button>
    <button class="tab-btn" onclick="switchTab('resources')">AI 资源</button>
  </div>

  <!-- 诊断结果 Tab -->
  <div id="tab-diag" class="tab-content active">
    <div id="results">
      <button class="scan-btn" onclick="rescan()">重新扫描</button>
      <button class="scan-btn" style="background:linear-gradient(135deg,rgba(0,240,255,.12),rgba(167,139,250,.12));border-color:rgba(167,139,250,.3);color:#c4b5fd" onclick="openCommunity()">查看社区方案</button>
      ${renderFixSection(fixesByTier)}
      ${renderCategoryResults(grouped, score)}
      <div id="solutions-panel" class="solutions-panel">
        <div class="section-title" style="margin-top:20px">社区方案 <span class="badge">来自 aicoevo.net</span></div>
        <div id="solutions-list"></div>
      </div>
    </div>

    <div id="loading">
      <div class="spinner"></div>
      <div class="scan-progress-wrap">
        <div class="scan-progress-bar"><div class="scan-progress-fill" id="scan-progress-fill"></div></div>
        <p class="scan-progress-text" id="scan-progress-text">正在扫描...</p>
      </div>
    </div>
  </div>

  <!-- AI 工具安装 Tab -->
  <div id="tab-install" class="tab-content">
    ${renderInstallTab()}
  </div>

  <!-- 教学中心 Tab -->
  <div id="tab-learn" class="tab-content">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card" style="text-align:center;padding:40px 20px">
        <div style="font-family:var(--display);font-size:1.3rem;font-weight:700;letter-spacing:2px;color:var(--green);margin-bottom:8px;text-shadow:0 0 20px rgba(0,255,136,.3)">Claude Code 教学</div>
        <div style="color:var(--text-mid);font-size:.88rem;margin-bottom:24px">大古出品，从入门到精通的 AI 编程实战指南</div>
        <a href="https://claudecode.tumuai.net/" target="_blank" rel="noopener" style="display:inline-block;padding:14px 36px;border:1px solid rgba(0,255,136,.25);border-radius:12px;font-family:var(--mono);font-size:.9rem;font-weight:600;letter-spacing:1px;color:var(--green);background:rgba(0,255,136,.06);text-decoration:none;transition:all .2s;box-shadow:0 0 20px rgba(0,255,136,.08)" onmouseover="this.style.background='rgba(0,255,136,.12)';this.style.boxShadow='0 0 30px rgba(0,255,136,.15)';this.style.transform='translateY(-2px)'" onmouseout="this.style.background='rgba(0,255,136,.06)';this.style.boxShadow='0 0 20px rgba(0,255,136,.08)';this.style.transform='translateY(0)'">开始学习 &rarr;</a>
      </div>
      <div class="card" style="text-align:center;padding:40px 20px">
        <div style="font-family:var(--display);font-size:1.3rem;font-weight:700;letter-spacing:2px;color:#ff6b6b;margin-bottom:8px;text-shadow:0 0 20px rgba(255,107,107,.3)">🦞 OpenClaw 教学</div>
        <div style="color:var(--text-mid);font-size:.88rem;margin-bottom:24px">大古出品，从零开始手把手教你用 AI 助手</div>
        <a href="https://openclaw.tumuai.net/" target="_blank" rel="noopener" style="display:inline-block;padding:14px 36px;border:1px solid rgba(255,107,107,.25);border-radius:12px;font-family:var(--mono);font-size:.9rem;font-weight:600;letter-spacing:1px;color:#ff6b6b;background:rgba(255,107,107,.06);text-decoration:none;transition:all .2s;box-shadow:0 0 20px rgba(255,107,107,.08)" onmouseover="this.style.background='rgba(255,107,107,.12)';this.style.boxShadow='0 0 30px rgba(255,107,107,.15)';this.style.transform='translateY(-2px)'" onmouseout="this.style.background='rgba(255,107,107,.06)';this.style.boxShadow='0 0 20px rgba(255,107,107,.08)';this.style.transform='translateY(0)'">开始学习 &rarr;</a>
      </div>
    </div>
    <div class="card">
      <div style="font-family:var(--display);font-size:.85rem;font-weight:700;letter-spacing:2px;color:var(--cyan);margin-bottom:14px">学习资源</div>
      <div style="display:grid;gap:12px">
        <a href="https://claudecode.tumuai.net/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#128218;</span>
          <div><div class="learn-link-title">大古的 Claude Code 教程</div><div class="learn-link-desc">大古倾心制作的中文教学，涵盖安装、配置、实战技巧</div></div>
        </a>
        <a href="https://openclaw.tumuai.net/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#129432;</span>
          <div><div class="learn-link-title">大古的 OpenClaw 教程</div><div class="learn-link-desc">最懂小白的 OpenClaw 中文教程，从安装到接入飞书全覆盖</div></div>
        </a>
      </div>
    </div>
  </div>

  <!-- AI 资源导航 Tab -->
  <div id="tab-resources" class="tab-content">
    <div class="card" style="text-align:center;padding:36px 20px">
      <div style="font-family:var(--display);font-size:1.2rem;font-weight:700;letter-spacing:2px;color:var(--amber);margin-bottom:8px;text-shadow:0 0 20px rgba(255,107,53,.3)">AI 资源导航</div>
      <div style="color:var(--text-mid);font-size:.85rem">Coding Plan 编程套餐购买直达，按次数计费更划算</div>
    </div>

    <!-- Coding Plan 编程套餐（按次数计费，推荐） -->
    <div class="card">
      <div style="font-family:var(--display);font-size:.85rem;font-weight:700;letter-spacing:2px;color:var(--cyan);margin-bottom:6px">Coding Plan 编程套餐</div>
      <div style="color:var(--green);font-size:.75rem;margin-bottom:14px;padding:6px 10px;background:rgba(16,185,129,.08);border-radius:6px;border-left:3px solid var(--green)">
        <strong>推荐!</strong> Coding Plan 按次数计费，写再多代码也不会超支。别买 API（按 Token 计费），AI 写代码一次对话就烧几千 Token，分分钟欠费。
      </div>
      <div style="display:grid;gap:10px">
        <a href="https://www.bigmodel.cn/glm-coding" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#129504;</span>
          <div><div class="learn-link-title">智谱 GLM Coding Plan</div><div class="learn-link-desc">GLM-5.1 编程模型，¥20起/月，按次数计费</div></div>
        </a>
        <a href="https://www.aliyun.com/benefit/scene/codingplan" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127811;</span>
          <div><div class="learn-link-title">阿里云百炼 Coding Plan</div><div class="learn-link-desc">通义千问+Kimi+GLM 多模型，首月¥7.9，¥40起/月</div></div>
        </a>
        <a href="https://www.volcengine.com/docs/82379/1925114" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127755;</span>
          <div><div class="learn-link-title">火山方舟 Coding Plan (字节)</div><div class="learn-link-desc">豆包+GLM+DeepSeek+Kimi，¥9.9起/月</div></div>
        </a>
        <a href="https://www.kimi.com/code" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127769;</span>
          <div><div class="learn-link-title">Kimi Coding Plan (月之暗面)</div><div class="learn-link-desc">Kimi K2.5 编程模型，会员权益含编程额度</div></div>
        </a>
        <a href="https://platform.minimaxi.com/docs/token-plan/promotion" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127880;</span>
          <div><div class="learn-link-title">MiniMax Token Plan</div><div class="learn-link-desc">MiniMax-M2.5 全模态订阅，编程+生图+语音</div></div>
        </a>
        <a href="https://cloud.tencent.com/act/pro/codingplan" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#9729;</span>
          <div><div class="learn-link-title">腾讯云 Coding Plan</div><div class="learn-link-desc">混元+GLM-5+Kimi，首月¥7.9，次月5折</div></div>
        </a>
        <a href="https://cloud.infini-ai.com/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#128640;</span>
          <div><div class="learn-link-title">无问芯穹 Infini Coding Plan</div><div class="learn-link-desc">聚合多家顶尖编程模型，¥40起/月</div></div>
        </a>
        <a href="https://cloud.baidu.com/product/codingplan.html" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#128064;</span>
          <div><div class="learn-link-title">百度千帆 Coding Plan</div><div class="learn-link-desc">文心+多模型编程，首月¥40起，每日限量</div></div>
        </a>
      </div>
    </div>

    <!-- AI API 平台（按 Token 计费） -->
    <div class="card">
      <div style="font-family:var(--display);font-size:.85rem;font-weight:700;letter-spacing:2px;color:#a78bfa;margin-bottom:6px">AI API 平台</div>
      <div style="color:var(--amber);font-size:.75rem;margin-bottom:14px;padding:6px 10px;background:rgba(255,107,53,.08);border-radius:6px;border-left:3px solid var(--amber)">
        <strong>注意!</strong> 以下平台按 Token 计费，写代码消耗大量 Token，费用不可控。建议优先购买上方的 Coding Plan。
      </div>
      <div style="display:grid;gap:10px">
        <a href="https://open.bigmodel.cn/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#129504;</span>
          <div><div class="learn-link-title">智谱 BigModel 开放平台</div><div class="learn-link-desc">GLM 系列模型 API，按 Token 计费</div></div>
        </a>
        <a href="https://platform.deepseek.com/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#128300;</span>
          <div><div class="learn-link-title">DeepSeek 开放平台</div><div class="learn-link-desc">DeepSeek R1/V3 API，按 Token 计费，夜间半价</div></div>
        </a>
        <a href="https://platform.kimi.com/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127769;</span>
          <div><div class="learn-link-title">Kimi API 开放平台</div><div class="learn-link-desc">Kimi K2 系列模型 API</div></div>
        </a>
        <a href="https://cloud.baidu.com/product-price/nlp.html" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#128064;</span>
          <div><div class="learn-link-title">百度智能云 文心大模型</div><div class="learn-link-desc">ERNIE 5.0 / 文心快码 Comate</div></div>
        </a>
        <a href="https://www.modelscope.cn/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127880;</span>
          <div><div class="learn-link-title">魔搭 ModelScope (阿里)</div><div class="learn-link-desc">国产 AI 模型社区，开源模型 + 数据集</div></div>
        </a>
        <a href="https://openrouter.ai/pricing" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127760;</span>
          <div><div class="learn-link-title">OpenRouter</div><div class="learn-link-desc">聚合 300+ 模型 API，Claude/GPT/Gemini 一站式</div></div>
        </a>
      </div>
    </div>

    <!-- 实用工具 -->
    <div class="card">
      <div style="font-family:var(--display);font-size:.85rem;font-weight:700;letter-spacing:2px;color:var(--green);margin-bottom:14px">实用工具 & 加速</div>
      <div style="display:grid;gap:10px">
        <a href="https://registry.npmmirror.com/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#128230;</span>
          <div><div class="learn-link-title">npmmirror 镜像</div><div class="learn-link-desc">淘宝 NPM 镜像，npm 国内加速必备</div></div>
        </a>
        <a href="https://mirrors.tuna.tsinghua.edu.cn/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#127967;</span>
          <div><div class="learn-link-title">清华开源镜像站</div><div class="learn-link-desc">TUNA 镜像，PyPI/npm/apt 全覆盖</div></div>
        </a>
        <a href="https://ghfast.top/" target="_blank" rel="noopener" class="learn-link">
          <span class="learn-link-icon">&#9889;</span>
          <div><div class="learn-link-title">ghfast.top</div><div class="learn-link-desc">GitHub 下载加速，国内访问 GitHub 资源利器</div></div>
        </a>
      </div>
    </div>
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
window.__scanPayload = {
  results: ${JSON.stringify(results.map(r => ({
    id:r.id, name:r.name, category:r.category, status:r.status,
    message:r.message, detail:r.detail||null,
    version:r.version||null, path:r.path||null, fixCommand:r.fixCommand||null,
    severity:r.severity||null,
  })))},
  score: ${score.score},
  label: ${JSON.stringify(score.label)},
  system: ${JSON.stringify((function(){
    var si=null;
    try{ si=require('../scanners/system-info').collectSystemInfo(); }catch(e){}
    return si||{};
  })())},
  pathEntries: ${JSON.stringify((function(){
    try{ return (process.env.PATH || '').split(';').filter(Boolean); }catch(e){ return []; }
  })())},
  envKeys: ${JSON.stringify((function(){
    var keys=['PYTHONPATH','NODE_PATH','CUDA_PATH','JAVA_HOME','GOPATH','CONDA_PREFIX','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'];
    var env: Record<string,string>={};
    keys.forEach(function(k){ var v=process.env[k]; if(v) env[k]=v; });
    return env;
  })())},
  timestamp: ${JSON.stringify(new Date().toISOString())},
};
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
  const results = document.getElementById('results');
  const btn = document.querySelector('.scan-btn');
  if (btn) btn.disabled = true;

  // 清空结果区域，插入进度条
  const CATEGORY_LABELS = ${JSON.stringify(CATEGORY_LABELS)};
  const STATUS_CONFIG = ${JSON.stringify(STATUS_CONFIG)};
  results.innerHTML = '<div id="scan-live-progress" style="text-align:center;padding:24px 0 16px">'
    + '<div style="font-family:var(--mono);font-size:.85rem;color:var(--text-mid);margin-bottom:12px">正在扫描...</div>'
    + '<div style="max-width:480px;margin:0 auto;height:6px;background:rgba(0,240,255,.08);border-radius:3px;overflow:hidden">'
    + '<div id="scan-live-fill" style="height:100%;width:0%;background:linear-gradient(90deg,var(--cyan),#7c3aed);border-radius:3px;transition:width .3s ease"></div></div>'
    + '<div id="scan-live-text" style="font-family:var(--mono);font-size:.78rem;color:var(--text-dim);margin-top:8px"></div>'
    + '</div>'
    + '<div id="scan-live-items" style="display:grid;gap:12px"></div>';

  results.style.display = 'block';

  try {
    const res = await fetch('/api/scan', {method:'POST'});
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream:true});

      // SSE 以双换行分割消息
      const messages = buffer.split('\\n\\n');
      buffer = messages.pop() || '';

      for (const msg of messages) {
        let eventType = '';
        let eventData = '';
        for (const line of msg.split('\\n')) {
          if (line.startsWith('event: ')) eventType = line.slice(7);
          else if (line.startsWith('data: ')) eventData = line.slice(6);
        }
        if (!eventData) continue;

        try {
          const data = JSON.parse(eventData);

          // 更新进度条
          if (eventType === 'progress' && data.completed !== undefined) {
            const pct = Math.round((data.completed / data.total) * 100);
            const fill = document.getElementById('scan-live-fill');
            const text = document.getElementById('scan-live-text');
            if (fill) fill.style.width = pct + '%';
            if (text) text.textContent = data.completed + '/' + data.total + ' — ' + data.current;
          }

          // 逐个渲染扫描结果
          if (eventType === 'result' && data.id) {
            const sc = STATUS_CONFIG[data.status] || STATUS_CONFIG.unknown;
            const container = document.getElementById('scan-live-items');
            if (!container) continue;

            var card = document.createElement('div');
            card.style.cssText = 'background:rgba(15,23,42,.6);border:1px solid rgba(0,240,255,.1);border-radius:10px;padding:14px 18px;display:flex;align-items:flex-start;gap:12px;animation:fadeSlideIn .3s ease';

            var iconDiv = document.createElement('div');
            iconDiv.style.cssText = 'width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0';
            iconDiv.style.background = sc.bg;
            iconDiv.style.color = sc.color;
            iconDiv.textContent = sc.icon;

            var bodyDiv = document.createElement('div');
            bodyDiv.style.cssText = 'flex:1;min-width:0';

            var nameEl = document.createElement('div');
            nameEl.style.cssText = 'font-family:var(--mono);font-size:.82rem;font-weight:600;color:var(--text)';
            nameEl.textContent = data.name;

            var msgEl = document.createElement('div');
            msgEl.style.cssText = 'font-family:var(--mono);font-size:.78rem;margin-top:2px';
            msgEl.style.color = sc.color;
            msgEl.textContent = data.message;

            bodyDiv.appendChild(nameEl);
            bodyDiv.appendChild(msgEl);

            if (data.detail) {
              var detailEl = document.createElement('div');
              detailEl.style.cssText = 'font-family:var(--mono);font-size:.72rem;color:var(--text-dim);margin-top:4px;white-space:pre-wrap;max-height:60px;overflow:hidden';
              detailEl.textContent = data.detail.split('\\n').slice(0,3).join('\\n');
              bodyDiv.appendChild(detailEl);
            }

            card.appendChild(iconDiv);
            card.appendChild(bodyDiv);
            container.appendChild(card);

            // 自动滚动到底部
            card.scrollIntoView({behavior:'smooth',block:'end'});
          }

          // 扫描完成，刷新完整页面
          if (eventType === 'done') {
            setTimeout(() => location.reload(), 600);
            return;
          }
        } catch {}
      }
    }
    setTimeout(() => location.reload(), 1000);
  } catch(e) { location.reload(); }
}
// Hero SVG 分数环入场动画
(function(){
  var ring=document.getElementById('score-ring-fill');
  var glow=document.getElementById('score-ring-glow');
  if(ring){
    var target=ring.style.strokeDashoffset;
    ring.style.strokeDashoffset='553';
    if(glow) glow.style.strokeDashoffset='553';
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        ring.style.strokeDashoffset=target;
        if(glow) glow.style.strokeDashoffset=target;
      });
    });
  }
})();
</script>
</body>
</html>`;
}

function renderScoreCard(score: ScoreResult, prevScore: number | null): string {
  return `
  <div class="card score-card" id="score-card">
    <div class="score-number">${score.score}</div>
    <div class="score-label">${score.label}</div>
    ${prevScore !== null ? renderScoreDelta(score.score, prevScore) : ''}
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

function renderScoreDelta(current: number, prev: number): string {
  const delta = current - prev;
  if (delta === 0) return `<div class="score-delta same">与上次持平 (${prev} 分)</div>`;
  const cls = delta > 0 ? 'up' : 'down';
  const arrow = delta > 0 ? '↑' : '↓';
  return `<div class="score-delta ${cls}">${delta > 0 ? '+' : ''}${delta} 分 ${arrow}（上次 ${prev} 分）</div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- 版本检查 ---
(async function checkVersion() {
  try {
    const res = await fetch('/api/version-check');
    const {current, latest} = await res.json();
    if (latest && latest !== current) {
      const banner = document.getElementById('version-banner');
      if (banner) {
        banner.textContent = '发现新版本 v' + latest + ' → 点击查看更新说明';
        banner.style.display = 'block';
        banner.onclick = () => window.open('https://github.com/gugug168/WinAICheck/releases', '_blank');
      }
    }
  } catch {}
})();

// --- 社区方案拉取 ---
(async function fetchSolutions() {
  try {
    const payload = window.__scanPayload;
    if (!payload || !payload.results) return;
    const failCats = [...new Set(
      payload.results
        .filter(r => r.status === 'fail' || r.status === 'warn')
        .map(r => r.category)
    )];
    if (failCats.length === 0) return;

    const res = await fetch('/api/solutions?categories=' + failCats.join(','));
    const data = await res.json();
    const solutions = data.solutions || data.items || data || [];
    if (!Array.isArray(solutions) || solutions.length === 0) return;

    const panel = document.getElementById('solutions-panel');
    const list = document.getElementById('solutions-list');
    if (!panel || !list) return;

    list.innerHTML = (solutions as CommunitySolution[]).map((s) => {
      const tags = (s.tags || []).map((t) => '<span class="solution-tag">' + escHtml(t) + '</span>').join('');
      return '<div class="solution-card">'
        + '<div class="solution-title">' + escHtml(s.title) + '</div>'
        + '<div class="solution-meta">'
        + tags
        + (s.votes !== undefined ? '<span class="solution-votes">▲ ' + s.votes + '</span>' : '')
        + (s.author_name ? '<span class="solution-author">' + escHtml(s.author_name) + '</span>' : '')
        + '</div></div>';
    }).join('');
    panel.classList.add('visible');
  } catch {}
})();

function escHtml(s: string) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function openCommunity() {
  const btn = document.querySelector<HTMLButtonElement>('[onclick="openCommunity()"]');
  if (btn) { btn.textContent = '上传中...'; btn.disabled = true; }

  try {
    const res = await fetch('/api/stash', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        data: JSON.stringify(window.__scanPayload || {}),
        fingerprint: JSON.stringify({
          platform: navigator.platform,
          userAgent: navigator.userAgent,
          // 新增：系统摘要供经验匹配用
          system: window.__scanPayload?.system || {},
          pathEntries: window.__scanPayload?.pathEntries || [],
          envKeys: window.__scanPayload?.envKeys || {},
          score: window.__scanPayload?.score || 0,
          failCount: (window.__scanPayload?.results || []).filter((r: any) => r.status === 'fail').length,
          failCategories: [...new Set((window.__scanPayload?.results || []).filter((r: any) => r.status === 'fail').map((r: any) => r.category))],
        }),
      }),
    });

    if (!res.ok) throw new Error('上传失败: ' + res.status);
    const {token} = await res.json();
    window.open('https://aicoevo.net/claim?t=' + token, '_blank');
  } catch(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    alert('连接社区失败，请检查网络\\n' + message);
    if (btn) { btn.textContent = '查看社区方案'; btn.disabled = false; }
  }
}
