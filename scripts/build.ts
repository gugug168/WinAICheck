import { spawnSync } from 'child_process';

function runRequired(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(`${command} 启动失败: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runOptional(command: string, args: string[], missingMessage: string): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(missingMessage);
      return;
    }
    console.warn(`${command} 启动失败: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    console.warn(`${command} failed (code ${result.status}); exe may be larger than optimal`);
  }
}

runRequired(process.execPath, ['run', 'scripts/prebuild.ts']);
runRequired(process.execPath, ['build', '--compile', '--minify', 'src/main.ts', '--outfile', 'dist/WinAICheck.exe']);
runOptional('upx', ['--best', 'dist/WinAICheck.exe'], 'UPX not found, exe uncompressed. Install: winget install UPX.UPX');
