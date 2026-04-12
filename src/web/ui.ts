import { calculateScore } from '../scoring/calculator';
import { getFixSuggestions } from '../fixers/index';
import { getInstallers } from '../installers/index';
import type { ScanResult, ScoreResult, FixSuggestion, ScannerCategory } from '../scanners/types';
import type { FixResult } from '../scanners/types';
import { buildCommunityClaimUrl } from './community-config';

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

const FIX_ACTION_SECTIONS = [
  { tier: 'green', title: '立即处理', buttonLabel: '立即执行', desc: '风险低、收益高，优先消除直接阻塞。' },
  { tier: 'yellow', title: '建议处理', buttonLabel: '确认执行', desc: '建议尽快处理，避免后续工具链漂移。' },
  { tier: 'red', title: '手动处理', buttonLabel: '查看指引', desc: '需要你手动确认环境或系统设置。' },
  { tier: 'black', title: '可选优化', buttonLabel: '查看建议', desc: '不会立刻阻塞，但能提升稳定性。' },
] as const;

type CommunityPayload = {
  results?: Array<{ status: string; category: string }>;
  score?: number | ScoreResult;
  system?: Record<string, unknown>;
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
    __prevScore?: number | null;
    __resultFilter?: string;
    __autoStartScan?: boolean;
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

function getPriorityIssues(results: ScanResult[]): ScanResult[] {
  const statusRank: Record<string, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };
  return results
    .filter(r => r.status === 'fail' || r.status === 'warn')
    .sort((a, b) => {
      const byStatus = statusRank[a.status] - statusRank[b.status];
      if (byStatus !== 0) return byStatus;
      return a.name.localeCompare(b.name, 'zh-CN');
    })
    .slice(0, 4);
}

function getOutcomeSummary(score: ScoreResult, results: ScanResult[]): {
  title: string;
  subtitle: string;
  nextStep: string;
  tone: 'good' | 'medium' | 'bad';
} {
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;

  if (failCount === 0 && score.score >= 90) {
    return {
      title: '环境已就绪，可直接开始使用',
      subtitle: `当前无阻塞项，${warnCount > 0 ? `还有 ${warnCount} 个建议优化项` : '关键链路已通过'}。`,
      nextStep: '建议直接开始使用你的 AI 开发工具，后续按需做可选优化。',
      tone: 'good',
    };
  }

  if (failCount <= 1 && score.score >= 70) {
    return {
      title: '环境基本可用，先处理少量阻塞项',
      subtitle: `检测到 ${failCount} 个失败项、${warnCount} 个警告项，主流程已经接近可用。`,
      nextStep: '优先修掉“立即处理”中的问题，再重新扫描确认。',
      tone: 'medium',
    };
  }

  return {
    title: '当前环境不建议直接开工',
    subtitle: `仍有 ${failCount} 个失败项、${warnCount} 个警告项，会影响安装、扫描或 AI 工作流稳定性。`,
    nextStep: '先处理 Top 问题和“立即处理”项，再进入安装或配置阶段。',
    tone: 'bad',
  };
}

function getWorkflowState(results: ScanResult[]): {
  stage: 'diagnose' | 'fix' | 'verify';
  summary: string;
} {
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;

  if (failCount > 0) {
    return {
      stage: 'fix',
      summary: `当前还有 ${failCount} 个阻塞项，建议先处理失败项，再继续安装和配置。`,
    };
  }

  if (warnCount > 0) {
    return {
      stage: 'verify',
      summary: `阻塞项已清掉，剩余 ${warnCount} 个警告项，建议复检后再进入长期使用。`,
    };
  }

  return {
    stage: 'verify',
    summary: '主要链路已通过，可以开始使用；后续按需复检即可。',
  };
}

/**
 * 生成完整的 Web UI HTML 页面
 */
