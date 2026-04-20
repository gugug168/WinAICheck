/**
 * Diagnostic result combining classification + human-readable messages (D-19).
 * Mirrors architecture from mac-aicheck src/fixers/diagnostics.ts
 */

import { classifyError, ERROR_MESSAGES } from './errors';
import type { ClassifiedError } from './errors';

/**
 * Diagnostic result combining classification + human-readable messages (D-19)
 */
export interface DiagnosticResult {
  code: string;           // e.g., "ERR_TIMEOUT_001"
  title: string;          // Chinese title from ERROR_MESSAGES
  suggestion: string;     // Chinese suggestion from ERROR_MESSAGES
  recoverable: boolean;  // from ClassifiedError
  context?: string;       // from ClassifiedError
}

/**
 * Combine classifyError result with ERROR_MESSAGES for complete diagnostic info (D-19, DIA-01, DIA-03).
 * Returns structured diagnostic result for CLI display.
 */
export function diagnose(
  exitCode: number,
  stderr: string,
  errorMessage?: string
): DiagnosticResult {
  const classified: ClassifiedError = classifyError(exitCode, stderr, errorMessage);
  const msg = ERROR_MESSAGES[classified.category];

  return {
    code: classified.code,
    title: msg.title,
    suggestion: msg.suggestion,
    recoverable: classified.recoverable,
    context: classified.context,
  };
}

/**
 * Format diagnostic result for CLI display (D-19, DIA-03).
 */
export function formatDiagnostic(d: DiagnosticResult): string {
  const lines = [
    `  [${d.code}] ${d.title}`,
    `  建议: ${d.suggestion}`,
  ];
  if (d.context) {
    lines.push(`  详情: ${d.context}`);
  }
  if (!d.recoverable) {
    lines.push(`  (此错误无法自动恢复)`);
  }
  return lines.join('\n');
}
