import React from 'react';
import { Box, Text } from 'ink';
import type { ScanResult, ScoreResult, ScannerCategory, FixSuggestion } from '../scanners/types';

const CATEGORY_LABELS: Record<ScannerCategory, string> = {
  path: '路径与系统环境',
  toolchain: '核心工具链',
  gpu: '显卡与子系统',
  permission: '权限与安全',
  network: '网络与镜像',
};

const STATUS_ICONS: Record<string, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
  unknown: '?',
};

const STATUS_COLORS: Record<string, string> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'red',
  unknown: 'gray',
};

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  green: { label: '可自动修复', color: 'green' },
  yellow: { label: '需确认修复', color: 'yellow' },
  red: { label: '有指引', color: 'red' },
  black: { label: '仅告知', color: 'gray' },
};

interface Props {
  score: ScoreResult;
  results: ScanResult[];
  fixes: FixSuggestion[];
  onFix?: (fixId: string) => void;
}

export function Results({ score, results, fixes, onFix }: Props) {
  const gradeColor = score.score >= 90 ? 'green' : score.score >= 70 ? 'blue' : score.score >= 50 ? 'yellow' : 'red';

  return (
    <Box flexDirection="column" padding={1}>
      {/* 评分卡片 */}
      <Box borderStyle="round" borderColor={gradeColor} paddingX={2} marginBottom={1}>
        <Text bold color={gradeColor}>评分: {score.score}/100 — {score.label}</Text>
      </Box>

      {/* 按类别分组 */}
      {score.breakdown.map(b => {
        const items = results.filter(r => r.category === b.category);
        return (
          <Box flexDirection="column" key={b.category} marginBottom={1}>
            <Text bold color="cyan">
              {CATEGORY_LABELS[b.category]} ({b.passed}/{b.total})
            </Text>
            {items.map(r => (
              <Box key={r.id} marginLeft={2}>
                <Text color={STATUS_COLORS[r.status]}>
                  {STATUS_ICONS[r.status]}{' '}
                </Text>
                <Text>{r.name}: </Text>
                <Text color={STATUS_COLORS[r.status]}>{r.message}</Text>
              </Box>
            ))}
          </Box>
        );
      })}

      {/* 修复建议 */}
      {fixes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">修复建议 ({fixes.length} 项)</Text>
          {fixes.map(fix => {
            const tier = TIER_LABELS[fix.tier];
            return (
              <Box key={fix.id} marginLeft={2} flexDirection="column">
                <Box>
                  <Text color={tier.color}>[{tier.label}]</Text>
                  <Text> {fix.description.split('\n')[0]}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