export function generateWebUI(
  results: ScanResult[],
  score: ScoreResult,
  prevScore: number | null = null,
  autoStartScan = false,
): string {
  const fixes = getFixSuggestions(results);
  const fixesByTier = {
    green: fixes.filter(f => f.tier === 'green'),
    yellow: fixes.filter(f => f.tier === 'yellow'),
    red: fixes.filter(f => f.tier === 'red'),
    black: fixes.filter(f => f.tier === 'black'),
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>aicoevo - AI 环境诊断</title>
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
  --mono:'Cascadia Mono','Cascadia Code','Consolas',monospace;
  --display:'Bahnschrift','Segoe UI Variable Display','Segoe UI',sans-serif;
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
.result-item.is-hidden{display:none}
.result-name{font-weight:500;font-size:.88rem;letter-spacing:.3px}
.result-msg{font-size:.82rem;color:var(--text-mid);margin-top:2px}
.result-detail{font-size:.75rem;color:var(--text-dim);margin-top:6px;white-space:pre-wrap;background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-family:var(--mono)}
.result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.result-meta{display:flex;gap:6px;flex-wrap:wrap}
.result-chip{padding:2px 8px;border-radius:999px;font-size:.68rem;font-family:var(--mono);border:1px solid rgba(0,240,255,.12);color:var(--text-dim);background:rgba(0,240,255,.05)}
.result-chip.fixable{border-color:rgba(34,197,94,.25);color:var(--green);background:rgba(34,197,94,.08)}
.result-chip.status-fail{border-color:rgba(239,68,68,.25);color:var(--red);background:rgba(239,68,68,.08)}
.result-chip.status-warn{border-color:rgba(234,179,8,.25);color:var(--yellow);background:rgba(234,179,8,.08)}
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
.fix-result.warn{background:rgba(255,193,7,.08);color:var(--yellow)}
.fix-btn.red{background:rgba(255,51,85,.08);color:var(--red);border-color:rgba(255,51,85,.2)}.fix-btn.red:hover{background:rgba(255,51,85,.15);box-shadow:0 0 20px rgba(255,51,85,.15)}
.fix-section-block{margin-bottom:18px}
.fix-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px}
.fix-section-title{font-size:.88rem;font-weight:700}
.fix-section-desc{font-size:.76rem;color:var(--text-dim);margin-top:2px}
/* 分类进度条 */
.category-bar{height:3px;border-radius:2px;background:rgba(0,240,255,.08);overflow:hidden;margin-top:8px}
.category-fill{height:100%;border-radius:2px;transition:width .6s ease;box-shadow:0 0 8px currentColor}
.category-card.is-hidden{display:none}
/* 底部 */
.footer{text-align:center;color:var(--text-dim);font-size:.72rem;margin-top:32px;padding:20px 0;letter-spacing:2px;font-family:var(--mono)}
.footer::before{content:'';display:block;width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--cyan-dim),transparent);margin:0 auto 12px}
/* 扫描按钮 */
.scan-btn{background:linear-gradient(135deg,var(--cyan),#7c3aed);color:#fff;border:none;padding:10px 28px;border-radius:10px;font-size:.85rem;font-weight:600;cursor:pointer;margin:0 auto 20px;display:block;font-family:var(--mono);letter-spacing:1px;transition:all .2s;box-shadow:0 0 20px rgba(0,240,255,.15)}
.scan-btn:hover{transform:translateY(-1px);box-shadow:0 0 30px rgba(0,240,255,.25)}
.scan-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.scan-btn.secondary{background:linear-gradient(135deg,rgba(0,240,255,.12),rgba(167,139,250,.12));border:1px solid rgba(167,139,250,.3);color:#c4b5fd;box-shadow:none}
.diag-actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:0 0 18px}
.diag-actions .scan-btn{margin:0}
.diag-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;margin-bottom:16px}
.outcome-card{position:relative;overflow:hidden}
.outcome-card::before{content:'';position:absolute;inset:auto -20% 0 auto;width:180px;height:180px;border-radius:50%;filter:blur(40px);opacity:.18}
.outcome-card.good::before{background:rgba(34,197,94,.35)}
.outcome-card.medium::before{background:rgba(234,179,8,.35)}
.outcome-card.bad::before{background:rgba(239,68,68,.35)}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px}
.outcome-title{font-family:var(--display);font-size:1.05rem;letter-spacing:1px;margin-bottom:10px}
.outcome-copy{font-size:.86rem;color:var(--text-mid);line-height:1.65}
.outcome-next{margin-top:12px;padding-top:12px;border-top:1px solid rgba(0,240,255,.08);font-size:.78rem;color:var(--text)}
.summary-badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.summary-badge{padding:6px 10px;border-radius:999px;font-size:.72rem;font-family:var(--mono);border:1px solid var(--border);background:rgba(0,240,255,.05);color:var(--text-mid)}
.summary-badge strong{color:var(--text)}
.priority-list{display:grid;gap:10px}
.priority-item{padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(7,11,24,.55)}
.priority-item-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.priority-item-title{font-size:.84rem;font-weight:600}
.priority-item-copy{font-size:.76rem;color:var(--text-mid);line-height:1.6}
.priority-index{font-family:var(--display);font-size:.82rem;color:var(--cyan)}
.toolbar-card{margin-bottom:16px}
.toolbar-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center}
.filter-group{display:flex;flex-wrap:wrap;gap:8px}
.filter-chip-btn{padding:8px 12px;border-radius:999px;border:1px solid var(--border);background:rgba(0,240,255,.04);color:var(--text-mid);font-size:.74rem;font-family:var(--mono);cursor:pointer;transition:all .18s}
.filter-chip-btn:hover{border-color:var(--border-hover);color:var(--text)}
.filter-chip-btn.active{border-color:rgba(0,240,255,.24);background:rgba(0,240,255,.1);color:var(--cyan)}
.search-wrap{display:flex;align-items:center;gap:10px}
.search-input{min-width:220px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:rgba(6,11,24,.7);color:var(--text);font-size:.78rem;font-family:var(--mono);outline:none}
.search-input:focus{border-color:rgba(0,240,255,.28);box-shadow:0 0 0 4px rgba(0,240,255,.06)}
.filter-stats{font-size:.74rem;color:var(--text-dim);font-family:var(--mono)}
.result-empty{display:none;text-align:center;padding:26px 10px;color:var(--text-dim);font-size:.82rem}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.flow-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.flow-card{position:relative;padding:14px 14px 14px 44px;border-radius:12px;border:1px solid var(--border);background:rgba(7,11,24,.52)}
.flow-card::before{content:attr(data-step);position:absolute;left:14px;top:14px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.7rem;background:rgba(0,240,255,.08);color:var(--text-mid)}
.flow-card.active{border-color:rgba(0,240,255,.24);background:linear-gradient(135deg,rgba(0,240,255,.08),rgba(124,58,237,.05))}
.flow-title{font-size:.8rem;font-weight:700;color:var(--text);margin-bottom:4px}
.flow-copy{font-size:.74rem;color:var(--text-dim);line-height:1.55}
.support-hub{margin-top:18px;border-color:rgba(255,255,255,.06)}
.support-hub .section-title{color:#7dd3fc}
.support-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.support-link{display:block;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);text-decoration:none;color:var(--text);transition:all .18s}
.support-link:hover{border-color:rgba(0,240,255,.18);background:rgba(0,240,255,.04);transform:translateY(-1px)}
.support-link-title{font-size:.82rem;font-weight:700;margin-bottom:6px}
.support-link-copy{font-size:.74rem;color:var(--text-dim);line-height:1.55}
/* 反馈表单 */
.feedback-card{margin-top:18px;border-color:rgba(0,240,255,.12)}
.feedback-card .badge{background:rgba(0,240,255,.12);color:var(--cyan);font-size:.65rem;padding:2px 8px;border-radius:4px;margin-left:6px}
.feedback-form{display:flex;flex-direction:column;gap:10px}
.feedback-select,.feedback-input,.feedback-textarea{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--text);font-family:var(--mono);font-size:.82rem;padding:10px 12px;outline:none;transition:border-color .2s}
.feedback-select:focus,.feedback-input:focus,.feedback-textarea:focus{border-color:var(--cyan)}
.feedback-textarea{resize:vertical;min-height:70px}
.feedback-row{display:flex;gap:10px;flex-wrap:wrap}
.feedback-input{flex:1;min-width:180px}
.feedback-status{font-size:.78rem;min-height:18px;margin-top:2px}
/* Agent 进化 */
.agent-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.agent-stat{padding:14px;border-radius:12px;border:1px solid var(--border);background:rgba(7,11,24,.55)}
.agent-stat-value{font-family:var(--display);font-size:1.45rem;font-weight:800;color:var(--cyan)}
.agent-stat-label{font-size:.72rem;color:var(--text-dim);font-family:var(--mono);margin-top:4px}
.agent-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.agent-list{display:grid;gap:10px}
.agent-event{padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(0,0,0,.18)}
.agent-event-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.agent-event-title{font-size:.82rem;font-weight:700;color:var(--text)}
.agent-event-meta{font-size:.68rem;color:var(--text-dim);font-family:var(--mono)}
.agent-event-msg{font-size:.76rem;color:var(--text-mid);line-height:1.55;white-space:pre-wrap}
.agent-status-line{font-size:.78rem;color:var(--text-mid);line-height:1.7}
.agent-status-line strong{color:var(--text)}
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
.tab-nav{display:flex;gap:16px;margin-bottom:32px;padding:8px;align-items:flex-end;flex-wrap:wrap}
.tab-btn{font-family:var(--display);font-size:1.15rem;font-weight:700;padding:14px 40px;border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:all .35s cubic-bezier(.4,0,.2,1);position:relative;letter-spacing:2px;text-transform:uppercase;
  background:rgba(8,12,24,.6);color:var(--text-dim);backdrop-filter:blur(8px);overflow:hidden}
.tab-btn::after{content:'';position:absolute;bottom:0;left:50%;width:0;height:2px;background:var(--cyan);transition:all .35s;transform:translateX(-50%);border-radius:1px}
.tab-btn:hover{border-color:rgba(0,240,255,.15);color:var(--text-mid);background:rgba(8,12,24,.8)}
.tab-btn:hover::after{width:40%}
.tab-btn.active{transform:translateY(-2px);color:var(--cyan)}
.tab-btn.active::after{width:80%;box-shadow:0 0 12px var(--cyan-glow)}
.tab-btn.secondary-tab{font-size:.84rem;padding:10px 18px;border-radius:999px;letter-spacing:1px;background:rgba(8,12,24,.35);align-self:center}
.tab-btn.secondary-tab.active{transform:none}
.tab-note{margin-left:auto;font-size:.72rem;color:var(--text-dim);font-family:var(--mono);letter-spacing:1px}
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
/* 持续优化Tab - 品红霓虹 */
.tab-btn.active[onclick*="agent"]{
  background:rgba(236,72,153,.05);border-color:rgba(236,72,153,.25);
  box-shadow:0 0 30px rgba(236,72,153,.12),0 0 60px rgba(236,72,153,.06),inset 0 0 20px rgba(236,72,153,.04);
  color:#f9a8d4;
  text-shadow:0 0 8px rgba(236,72,153,.6),0 0 20px rgba(236,72,153,.3)}
