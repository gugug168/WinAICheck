import { _diag, runCommand } from '../executor/index';
import type { Scanner, ScanResult, ScanDiagnostic, DecisionStep } from './types';

/** 在诊断模式下运行扫描器，返回结果 + 决策链 */
export async function scanWithDiagnostic(scanner: Scanner): Promise<{
  result: ScanResult;
  diagnostic: ScanDiagnostic;
}> {
  const steps: DecisionStep[] = [];

  // 设置钩子收集决策步骤
  _diag.onCommand = (cmd, result) => {
    steps.push({
      action: 'command',
      input: cmd,
      rawOutput: result.stdout,
      exitCode: result.exitCode,
      conclusion: result.exitCode === 0 ? '命令执行成功' : `命令失败 (exitCode: ${result.exitCode})`,
    });
  };

  _diag.onReg = (queryPath, output) => {
    steps.push({
      action: 'registry_check',
      input: queryPath,
      rawOutput: output,
      conclusion: output ? '注册表读取成功' : '注册表读取为空',
    });
  };

  _diag.onPS = (script, output) => {
    steps.push({
      action: 'command',
      input: `PowerShell: ${script}`,
      rawOutput: output,
      conclusion: output ? 'PowerShell 执行成功' : 'PowerShell 无输出',
    });
  };

  // 运行扫描
  const result = await scanner.scan();

  // 清理钩子
  _diag.onCommand = undefined;
  _diag.onReg = undefined;
  _diag.onPS = undefined;

  // 收集环境信息
  const admin = runCommand('net session', 5000).exitCode === 0;

  const diagnostic: ScanDiagnostic = {
    scannerId: scanner.id,
    steps,
    finalStatus: result.status,
    finalReason: result.message,
    environment: {
      os: process.platform,
      arch: process.arch,
      admin,
      timestamp: Date.now(),
    },
  };

  return { result, diagnostic };
}
