import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { FixSuggestion, FixResult } from '../scanners/types';

const TIER_COLORS: Record<string, string> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  black: 'gray',
};

const TIER_LABELS: Record<string, string> = {
  green: '可自动修复',
  yellow: '需确认修复',
  red: '有指引',
  black: '仅告知',
};

interface Props {
  fixes: FixSuggestion[];
  fixResults: Map<string, FixResult>;
  onExecute: (fix: FixSuggestion) => Promise<void>;
  onBack: () => void;
  onExit: () => void;
}

export function FixDetail({ fixes, fixResults, onExecute, onBack, onExit }: Props) {
  const [selectedIndex, setSelected] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);

  if (fixes.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green" bold>所有检测项均通过，无需修复！</Text>
        <Box marginTop={1}>
          <Text dimColor>按 q 返回结果页</Text>
        </Box>
        {useInput(() => {}) && null}
      </Box>
    );
  }

  const fix = fixes[selectedIndex];

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(Math.max(0, selectedIndex - 1));
      setConfirmIdx(null);
    }
    if (key.downArrow) {
      setSelected(Math.min(fixes.length - 1, selectedIndex + 1));
      setConfirmIdx(null);
    }
    if (input === 'q') {
      onBack();
    }

    // 执行修复
    if (input === 'r' && !executing) {
      if (fix.tier === 'green') {
        // 绿色档：直接执行
        setExecuting(true);
        onExecute(fix).finally(() => setExecuting(false));
      } else if (fix.tier === 'yellow') {
        // 黄色档：需要确认
        if (confirmIdx === selectedIndex) {
          // 已确认，执行
          setExecuting(true);
          onExecute(fix).finally(() => { setExecuting(false); setConfirmIdx(null); });
        } else {
          // 第一次按 r，进入确认状态
          setConfirmIdx(selectedIndex);
        }
      }
    }

    // 取消确认
    if (input === 'n' && confirmIdx === selectedIndex) {
      setConfirmIdx(null);
    }

    if (input === 'a' && !executing) {
      // 执行所有 green 档
      const greens = fixes.filter(f => f.tier === 'green' && !fixResults.has(f.id));
      setExecuting(true);
      Promise.all(greens.map(f => onExecute(f))).finally(() => setExecuting(false));
    }

    if (input === 'x') onExit();
  });

  const result = fix ? fixResults.get(fix.id) : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">修复详情 ({fixes.length} 项)</Text>

      {/* 修复列表 */}
      <Box flexDirection="column" marginBottom={1} marginTop={1}>
        {fixes.map((f, i) => {
          const r = fixResults.get(f.id);
          return (
            <Box key={f.id}>
              <Text color={i === selectedIndex ? 'cyan' : undefined}>
                {i === selectedIndex ? '▸ ' : '  '}
              </Text>
              <Text color={TIER_COLORS[f.tier]}>
                [{TIER_LABELS[f.tier]}]
              </Text>
              <Text> {f.description.split('\n')[0]}</Text>
              {r && <Text color={r.success ? 'green' : 'red'}> {r.success ? '✓已修复' : '✗失败'}</Text>}
            </Box>
          );
        })}
      </Box>

      {/* 选中修复的详情 */}
      {fix && (
        <Box flexDirection="column" borderStyle="round" padding={1} borderColor="gray">
          <Text bold>{fix.description.split('\n')[0]}</Text>
          <Text color="gray">风险: {fix.risk}</Text>
          {fix.commands && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>命令:</Text>
              {fix.commands.map((cmd, i) => (
                <Text key={i} color="gray">  $ {cmd}</Text>
              ))}
            </Box>
          )}

          {/* 执行结果 */}
          {result && (
            <Box marginTop={1}>
              <Text color={result.success ? 'green' : 'red'}>
                {result.success ? `✓ ${result.message}` : `✗ ${result.message}`}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* 黄色档确认提示 */}
      {confirmIdx === selectedIndex && fix?.tier === 'yellow' && (
        <Box marginTop={1}>
          <Text color="yellow" bold>
            此操作有风险，再次按 r 确认执行，按 n 取消
          </Text>
        </Box>
      )}

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ 选择 |{' '}
          {fix?.tier === 'green' && <Text color="green">r 执行 | a 执行全部绿色档 | </Text>}
          {fix?.tier === 'yellow' && <Text color="yellow">r 执行（需确认） | </Text>}
          q 返回 | x 退出
        </Text>
      </Box>

      {executing && <Text color="yellow">⏳ 执行中...</Text>}
    </Box>
  );
}