.tab-btn.active[onclick*="agent"]::after{background:#ec4899;box-shadow:0 0 15px rgba(236,72,153,.35),0 0 30px rgba(236,72,153,.2)}
.tab-btn.active[onclick*="agent"]::before{content:'';position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(135deg,rgba(236,72,153,.03),transparent 50%,rgba(236,72,153,.02));pointer-events:none}
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
/* ====== 修复执行中遮罩 ====== */
.fix-executing-overlay{position:fixed;inset:0;background:rgba(5,8,16,.85);backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:200;opacity:0;pointer-events:none;transition:opacity .2s}
.fix-executing-overlay.active{opacity:1;pointer-events:auto}
.fix-exe-spinner{width:48px;height:48px;border:3px solid rgba(0,240,255,.15);border-top-color:var(--cyan);border-radius:50%;animation:spin .8s linear infinite;margin-bottom:16px}
@keyframes spin{to{transform:rotate(360deg)}}
.fix-exe-text{font-family:var(--display);font-size:1.1rem;color:var(--cyan);letter-spacing:2px;text-shadow:0 0 20px rgba(0,240,255,.4)}

/* ====== 修复结果通知 ====== */
.fix-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(120px);padding:14px 24px;border-radius:12px;font-size:.9rem;font-weight:600;z-index:300;transition:transform .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 8px 32px rgba(0,0,0,.5)}
.fix-toast.show{transform:translateX(-50%) translateY(0)}
.fix-toast.success{background:rgba(0,255,136,.12);border:1px solid rgba(0,255,136,.3);color:var(--green)}
.fix-toast.warn{background:rgba(255,193,7,.12);border:1px solid rgba(255,193,7,.3);color:var(--yellow)}
.fix-toast.fail{background:rgba(255,51,85,.12);border:1px solid rgba(255,51,85,.3);color:var(--red)}
.fix-toast.info{background:rgba(0,240,255,.12);border:1px solid rgba(0,240,255,.3);color:var(--cyan)}

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
.hero{position:relative;height:min(55vh,520px);display:flex;align-items:center;justify-content:center;padding:40px 20px 32px;overflow:hidden;margin:-28px -20px 0;
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
  .container{padding:20px 14px}
  .diag-grid,.two-col,.flow-strip,.support-grid,.agent-grid{grid-template-columns:1fr}
  .tab-nav{gap:10px;padding:0;flex-wrap:wrap}
  .tab-btn{flex:1 1 calc(50% - 8px);padding:12px 16px;font-size:.92rem}
  .tab-btn.secondary-tab{flex:1 1 calc(50% - 8px);border-radius:12px}
  .tab-note{width:100%;margin-left:0}
  .toolbar-row{align-items:stretch}
  .search-wrap,.search-input{width:100%}
  .search-input{min-width:0}
  .fix-item{flex-direction:column;align-items:flex-start}
  .fix-btn{width:100%}
  .result-head,.fix-section-head{flex-direction:column;align-items:flex-start}
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
          <div class="score-number-hero" id="hero-score-number">${score.score}</div>
          <div class="score-label-hero" id="hero-score-label">${score.label}</div>
        </div>
      </div>
      <div id="hero-score-delta">${prevScore !== null ? renderScoreDelta(score.score, prevScore).replace('score-delta', 'hero-delta') : ''}</div>
      <div class="hero-tags" id="hero-tags">
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
    <button class="tab-btn" onclick="switchTab('agent')">持续优化</button>
    <button class="tab-btn secondary-tab" onclick="switchTab('learn')">教学中心</button>
    <button class="tab-btn secondary-tab" onclick="switchTab('resources')">AI 资源</button>
    <div class="tab-note">先处理诊断结果，再决定是否安装工具或查看外部资源</div>
  </div>

  <!-- 诊断结果 Tab -->
  <div id="tab-diag" class="tab-content active">
    ${autoStartScan ? renderPendingDiagPanel() : renderDiagPanel(results, score, prevScore)}

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

  <!-- Agent 进化 Tab -->
  <div id="tab-agent" class="tab-content">
    ${renderAgentTab()}
  </div>

  <!-- 教学中心 Tab -->
  <div id="tab-learn" class="tab-content">
    <div class="two-col">
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

<!-- 修复执行中遮罩 -->
<div id="fix-exe-overlay" class="fix-executing-overlay">
  <div class="fix-exe-spinner"></div>
  <div id="fix-exe-text" class="fix-exe-text">正在执行修复...</div>
</div>

<!-- 修复结果通知 -->
<div id="fix-toast" class="fix-toast"></div>

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
window.__autoStartScan = ${JSON.stringify(autoStartScan)};
window.__prevScore = ${JSON.stringify(prevScore)};
window.__scanPayload = {
  results: ${JSON.stringify(results.map(r => ({
    id:r.id, name:r.name, category:r.category, status:r.status,
    message:r.message, detail:r.detail||null,
  })))},
  score: ${JSON.stringify(score)},
  label: ${JSON.stringify(score.label)},
  system: ${JSON.stringify((function(){
    var si=null;
    try{ si=require('../scanners/system-info').collectSystemInfo(); }catch(e){}
    return si||{};
  })())},
  timestamp: ${JSON.stringify(new Date().toISOString())},
};
window.__scanState = window.__scanState || { running: false };
// --- Tab 切换 ---
function switchTab(tab) {
  const btn = document.querySelector('.tab-btn[onclick*="' + tab + '"]');
  const panel = document.getElementById('tab-' + tab);
  if (!btn || !panel) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  panel.classList.add('active');
  if (tab === 'agent') loadAgentStatus();
}

function setScanRunning(running) {
  window.__scanState = window.__scanState || {};
  window.__scanState.running = running;
  const btn = document.querySelector('.diag-actions .scan-btn');
  if (!btn) return;
  btn.disabled = running;
  btn.textContent = running ? '扫描中...' : '重新扫描';
}

function getScoreValue(scoreLike) {
  if (scoreLike && typeof scoreLike === 'object' && scoreLike.score !== undefined && scoreLike.score !== null) {
    return scoreLike.score;
  }
  return scoreLike || 0;
}

function getStreamReader(response) {
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    return null;
  }
  return response.body.getReader();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setScanPayload(results, score) {
  window.__scanPayload = {
    ...(window.__scanPayload || {}),
    results,
    score,
    label: score.label,
    timestamp: new Date().toISOString(),
  };
}

function updateHero(score) {
  if (!score) return;

  const color = score.score >= 90 ? '#22c55e' : score.score >= 70 ? '#3b82f6' : score.score >= 50 ? '#eab308' : '#ef4444';
  const numberEl = document.getElementById('hero-score-number');
  const labelEl = document.getElementById('hero-score-label');
  const deltaEl = document.getElementById('hero-score-delta');
  const tagsEl = document.getElementById('hero-tags');
  const ring = document.getElementById('score-ring-fill');
  const glow = document.getElementById('score-ring-glow');

  if (numberEl) {
    numberEl.textContent = String(score.score);
    numberEl.style.color = color;
    numberEl.style.textShadow = '0 0 30px ' + color + '40, 0 0 60px ' + color + '15';
  }
  if (labelEl) labelEl.textContent = score.label;
  if (ring) {
    ring.style.stroke = color;
    ring.style.strokeDashoffset = String(553 - 553 * score.score / 100);
  }
  if (glow) {
    glow.style.stroke = color;
    glow.style.strokeDashoffset = String(553 - 553 * score.score / 100);
  }
  if (tagsEl && Array.isArray(score.breakdown)) {
    const labels = ${JSON.stringify(CATEGORY_LABELS)};
    tagsEl.innerHTML = score.breakdown
      .map(function(item) {
        return '<span class="hero-tag">' + labels[item.category] + ' <em>' + item.passed + '/' + item.total + '</em></span>';
      })
      .join('');
  }
  if (deltaEl) {
    const prev = window.__prevScore;
    if (typeof prev === 'number') {
      const delta = score.score - prev;
      if (delta === 0) deltaEl.innerHTML = '<div class="hero-delta same">与上次持平 (' + prev + ' 分)</div>';
      else deltaEl.innerHTML = '<div class="hero-delta ' + (delta > 0 ? 'up' : 'down') + '">' + (delta > 0 ? '+' : '') + delta + ' 分 ' + (delta > 0 ? '↑' : '↓') + '（上次 ' + prev + ' 分）</div>';
    } else {
      deltaEl.innerHTML = '';
    }
  }
}

function replaceDiagPanel(html, results, score) {
  const current = document.getElementById('results');
  if (current && html) current.outerHTML = html;
  setScanPayload(results, score);
  updateHero(score);
  window.__resultFilter = window.__resultFilter || 'all';
  applyResultFilters();
  refreshSolutions();
}

function setResultFilter(filter, el) {
  window.__resultFilter = filter;
  document.querySelectorAll('.filter-chip-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn === el);
  });
  applyResultFilters();
}

