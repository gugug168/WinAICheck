import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { FixSuggestion } from '../scanners/types';

const TIER_COLORS: Record<string, string> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  black: 'gray',
};

interface Props {
  fixes: FixSuggestion[];
  onExecute: (fix: FixSuggestion) => Promise<void>;
  onBack: () => void;
}

export function FixDetail({ fixes, onExecute, onBack }: Props) {
  const [selectedIndex, setSelected] = useState(0);
  const [executing, setExecuting] = useState(false);

  const fix = fixes[selectedIndex];
  if (!fix) return <Text>没有可修复的项</Text>;

  useInput((input, key) => {
    if (key.upArrow) setSelected(Math.max(0, selectedIndex - 1));
    if (key.downArrow) setSelected(Math.min(fixes.length - 1, selectedIndex + 1));
    if (input === 'r' && fix.tier === 'green') {
      setExecuting(true);
      onExecute(fix).finally(() => setExecuting(false));
    }
    if (input === 'q') onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">修复详情</Text>

      {/* 修复列表 */}
      <Box flexDirection="column" marginBottom={1}>
        {fixes.map((f, i) => (
          <Box key={f.id}>
            <Text color={i === selectedIndex ? 'cyan' : undefined}>
              {i === selectedIndex ? '▸ ' : '  '}
            </Text>
            <Text color={TIER_COLORS[f.tier]}>{f.description.split('\n')[0]}</Text>
          </Box>
        ))}
      </Box>

      {/* 选中修复的详情 */}
      <Box flexDirection="column" borderStyle="round" padding={1}>
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
      </Box>

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ 选择 |{' '}
          {fix.tier === 'green' ? (
            <Text color="green">r 执行修复</Text>
          ) : (
            <Text color="gray">此档不可自动执行</Text>
          )}
          {' | '}q 返回
        </Text>
      </Box>

      {executing && <Text color="yellow">执行中...</Text>}
    </Box>
  );
}
