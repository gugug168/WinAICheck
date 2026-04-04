const groups = {
  core: [
    'tests/calculator-sanitizer.test.ts',
    'tests/fixers.test.ts',
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

type GroupName = keyof typeof groups;

function getTargets(mode: string): string[] {
  if (mode === 'core') return [...groups.core];
  if (mode === 'integration') return [...groups.integration];
  return [...groups.core, ...groups.integration];
}

const mode = process.argv[2] ?? 'all';
const targets = getTargets(mode);

if (targets.length === 0) {
  console.error(`未知测试分组: ${mode}`);
  process.exit(1);
}

for (const target of targets) {
  console.log(`\n==> Running ${target}`);
  const result = Bun.spawnSync([process.execPath, 'test', target], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}

console.log(`\nSerial ${mode} test run completed.`);