function applyResultFilters() {
  const filter = window.__resultFilter || 'all';
  const keyword = ((document.getElementById('result-search') || {}).value || '').trim().toLowerCase();
  const items = Array.from(document.querySelectorAll('.result-item'));
  let visibleCount = 0;

  items.forEach(function(item) {
    const status = item.getAttribute('data-status') || '';
    const fixable = item.getAttribute('data-fixable') === 'yes';
    const haystack = (item.getAttribute('data-search') || '').toLowerCase();
    const matchFilter = filter === 'all'
      || (filter === 'fixable' && fixable)
      || status === filter;
    const matchSearch = !keyword || haystack.includes(keyword);
    const visible = matchFilter && matchSearch;
    item.classList.toggle('is-hidden', !visible);
    if (visible) visibleCount++;
  });

  document.querySelectorAll('.category-card').forEach(function(card) {
    const hasVisible = card.querySelector('.result-item:not(.is-hidden)');
    card.classList.toggle('is-hidden', !hasVisible);
  });

  const stats = document.getElementById('filter-stats');
  if (stats) stats.textContent = '显示 ' + visibleCount + ' / ' + items.length;

  const empty = document.getElementById('result-empty');
  if (empty) empty.style.display = visibleCount === 0 ? 'block' : 'none';
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
let fixInProgress = false;

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

function showToast(msg, type='info', duration=4000) {
  const t = document.getElementById('fix-toast');
  t.textContent = msg;
  t.className = 'fix-toast ' + type;
  void t.offsetWidth; // reflow to restart transition
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); }, duration);
}

async function confirmFix() {
  if (pendingFixIdx === null || fixInProgress) return;
  fixInProgress = true;
  const idx = pendingFixIdx;
  const fix = fixes[idx];
  closeModal();

  // 全屏遮罩显示执行中
  const overlay = document.getElementById('fix-exe-overlay');
  const exeText = document.getElementById('fix-exe-text');
  exeText.textContent = '正在执行修复...';
  overlay.classList.add('active');

  try {
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(fix),
    });
    const data = await res.json();
    fix.executed = true;
    fix.result = data;

    // 关闭执行中遮罩
    overlay.classList.remove('active');

    // 显示结果通知
    let toastType = 'success', toastMsg = '';
    if (data.verified && data.success && !data.partial) {
      toastMsg = '修复成功';
      toastType = 'success';
    } else if (data.partial) {
      toastMsg = '部分修复';
      toastType = 'warn';
    } else if (data.verified && !data.success) {
      toastMsg = '修复未生效';
      toastType = 'fail';
    } else if (data.rolledBack) {
      toastMsg = '修复失败，已自动回滚';
      toastType = 'fail';
    } else if (data.success && !data.verified) {
      toastMsg = '执行成功，等待验证';
      toastType = 'success';
    } else {
      toastMsg = '修复失败，请重试';
      toastType = 'fail';
    }
    showToast(toastMsg, toastType);

    // 显示执行结果（含验证闭环状态）
    const el = document.getElementById('fix-result-' + idx);
    if (el) {
      if (data.verified && data.success && !data.partial) {
        el.className = 'fix-result success';
        el.textContent = '✓ ' + data.message;
      } else if (data.partial) {
        el.className = 'fix-result warn';
        el.textContent = '⚠ ' + data.message;
      } else if (data.verified && !data.success) {
        el.className = 'fix-result fail';
        el.textContent = '✗ ' + data.message;
      } else if (data.rolledBack) {
        el.className = 'fix-result fail';
        el.textContent = '✗ ' + data.message;
      } else if (data.success && !data.verified) {
        el.className = 'fix-result success';
        el.textContent = '✓ ' + data.message;
      } else {
        el.className = 'fix-result fail';
        el.textContent = '✗ ' + data.message;
      }
    }

    const btn = document.getElementById('fix-btn-' + idx);
    if (btn) {
      if (data.verified && data.success && !data.partial) {
        btn.textContent = '已修复';
        btn.className = 'fix-btn green';
      } else if (data.partial) {
        btn.textContent = '部分修复';
        btn.className = 'fix-btn yellow';
        btn.disabled = false;
      } else if (data.verified && !data.success) {
        btn.textContent = '未生效';
        btn.className = 'fix-btn red';
        btn.disabled = false;
      } else if (data.rolledBack) {
        btn.textContent = '已回滚';
        btn.className = 'fix-btn yellow';
        btn.disabled = false;
      } else if (data.success && !data.verified) {
        btn.textContent = '已执行';
        btn.className = 'fix-btn green';
      } else {
        btn.textContent = '重试';
        btn.className = 'fix-btn yellow';
        btn.disabled = false;
      }
    }

    // 修复成功时重扫更新 UI（服务端验证已有重扫结果，这里刷新诊断面板）
    if (data.success && fix.scannerId) {
      await rescanOne(fix.scannerId);
    }
    fixInProgress = false;
  } catch(e) {
    overlay.classList.remove('active');
    showToast('网络错误: ' + e.message, 'fail');
    const el = document.getElementById('fix-result-' + idx);
    if (el) { el.className = 'fix-result fail'; el.textContent = '✗ 网络错误: ' + e.message; }
    const btn = document.getElementById('fix-btn-' + idx);
    if (btn) { btn.textContent = '重试'; btn.disabled = false; }
    fixInProgress = false;
  }
}

