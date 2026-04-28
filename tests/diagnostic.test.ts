import { describe, it, expect, afterEach } from 'bun:test';
import { _diag, _test, runCommand, runReg, runPS } from '../src/executor/index';

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
