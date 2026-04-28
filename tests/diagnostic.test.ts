import { describe, it, expect, afterEach } from 'bun:test';
import { _diag, _test, runCommand, runReg, runPS } from '../src/executor/index';
import '../src/scanners/index';

describe('_diag diagnostic hooks', () => {
  afterEach(() => {
    _diag.onCommand = undefined;
    _diag.onReg = undefined;
    _diag.onPS = undefined;
    _test.mockExecSync = null;
  });

  it('onCommand 在 runCommand 后被调用', () => {
    let captured: { cmd: string; result: any } | null = null;
    _diag.onCommand = (cmd, result) => { captured = { cmd, result }; };
    _test.mockExecSync = () => Buffer.from('test output');
    runCommand('echo hello', 5000);
    expect(captured).not.toBeNull();
    expect(captured!.cmd).toBe('echo hello');
    expect(captured!.result.exitCode).toBe(0);
    expect(captured!.result.stdout).toBe('test output');
  });

  it('onCommand 能捕获失败命令', () => {
    let captured: { cmd: string; result: any } | null = null;
    _diag.onCommand = (cmd, result) => { captured = { cmd, result }; };
    _test.mockExecSync = () => {
      const err: any = new Error('failed');
      err.status = 1;
      err.stderr = Buffer.from('error');
      throw err;
    };
    runCommand('bad-command', 5000);
    expect(captured).not.toBeNull();
    expect(captured!.result.exitCode).toBe(1);
  });

  it('onReg 在 runReg 后被调用', () => {
    let captured: string | null = null;
    _diag.onReg = (queryPath) => { captured = queryPath; };
    _test.mockExecSync = () => Buffer.from('LongPathsEnabled    REG_DWORD    0x1');
    runReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled');
    expect(captured).toContain('FileSystem');
  });

  it('onPS 在 runPS 后被调用', () => {
    let captured: string | null = null;
    _diag.onPS = (script) => { captured = script; };
    _test.mockExecSync = () => Buffer.from('RemoteSigned');
    runPS('Get-ExecutionPolicy', 5000);
    expect(captured).toBe('Get-ExecutionPolicy');
  });

  it('_diag 和 _test.mockExecSync 共存不冲突', () => {
    let diagCalled = false;
    _diag.onCommand = () => { diagCalled = true; };
    _test.mockExecSync = () => Buffer.from('mocked');
    const result = runCommand('test', 5000);
    expect(diagCalled).toBe(true);
    expect(result.stdout).toBe('mocked');
    expect(result.exitCode).toBe(0);
  });
});

describe('scanWithDiagnostic', () => {
  afterEach(() => {
    _test.mockExecSync = null;
  });

  it('为 git 扫描器捕获决策步骤', async () => {
    _test.mockExecSync = (cmd: string) => {
      if (cmd.includes('git --version')) return Buffer.from('git version 2.45.0');
      if (cmd.includes('net session')) throw Object.assign(new Error(), { status: 1 });
      return Buffer.from('');
    };

    const { scanWithDiagnostic } = await import('../src/scanners/diagnostic');
    const { getScannerById } = await import('../src/scanners/registry');

    const scanner = getScannerById('git')!;
    const { result, diagnostic } = await scanWithDiagnostic(scanner);

    expect(result.status).toBe('pass');
    expect(diagnostic.scannerId).toBe('git');
    expect(diagnostic.steps.length).toBeGreaterThan(0);
    expect(diagnostic.steps[0].action).toBe('command');
    expect(diagnostic.steps[0].input).toContain('git --version');
    expect(diagnostic.finalStatus).toBe('pass');
    expect(diagnostic.environment.os).toBeDefined();
  });
});
