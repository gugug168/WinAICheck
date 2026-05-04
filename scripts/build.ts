/**
 * Build script: compiles WinAICheck into a standalone .exe
 *
 * - Embeds Windows VERSIONINFO metadata (title, publisher, version, copyright)
 *   to reduce antivirus false positives
 * - UPX removed due to triggering AV heuristics (360, Defender, etc.)
 */
import { readFileSync } from 'fs';

function runRequired(command: string, args: string[]): void {
  const result = Bun.spawnSync([command, ...args], {
    cwd: process.cwd(),
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  if (result.error) {
    console.error(`${command} 启动失败: ${result.error.message}`);
    process.exit(1);
  }

  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}

// Step 1: prebuild (stub react-devtools-core, embed agent-lite)
runRequired(process.execPath, ['run', 'scripts/prebuild.ts']);

// Step 2: read version
const version = readFileSync('VERSION', 'utf-8').trim();
console.log(`Building WinAICheck v${version}...`);

// Step 3: compile with Windows metadata
const result = await Bun.build({
  entrypoints: ['src/main.ts'],
  compile: {
    outfile: 'dist/WinAICheck.exe',
    windows: {
      title: 'WinAICheck',
      publisher: 'AICOEVO',
      version,
      description: 'AI-powered Windows PC diagnostic and optimization scanner',
      copyright: `Copyright ${new Date().getFullYear()} AICOEVO. All rights reserved.`,
    },
  },
  minify: true,
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

console.log(`Built: ${result.outputs[0].path}`);