async function rescanOne(scannerId) {
  try {
    const res = await fetch('/api/scan-one', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ scannerId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '重扫失败');
    replaceDiagPanel(data.html, data.results, data.score);
  } catch(e) {
    // 单项重扫失败不影响主流程
    console.warn('重扫失败:', e);
  }
}

async function rescan() {
  const results = document.getElementById('results');
  let scanEndedWithDone = false;
  setScanRunning(true);

  // 清空结果区域，插入进度条
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
    const reader = getStreamReader(res);
    if (!reader) {
      await rescanWithoutStreaming();
      scanEndedWithDone = true;
      return;
    }
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
          }

          // 扫描完成，局部刷新诊断区和 Hero
          if (eventType === 'done') {
            if (data.ok && data.html) {
              replaceDiagPanel(data.html, data.results || [], data.score || { score: 0, label: '', breakdown: [] });
            } else if (data.error) {
              throw new Error(data.error);
            }
            scanEndedWithDone = true;
            return;
          }
        } catch {}
      }
    }
    if (!scanEndedWithDone) {
      await rescanWithoutStreaming();
      scanEndedWithDone = true;
    }
  } catch(e) {
    console.error(e);
    alert('扫描失败，请重试\\n' + (e && e.message ? e.message : String(e)));
  } finally {
    setScanRunning(false);
  }
}

async function rescanWithoutStreaming() {
  const text = document.getElementById('scan-live-text');
  if (text) text.textContent = '正在扫描（兼容模式），预计需要 10-30 秒，请耐心等待...';

  const progressFill = document.querySelector('.progress-fill');
  if (progressFill) progressFill.style.width = '40%';

  const res = await fetch('/api/scan-full', { method: 'POST' });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error((data && (data.error || data.message)) || '扫描失败');
  }
  if (progressFill) progressFill.style.width = '100%';
  replaceDiagPanel(data.html, data.results || [], data.score || { score: 0, label: '', breakdown: [] });
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

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function refreshSolutions() {
  try {
    const payload = window.__scanPayload;
    if (!payload || !payload.results) return;
    const failCats = [...new Set(
      payload.results
        .filter(r => r.status === 'fail' || r.status === 'warn')
        .map(r => r.category)
    )];
    const panel = document.getElementById('solutions-panel');
    const list = document.getElementById('solutions-list');
    if (!panel || !list) return;

    if (failCats.length === 0) {
      panel.classList.remove('visible');
      list.innerHTML = '';
      return;
    }

    const res = await fetch('/api/solutions?categories=' + failCats.join(','));
    const data = await res.json();
    const solutions = data.solutions || data.items || data || [];
    if (!Array.isArray(solutions) || solutions.length === 0) {
      panel.classList.remove('visible');
      list.innerHTML = '';
      return;
    }

    list.innerHTML = solutions.map(function(s) {
      const tags = (s.tags || []).map(function(t) { return '<span class="solution-tag">' + escHtml(t) + '</span>'; }).join('');
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
}

refreshSolutions();

async function openCommunity() {
  const btn = document.querySelector('[onclick="openCommunity()"]');
  if (btn) { btn.textContent = '上传中...'; btn.disabled = true; }

  try {
    const payload = window.__scanPayload || {};
    const summary = [
      '将上传以下摘要信息到社区：',
      '1. 诊断分数与失败分类',
      '2. 检测项状态与说明',
      '3. 系统基础摘要（OS / CPU / RAM / GPU / 磁盘）',
      '',
      '不会上传完整 PATH、环境变量或用户目录路径。',
    ].join('\\n');
    if (!window.confirm(summary)) {
      if (btn) { btn.textContent = '查看社区方案'; btn.disabled = false; }
      return;
    }

    const res = await fetch('/api/stash', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        data: JSON.stringify(payload),
        fingerprint: JSON.stringify({
          platform: navigator.platform,
          userAgent: navigator.userAgent,
          system: payload.system || {},
          score: getScoreValue(payload.score),
          failCount: (payload.results || []).filter(r => r.status === 'fail').length,
          failCategories: [...new Set((payload.results || []).filter(r => r.status === 'fail').map(r => r.category))],
        }),
      }),
    });

    if (!res.ok) throw new Error('上传失败: ' + res.status);
    const {token} = await res.json();
    if (btn) { btn.textContent = '查看社区方案'; btn.disabled = false; }
    window.open(${JSON.stringify(buildCommunityClaimUrl('__TOKEN__'))}.replace('__TOKEN__', encodeURIComponent(token)), '_blank');
  } catch(e) {
    const message = e instanceof Error ? e.message : String(e);
    alert('连接社区失败，请检查网络\\n' + message);
    if (btn) { btn.textContent = '查看社区方案'; btn.disabled = false; }
  }
}

async function submitFeedback() {
  const contentEl = document.getElementById('fb-content');
  const categoryEl = document.getElementById('fb-category');
  const emailEl = document.getElementById('fb-email');
  const contentValue = contentEl && 'value' in contentEl ? contentEl.value : '';
  const content = (contentValue || '').trim();
  const category = (categoryEl && 'value' in categoryEl ? categoryEl.value : '') || 'problem';
  const emailValue = emailEl && 'value' in emailEl ? emailEl.value : '';
  const email = (emailValue || '').trim();
  const statusEl = document.getElementById('fb-status');
  const btn = document.getElementById('fb-submit-btn');

  if (content.length < 5) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff6b6b">请至少输入 5 个字描述你的问题或建议</span>';
    return;
  }

  if (btn) { btn.textContent = '发送中...'; btn.disabled = true; }
  if (statusEl) statusEl.innerHTML = '';

  try {
    const scanPayload = window.__scanPayload || {};
    const scanResults = Array.isArray(scanPayload.results) ? scanPayload.results : [];
    const payload = {
      content,
      category,
      env_summary: {
        score: getScoreValue(scanPayload.score),
        failCount: scanResults.filter(function(r) { return r && r.status === 'fail'; }).length,
        warnCount: scanResults.filter(function(r) { return r && r.status === 'warn'; }).length,
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 200),
      },
    };
    if (email && email.includes('@')) payload.email = email;

    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      // 提取人类可读的错误信息，处理各种嵌套格式
      let errMsg = '提交失败 (HTTP ' + res.status + ')';
      if (typeof data.detail === 'string') errMsg = data.detail;
      else if (typeof data.error === 'string') errMsg = data.error;
      else if (typeof data.message === 'string') errMsg = data.message;
      else if (data.detail && typeof data.detail === 'object') {
        // detail 是嵌套对象（如 {msg: "...", code: "..."}），尝试提取第一个字符串字段
        const vals = Object.values(data.detail).filter(v => typeof v === 'string');
        if (vals.length > 0) errMsg = vals[0] as string;
        else errMsg = JSON.stringify(data.detail); // 兜底：序列化整个对象
      } else if (typeof data.detail === 'object' && data.detail !== null) {
        errMsg = JSON.stringify(data.detail);
      }
      throw new Error(errMsg);
    }

    if (statusEl) statusEl.innerHTML = '<span style="color:#00ff88">反馈已发送，感谢你的意见！我们会尽快处理。</span>';
    const textarea = document.getElementById('fb-content');
    if (textarea) textarea.value = '';
  } catch(e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff6b6b">发送失败: ' + msg + '</span>';
  } finally {
    if (btn) { btn.textContent = '发送反馈'; btn.disabled = false; }
  }
}

