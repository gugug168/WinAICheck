// scripts/ground-truth/firewall-ports.truth.ts
import { runCommand } from '../../src/executor/index';
import { aggregateVerdict, runScannerOrFallback } from './runner';
import type { TruthValidator, ValidatorEnv, ValidationReport, ValidationCheck } from './types';

/** AI 常用端口列表，与扫描器保持一致 */
const AI_PORTS = [
  { port: 22, name: 'SSH' },
  { port: 443, name: 'HTTPS' },
  { port: 7860, name: 'Gradio/WebUI' },
  { port: 8888, name: 'Jupyter' },
  { port: 11434, name: 'Ollama' },
];

export const firewallPortsValidator: TruthValidator = {
  id: 'firewall-ports',
  name: '防火墙端口检测',
  async validate(env: ValidatorEnv): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [];

    // Step 1: 独立获取防火墙规则
    const netshResult = runCommand(
      'netsh advfirewall firewall show rule name=all verbose',
      15000,
    );

    // 非管理员或命令失败 → 标记为 skipped
    if (netshResult.exitCode !== 0) {
      const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('firewall-ports', '防火墙端口检测', 'permission');

      checks.push({
        name: '防火墙规则读取',
        scannerStep: 'runCommand:netsh advfirewall firewall show rule',
        expectedValue: '无法读取（非管理员或命令失败）',
        scannerValue: scannerResult.status,
        verdict: 'skipped',
        note: 'netsh 命令失败，跳过防火墙端口检查',
      });

      return {
        scannerId: 'firewall-ports',
        scannerName: '防火墙端口检测',
        env,
        checks,
        overallVerdict: aggregateVerdict(checks),
        scannerResult,
        scannerDiagnostic: scannerDiag,
      };
    }

    // Step 2: 独立解析已放行端口
    const blocks = netshResult.stdout
      .split(/\r?\n(?=(?:Rule Name|规则名称)\s*:)/)
      .map(block => block.trim())
      .filter(Boolean);

    const truthAllowed: string[] = [];
    const truthMissing: string[] = [];

    for (const { port, name } of AI_PORTS) {
      const hasAllowRule = blocks.some(block => {
        const mentionsPort = new RegExp(`\\b${port}\\b`).test(block);
        const allowsInbound =
          /(Direction|方向)\s*:\s*(In|Inbound|入站)/i.test(block)
          && /(Action|操作)\s*:\s*(Allow|允许)/i.test(block)
          && /(Enabled|已启用)\s*:\s*(Yes|是)/i.test(block);
        const fallbackAllow = mentionsPort && /(Allow|允许)/i.test(block);
        return mentionsPort && (allowsInbound || fallbackAllow);
      });

      if (hasAllowRule) truthAllowed.push(`${name}(:${port})`);
      else truthMissing.push(`${name}(:${port})`);
    }

    // Step 3: 运行扫描器
    const { result: scannerResult, diagnostic: scannerDiag } = await runScannerOrFallback('firewall-ports', '防火墙端口检测', 'permission');

    // 检查点 1: 防火墙规则读取
    const expectedRead = '成功读取';
    const scannerRead = scannerResult.status !== 'unknown' ? '成功读取' : '读取失败';
    checks.push({
      name: '防火墙规则读取',
      scannerStep: 'runCommand:netsh advfirewall firewall show rule',
      expectedValue: expectedRead,
      scannerValue: scannerRead,
      verdict: expectedRead === scannerRead ? 'correct' : 'incorrect',
    });

    // 检查点 2: 端口判定
    const expectedPortStatus = truthMissing.length > 0 ? 'warn' : 'pass';
    checks.push({
      name: '端口判定',
      scannerStep: 'parse:ports',
      expectedValue: expectedPortStatus,
      scannerValue: scannerResult.status,
      verdict: expectedPortStatus === scannerResult.status ? 'correct' : 'incorrect',
    });

    return {
      scannerId: 'firewall-ports',
      scannerName: '防火墙端口检测',
      env,
      checks,
      overallVerdict: aggregateVerdict(checks),
      scannerResult,
      scannerDiagnostic: scannerDiag,
    };
  },
};
