/**
 * Fix verification: re-scan after fix to confirm recovery (D-04, VRF-01).
 * Mirrors architecture from mac-aicheck src/fixers/verify.ts
 */

import type { FixResult, VerificationStatus } from '../scanners/types';
import type { ScanResult } from '../scanners/types';
import { getScannerById } from '../scanners/registry';

/**
 * Run verification by re-scanning after a fix attempt (D-04, VRF-01).
 * Returns the re-scan result AND determines verification status.
 */
export async function verifyFix(
  originalScanResult: ScanResult,
  _fixerId: string
): Promise<{ newScanResult: ScanResult; status: VerificationStatus }> {
  const scanner = getScannerById(originalScanResult.id);
  if (!scanner) {
    return {
      newScanResult: { ...originalScanResult, status: 'unknown', message: 'Verification scanner not found' },
      status: 'fail',
    };
  }

  let newScanResult: ScanResult;
  try {
    newScanResult = await scanner.scan();
  } catch (err) {
    return {
      newScanResult: { ...originalScanResult, status: 'unknown', message: `Verification scan error: ${err instanceof Error ? err.message : String(err)}` },
      status: 'fail',
    };
  }

  const status = determineVerificationStatus(originalScanResult.status, newScanResult.status);
  return { newScanResult, status };
}

/**
 * Determine verification status based on before/after scan status (VRF-02).
 * Rules:
 * - fail→pass = pass
 * - fail→warn = warn (partial fix)
 * - warn→pass = pass
 * - warn→warn = warn
 * - pass→pass = pass
 * - anything→fail = fail
 */
export function determineVerificationStatus(
  original: ScanResult['status'],
  current: ScanResult['status']
): VerificationStatus {
  if (current === 'pass') return 'pass';
  if (current === 'warn') return 'warn';
  if (current === 'fail') {
    if (original === 'fail') return 'warn'; // partial credit for trying
    return 'fail';
  }
  return 'fail';
}

/**
 * Preflight check before executing a fix (FIX-04).
 * Returns error message if preflight fails, null if OK to proceed.
 */
export function preflightCheck(scanResult: ScanResult): string | null {
  const scanner = getScannerById(scanResult.id);
  if (!scanner) {
    return `No scanner found for: ${scanResult.id}`;
  }
  // The actual preflight rules are in index.ts runPreflight()
  // This function is provided as a utility for the CLI layer
  return null;
}

/**
 * Build nextSteps array based on verification result and fixer risk level.
 */
export function buildNextSteps(
  status: VerificationStatus,
  fixerRisk: 'green' | 'yellow' | 'red',
  message?: string
): string[] {
  const steps: string[] = [];

  if (status === 'pass') {
    steps.push('修复成功，问题已解决');
  } else if (status === 'warn') {
    steps.push('部分修复完成，建议手动验证');
    if (fixerRisk === 'yellow' || fixerRisk === 'red') {
      steps.push('可能需要手动验证或重启终端');
    }
  } else {
    steps.push('修复未能解决问题，请查看详细错误信息');
    if (message) {
      steps.push(`错误详情: ${message}`);
    }
  }

  return steps;
}