function scrollToFeedback() {
  const el = document.getElementById('feedback-section');
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function setAgentStatus(text, ok) {
  var el = document.getElementById('agent-action-status');
  if (!el) return;
  el.innerHTML = '<span style="color:' + (ok ? '#00ff88' : '#ff6b6b') + '">' + escapeHtml(text) + '</span>';
}

function renderAgentStatus(data) {
  var root = document.getElementById('agent-status-root');
  if (!root || !data) return;
  var today = data.today || {};
  var totals = data.totals || {};
  var events = Array.isArray(data.latestEvents) ? data.latestEvents : [];
  var advice = data.advice || {};
  var topProblems = Array.isArray(today.topProblems) ? today.topProblems : [];
  root.innerHTML = [
    '<div class="agent-grid">',
      '<div class="agent-stat"><div class="agent-stat-value">' + (today.totalEvents || 0) + '</div><div class="agent-stat-label">今日错误</div></div>',
      '<div class="agent-stat"><div class="agent-stat-value">' + (today.repeatedEvents || 0) + '</div><div class="agent-stat-label">重复错误</div></div>',
      '<div class="agent-stat"><div class="agent-stat-value">' + (totals.pending || 0) + '</div><div class="agent-stat-label">待同步</div></div>',
      '<div class="agent-stat"><div class="agent-stat-value">' + (totals.synced || 0) + '</div><div class="agent-stat-label">已同步</div></div>',
    '</div>',
    '<div class="card">',
      '<div class="section-title">运行状态 <span class="badge">' + (data.enabled ? '已启用' : '未启用') + '</span></div>',
      '<div class="agent-status-line">本地 runner: <strong>' + (data.localRunnerInstalled ? '已安装' : '未安装') + '</strong></div>',
      '<div class="agent-status-line">自动上传: <strong>' + (data.paused ? '已暂停' : (data.autoSync ? '已开启' : '未开启')) + '</strong></div>',
      '<div class="agent-status-line">本地路径: <strong>' + escapeHtml(data.agentCmd || '-') + '</strong></div>',
    '</div>',
    '<div class="card">',
      '<div class="section-title">最新建议 <span class="badge">AICOEVO</span></div>',
      '<div class="agent-event-msg">' + escapeHtml(advice.summary || '暂无建议。启用后，Agent 运行错误会在这里沉淀成优化建议。') + '</div>',
    '</div>',
    '<div class="two-col">',
      '<div class="card"><div class="section-title">Top 问题 <span class="badge">' + topProblems.length + '</span></div><div class="agent-list">' +
        (topProblems.length ? topProblems.slice(0, 6).map(function(item) {
          return '<div class="agent-event"><div class="agent-event-head"><div class="agent-event-title">' + escapeHtml(item.title || item.fingerprint) + '</div><div class="agent-event-meta">x' + item.count + '</div></div><div class="agent-event-meta">' + escapeHtml(item.status || 'new') + ' · ' + escapeHtml(item.fingerprint || '') + '</div></div>';
        }).join('') : '<div class="agent-event-msg">今天还没有问题包。</div>') +
      '</div></div>',
      '<div class="card"><div class="section-title">最近上传清单 <span class="badge">' + events.length + '</span></div><div class="agent-list">' +
        (events.length ? events.slice(0, 8).map(function(event) {
          return '<div class="agent-event"><div class="agent-event-head"><div class="agent-event-title">' + escapeHtml(event.agent || 'agent') + '</div><div class="agent-event-meta">' + escapeHtml(event.syncStatus || 'pending') + '</div></div><div class="agent-event-msg">' + escapeHtml(event.sanitizedMessage || '') + '</div><div class="agent-event-meta">' + escapeHtml(event.occurredAt || '') + '</div></div>';
        }).join('') : '<div class="agent-event-msg">还没有捕获到 Agent 错误。</div>') +
      '</div></div>',
    '</div>',
  ].join('');
}

async function loadAgentStatus() {
  try {
    var res = await fetch('/api/agent/status');
    var data = await res.json();
    renderAgentStatus(data);
  } catch(e) {
    setAgentStatus('读取 Agent 状态失败: ' + e.message, false);
  }
}

async function enableAgentProbe() {
  var btn = document.getElementById('agent-enable-btn');
  if (btn) { btn.textContent = '启用中...'; btn.disabled = true; }
  try {
    var res = await fetch('/api/agent/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'all' }),
    });
    var data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '启用失败');
    setAgentStatus('已启用 Agent 错误探索。重启 PowerShell 后生效。', true);
    renderAgentStatus(data.status);
  } catch(e) {
    setAgentStatus('启用失败: ' + e.message, false);
  } finally {
    if (btn) { btn.textContent = '启用 Agent 错误探索'; btn.disabled = false; }
  }
}

async function syncAgentNow() {
  try {
    var res = await fetch('/api/agent/sync', { method: 'POST' });
    var data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '同步失败');
    setAgentStatus('同步完成。', true);
    renderAgentStatus(data.status);
  } catch(e) {
    setAgentStatus('同步失败: ' + e.message, false);
  }
}

async function setAgentPause(paused) {
  try {
    var res = await fetch(paused ? '/api/agent/pause' : '/api/agent/resume', { method: 'POST' });
    var data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '操作失败');
    setAgentStatus(paused ? '已暂停自动上传。' : '已恢复自动上传。', true);
    renderAgentStatus(data.status);
  } catch(e) {
    setAgentStatus('操作失败: ' + e.message, false);
  }
}

window.__resultFilter = window.__resultFilter || 'all';
applyResultFilters();
loadAgentStatus();

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeModal();
});

