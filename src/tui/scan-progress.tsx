import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  completed: number;
  total: number;
  current: string;
}

export function ScanProgress({ completed, total, current }: Props) {
  const width = 30;
  const pct = total > 0 ? completed / total : 0;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text color="cyan" bold>扫描进度 </Text>
        <Text>{bar} </Text>
        <Text>{completed}/{total}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>正在检测: {current}</Text>
      </Box>
    </Box>
  );
}
