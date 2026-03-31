import React from 'react';
import { Box, Text } from 'ink';

const LOGO = `
  ╔═══════════════════════════╗
  ║     a i c o e v o        ║
  ║   AI 环境诊断工具 v0.1    ║
  ╚═══════════════════════════╝`;

interface Props {
  onConsent?: (share: boolean) => void;
}

export function Welcome({ onConsent }: Props) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{LOGO}</Text>
      </Box>
      <Text>检测你的 Windows AI 开发环境，发现潜在问题并提供修复建议。</Text>
      <Box marginTop={1}>
        <Text dimColor>即将开始扫描...</Text>
      </Box>
    </Box>
  );
}