var modalOverlay = document.getElementById('modal-overlay');
if (modalOverlay) {
  modalOverlay.addEventListener('click', function(event) {
    if (event.target === this) closeModal();
  });
}
if (window.__autoStartScan) {
  setTimeout(function() {
    rescan();
  }, 0);
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

export function renderDiagPanel(
  results: ScanResult[],
  score: ScoreResult,
  prevScore: number | null = null,
): string {
  const fixes = getFixSuggestions(results);
  const fixesByTier = {
    green: fixes.filter(f => f.tier === 'green'),
    yellow: fixes.filter(f => f.tier === 'yellow'),
    red: fixes.filter(f => f.tier === 'red'),
    black: fixes.filter(f => f.tier === 'black'),
  };
  const grouped = new Map<ScannerCategory, ScanResult[]>();
  for (const r of results) grouped.set(r.category, (grouped.get(r.category) || []).concat(r));

  const issueCount = results.filter(r => r.status === 'fail' || r.status === 'warn').length;
  const topIssues = getPriorityIssues(results);
  const fixableIds = new Set(fixes.map(f => f.scannerId));
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const passCount = results.filter(r => r.status === 'pass').length;

  return `
  <div id="results" class="diag-panel">
    ${renderWorkflowStrip(results)}
    <div class="diag-actions">
      <button class="scan-btn" onclick="rescan()">重新扫描</button>
      <button class="scan-btn secondary" onclick="openCommunity()">查看社区方案</button>
      <button class="scan-btn secondary" onclick="scrollToFeedback()">反馈问题</button>
    </div>

    <div class="diag-grid">
      ${renderOutcomeCard(score, results)}
      <div class="card">
        <div class="section-title">当前最该处理 <span class="badge">${topIssues.length} 项</span></div>
        <div class="priority-list">
          ${topIssues.length > 0 ? topIssues.map((issue, idx) => {
            const sc = STATUS_CONFIG[issue.status];
            return `
            <div class="priority-item">
              <div class="priority-item-head">
                <div class="priority-item-title">${esc(issue.name)}</div>
                <div class="priority-index">${idx + 1}</div>
              </div>
              <div class="result-meta">
                <span class="result-chip status-${issue.status}" style="color:${sc.color}">${sc.label}</span>
                <span class="result-chip">${CATEGORY_LABELS[issue.category]}</span>
                ${fixableIds.has(issue.id) ? '<span class="result-chip fixable">可修复</span>' : ''}
              </div>
              <div class="priority-item-copy">${esc(issue.message)}</div>
            </div>`;
          }).join('') : '<div class="priority-item"><div class="priority-item-copy">当前没有失败或警告项，可以直接开始使用。</div></div>'}
        </div>
      </div>
    </div>

    ${renderFeedbackForm(score, results)}
    <div class="card toolbar-card">
      <div class="toolbar-row">
        <div class="filter-group">
          <button class="filter-chip-btn active" onclick="setResultFilter('all', this)">全部 ${results.length}</button>
          <button class="filter-chip-btn" onclick="setResultFilter('fail', this)">失败 ${failCount}</button>
          <button class="filter-chip-btn" onclick="setResultFilter('warn', this)">警告 ${warnCount}</button>
          <button class="filter-chip-btn" onclick="setResultFilter('fixable', this)">可修复 ${fixes.length}</button>
          <button class="filter-chip-btn" onclick="setResultFilter('pass', this)">已通过 ${passCount}</button>
        </div>
        <div class="search-wrap">
          <input id="result-search" class="search-input" type="search" placeholder="搜索检测项、说明、详情" oninput="applyResultFilters()">
          <div id="filter-stats" class="filter-stats">显示 ${results.length} / ${results.length}</div>
        </div>
      </div>
    </div>

    ${renderFixSection(fixesByTier)}
    ${renderCategoryResults(grouped, score, fixableIds)}
    <div id="result-empty" class="card result-empty">当前筛选条件下没有检测项。</div>
    <div id="solutions-panel" class="solutions-panel">
      <div class="section-title" style="margin-top:20px">社区方案 <span class="badge">来自 aicoevo.net</span></div>
      <div id="solutions-list"></div>
    </div>
    ${renderSupportHub()}
  </div>`;
}

function renderPendingDiagPanel(): string {
  return `
  <div id="results" class="diag-panel">
    <div class="flow-strip">
      <div class="flow-card active" data-step="1">
        <div class="flow-title">准备扫描</div>
        <div class="flow-copy">页面已打开，正在连接本地扫描流程。</div>
      </div>
      <div class="flow-card active" data-step="2">
        <div class="flow-title">实时检测</div>
        <div class="flow-copy">首屏先展示进度，不再等全部检测完成才返回页面。</div>
      </div>
      <div class="flow-card" data-step="3">
        <div class="flow-title">生成结果</div>
        <div class="flow-copy">扫描完成后会自动替换成完整诊断面板。</div>
      </div>
    </div>
    <div class="card outcome-card medium">
      <div class="eyebrow">正在初始化</div>
      <div class="outcome-title">页面已加载，环境扫描马上开始</div>
      <div class="outcome-copy">如果机器上工具较多，扫描可能需要几十秒，但现在不会再出现长时间白屏。</div>
      <div class="outcome-next">保持当前页面即可，结果会自动刷新。</div>
    </div>
  </div>`;
}

function renderOutcomeCard(score: ScoreResult, results: ScanResult[]): string {
  const summary = getOutcomeSummary(score, results);
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const fixCount = getFixSuggestions(results).length;

  return `
  <div class="card outcome-card ${summary.tone}">
    <div class="eyebrow">环境结论</div>
    <div class="outcome-title">${summary.title}</div>
    <div class="outcome-copy">${summary.subtitle}</div>
    <div class="summary-badges">
      <span class="summary-badge"><strong>${score.score}</strong> 分</span>
      <span class="summary-badge"><strong>${failCount}</strong> 个失败</span>
      <span class="summary-badge"><strong>${warnCount}</strong> 个警告</span>
      <span class="summary-badge"><strong>${fixCount}</strong> 项可行动作</span>
    </div>
    <div class="outcome-next">${summary.nextStep}</div>
  </div>`;
}

function renderWorkflowStrip(results: ScanResult[]): string {
  const state = getWorkflowState(results);
  const activeIndex = state.stage === 'diagnose' ? 0 : state.stage === 'fix' ? 1 : 2;
  const steps = [
    { title: '诊断完成', copy: '先看结论、Top 问题和失败项，确认阻塞点。' },
    { title: '处理问题', copy: state.summary },
    { title: '复检确认', copy: '修复后重新扫描，确认总分、分类通过率和关键链路已更新。' },
  ];

  return `
  <div class="flow-strip">
    ${steps.map((step, idx) => `
      <div class="flow-card ${idx <= activeIndex ? 'active' : ''}" data-step="${idx + 1}">
        <div class="flow-title">${step.title}</div>
        <div class="flow-copy">${step.copy}</div>
      </div>
    `).join('')}
  </div>`;
}

function renderCategoryResults(
  grouped: Map<ScannerCategory, ScanResult[]>,
  score: ScoreResult,
  fixableIds: Set<string>,
): string {
  const html: string[] = [];
  for (const [cat, items] of grouped) {
    const bd = score.breakdown.find(b => b.category === cat);
    const passed = bd?.passed || 0;
    const total = bd?.total || items.length;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const barColor = pct === 100 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';

    html.push(`
    <div class="card category-card" data-category-card="${cat}">
      <div class="section-title">
        ${CATEGORY_LABELS[cat]}
        <span class="badge">${passed}/${total} 通过</span>
      </div>
      <div class="category-bar"><div class="category-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div style="margin-top:12px">
        ${items.map(r => {
          const sc = STATUS_CONFIG[r.status];
          const searchText = [r.name, r.message, r.detail || '', CATEGORY_LABELS[r.category]].join(' ').toLowerCase();
          return `
          <div class="result-item"
               data-scanner-id="${esc(r.id)}"
               data-status="${esc(r.status)}"
               data-fixable="${fixableIds.has(r.id) ? 'yes' : 'no'}"
               data-search="${esc(searchText)}">
            <div class="status-icon" style="background:${sc.bg};color:${sc.color}">${sc.icon}</div>
            <div style="flex:1">
              <div class="result-head">
                <div class="result-name">${esc(r.name)}</div>
                <div class="result-meta">
                  <span class="result-chip status-${r.status}" style="color:${sc.color}">${sc.label}</span>
                  ${fixableIds.has(r.id) ? '<span class="result-chip fixable">可修复</span>' : ''}
                </div>
              </div>
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

  for (const section of FIX_ACTION_SECTIONS) {
    const items = allFixesWithIdx.filter(f => f.tier === section.tier);
    if (items.length === 0) continue;
    const tc = TIER_CONFIG[section.tier];
    sections.push(`
    <div class="fix-section-block">
      <div class="fix-section-head">
        <div>
          <div class="fix-section-title" style="color:${tc.color}">${tc.icon} ${section.title} (${items.length})</div>
          <div class="fix-section-desc">${section.desc}</div>
        </div>
      </div>
      ${items.map(f => `
      <div class="fix-item">
        <div class="fix-info">
          <div class="fix-title">${esc(f.description.split('\n')[0])}</div>
          ${f.description.includes('\n') ? `<div class="fix-desc">${esc(f.description.split('\n').slice(1).join('\n'))}</div>` : ''}
          ${f.commands ? `<div class="fix-desc" style="color:#64748b;font-family:monospace">${f.commands.map(c => '$ ' + esc(c)).join('\n')}</div>` : ''}
          <div class="fix-risk">风险: ${esc(f.risk)}</div>
          <div id="fix-result-${f._idx}"></div>
        </div>
        ${(section.tier === 'green' || section.tier === 'yellow')
          ? `<button id="fix-btn-${f._idx}" class="fix-btn ${section.tier}" onclick="openModal(${f._idx})">${esc(f.actionLabel || section.buttonLabel)}</button>`
          : ''}
      </div>`).join('')}
    </div>`);
  }

  return `
  <div class="card fix-section">
    <div class="section-title" style="color:#22c55e">修复建议 <span class="badge">${allFixes.length} 项</span></div>
    ${sections.join('')}
  </div>`;
}

function renderSupportHub(): string {
  return `
  <div class="card support-hub">
    <div class="section-title">后续辅助入口 <span class="badge">低优先级</span></div>
    <div class="support-grid">
      <a class="support-link" href="javascript:void(0)" onclick="switchTab('install')">
        <div class="support-link-title">去安装工具</div>
        <div class="support-link-copy">诊断已经明确问题后，再进入一键安装，避免装了但仍不可用。</div>
      </a>
      <a class="support-link" href="javascript:void(0)" onclick="switchTab('learn')">
        <div class="support-link-title">查看教程</div>
        <div class="support-link-copy">适合环境已基本就绪后再看，避免边看边配导致路径更乱。</div>
      </a>
      <a class="support-link" href="javascript:void(0)" onclick="switchTab('resources')">
        <div class="support-link-title">外部资源</div>
        <div class="support-link-copy">模型套餐、API 平台和镜像站都保留，但不再放在主流程前面。</div>
      </a>
    </div>
  </div>`;
}

function renderFeedbackForm(score: ScoreResult, results: ScanResult[]): string {
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  return `
  <div class="card feedback-card" id="feedback-section">
    <div class="section-title">反馈与建议 <span class="badge">直达开发者</span></div>
    <div style="font-size:.82rem;color:#94a3b8;margin-bottom:12px">
      遇到问题或有改进想法？直接告诉我们，无需注册登录。我们会根据反馈持续优化工具和社区方案。
    </div>
    <div class="feedback-form">
      <div class="feedback-row">
        <select id="fb-category" class="feedback-select">
          <option value="problem">遇到问题</option>
          <option value="suggestion">功能建议</option>
          <option value="bug">报告 Bug</option>
          <option value="other">其他</option>
        </select>
      </div>
      <textarea id="fb-content" class="feedback-textarea" rows="3" placeholder="描述你遇到的问题或想法...（至少 5 个字）" maxlength="2000"></textarea>
      <div class="feedback-row" style="align-items:center;justify-content:space-between">
        <input id="fb-email" class="feedback-input" type="email" placeholder="邮箱（可选，方便我们回复你）" />
        <button class="scan-btn" onclick="submitFeedback()" id="fb-submit-btn" style="margin:0;white-space:nowrap">发送反馈</button>
      </div>
      <div id="fb-status" class="feedback-status"></div>
    </div>
  </div>`;
}

function renderAgentTab(): string {
  return `
  <div class="card" style="border-color:rgba(236,72,153,.2)">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,rgba(236,72,153,.15),rgba(236,72,153,.05));display:flex;align-items:center;justify-content:center;font-size:1.5rem;border:1px solid rgba(236,72,153,.2)">&#9889;</div>
      <div>
        <div style="font-family:var(--display);font-size:1.1rem;font-weight:700;color:#f9a8d4;text-shadow:0 0 12px rgba(236,72,153,.3)">持续优化插件</div>
        <div style="font-size:.78rem;color:var(--text-dim)">后台守护你的 AI 开发环境，社区帮你持续优化</div>
      </div>
    </div>
    <div style="font-size:.84rem;color:var(--text-mid);line-height:1.8;margin-bottom:18px">
      安装后，插件会在后台实时工作：<br>
      <span style="color:#f9a8d4">1.</span> 自动捕获 Claude Code / OpenClaw 运行时的错误和异常<br>
      <span style="color:#f9a8d4">2.</span> 脱敏后安全上传到 <a href="https://aicoevo.net" target="_blank" rel="noopener" style="color:#ec4899;text-decoration:none;border-bottom:1px solid rgba(236,72,153,.3)">aicoevo.net</a> 云端<br>
      <span style="color:#f9a8d4">3.</span> 社区和 AI 分析你的问题，给出针对性优化建议
    </div>
    <div class="agent-actions">
      <button class="scan-btn" id="agent-enable-btn" onclick="enableAgentProbe()" style="margin:0;background:linear-gradient(135deg,rgba(236,72,153,.2),rgba(236,72,153,.08));border-color:rgba(236,72,153,.3);color:#f9a8d4">安装插件</button>
      <button class="scan-btn secondary" onclick="syncAgentNow()" style="margin:0">立即同步</button>
      <button class="scan-btn secondary" onclick="setAgentPause(true)" style="margin:0">暂停上传</button>
      <button class="scan-btn secondary" onclick="setAgentPause(false)" style="margin:0">恢复上传</button>
    </div>
    <div id="agent-action-status" class="feedback-status"></div>
  </div>
  <div style="display:flex;gap:12px;margin-bottom:16px">
    <a href="https://aicoevo.net" target="_blank" rel="noopener" style="flex:1;padding:16px;border-radius:12px;border:1px solid rgba(236,72,153,.15);background:rgba(236,72,153,.03);text-decoration:none;transition:all .2s" onmouseover="this.style.borderColor='rgba(236,72,153,.3)';this.style.background='rgba(236,72,153,.06)'" onmouseout="this.style.borderColor='rgba(236,72,153,.15)';this.style.background='rgba(236,72,153,.03)'">
      <div style="font-size:.82rem;font-weight:700;color:#f9a8d4;margin-bottom:4px">aicoevo.net 社区</div>
      <div style="font-size:.74rem;color:var(--text-dim)">查看优化建议、社区方案、实时更新</div>
    </a>
    <div style="flex:1;padding:16px;border-radius:12px;border:1px solid var(--border);background:rgba(7,11,24,.55)">
      <div style="font-size:.82rem;font-weight:700;color:var(--text-mid);margin-bottom:4px">插件原理</div>
      <div style="font-size:.74rem;color:var(--text-dim)">纯 Node.js，29KB，零依赖。安装到 ~/.aicoevo/agent/，通过 PowerShell hook 自动运行。</div>
    </div>
  </div>
  <div id="agent-status-root">
    <div class="card">
      <div class="section-title">正在读取 <span class="badge">本地</span></div>
      <div class="agent-event-msg">正在读取本地 Agent 问题包、上传清单和最新建议。</div>
    </div>
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
