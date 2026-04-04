import type { ScanResult, ScannerCategory, ScoreGrade, ScoreResult } from '../scanners/types';
import { CATEGORY_WEIGHTS } from '../scanners/types';
import { getScannerById } from '../scanners/registry';

/** 按类别分组结果 */
function groupByCategory(results: ScanResult[]): Map<ScannerCategory, ScanResult[]> {
  const map = new Map<ScannerCategory, ScanResult[]>();
  for (const r of results) {
    const list = map.get(r.category) || [];
    list.push(r);
    map.set(r.category, list);
  }
  return map;
}

/** 计算评分 */
export function calculateScore(results: ScanResult[]): ScoreResult {
  const grouped = groupByCategory(results);

  let totalWeightedPass = 0;
  let totalWeightedAll = 0;

  const breakdown: ScoreResult['breakdown'] = [];

  for (const [category, items] of grouped) {
    const weight = CATEGORY_WEIGHTS[category];
    // 仅统计会影响总分的 scanner，且 unknown 不计入分母
    const scorable = items.filter(r => {
      if (r.status === 'unknown') return false;
      return getScannerById(r.id)?.affectsScore !== false;
    });
    const passed = scorable.filter(r => r.status === 'pass').length;
    const total = scorable.length;

    if (total > 0) {
      const weightedScore = (passed / total) * weight;
      totalWeightedPass += weightedScore;
      totalWeightedAll += weight;

      breakdown.push({
        category,
        passed,
        total,
        weight,
        weightedScore: Math.round(weightedScore * 100) / 100,
      });
    } else {
      breakdown.push({ category, passed: 0, total: 0, weight, weightedScore: 0 });
    }
  }

  const score = totalWeightedAll > 0
    ? Math.round((totalWeightedPass / totalWeightedAll) * 100)
    : 0;

  const { grade, label } = getGrade(score);

  return { score, grade, label, breakdown };
}

/** 评分分级 */
function getGrade(score: number): { grade: ScoreGrade; label: string } {
  if (score >= 90) return { grade: 'excellent', label: '优秀' };
  if (score >= 70) return { grade: 'good', label: '良好' };
  if (score >= 50) return { grade: 'fair', label: '一般' };
  return { grade: 'poor', label: '需改善' };
}
