import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const groups = {
  core: [
    'tests/calculator-sanitizer.test.ts',
    'tests/fixers.test.ts',
    'tests/remote-json.test.ts',
    'tests/scanner-parse.test.ts',
    'tests/integration/ccswitch-scanner.test.ts',
  ],
  integration: [
    'tests/integration/ai-workflow-scanners.test.ts',
    'tests/integration/network-scanners.test.ts',
    'tests/integration/permission-scanners.test.ts',
    'tests/integration/path-scanners.test.ts',
    'tests/integration/toolchain-scanners.test.ts',
    'tests/integration/gpu-scanners.test.ts',
    'tests/integration/scoring-e2e.test.ts',
    'tests/integration/sse-streaming.test.ts',
  ],
} as const;

function toRepoPath(filepath: string): string {
  return filepath.replace(/\\/g, '/');
}

function listTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listTestFiles(full));
    } else if (entry.endsWith('.test.ts')) {
      files.push(toRepoPath(full));
    }
  }
  return files.sort();
}

function getTargets(mode: string): string[] {
  const allTests = listTestFiles('tests');
  if (mode === 'core') return allTests.filter(file => !file.startsWith('tests/integration/'));
  if (mode === 'integration') return allTests.filter(file => file.startsWith('tests/integration/'));
  if (mode === 'legacy-core') return [...groups.core];
  if (mode === 'legacy-integration') return [...groups.integration];
  return allTests;
}

const mode = process.argv[2] ?? 'all';
const targets = getTargets(mode);

if (targets.length === 0) {
  console.error(`未知测试分组: ${mode}`);
  process.exit(1);
}

console.log('\n==> Running typecheck');
const typecheckResult = spawnSync(process.execPath, ['run', 'typecheck'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (typecheckResult.status !== 0) {
  process.exit(typecheckResult.status ?? 1);
}

for (const target of targets) {
  console.log(`\n==> Running ${target}`);
  const result = spawnSync(process.execPath, ['test', target], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`\nSerial ${mode} test run completed.`);
