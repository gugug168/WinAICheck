import { describe, test, expect, afterEach } from 'bun:test';
import { _test } from '../../src/executor/index';
import { createCommandMock, teardownMock, type MockResponse } from './mock-helper';

import '../../src/scanners/index';
import { getScannerById } from '../../src/scanners/registry';

function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

describe('gpu-driver scanner', () => {
  afterEach(teardownMock);

  test('无 NVIDIA → unknown', async () => {
    setupMock(new Map([
      ['nvidia-smi --query-gpu=name,driver_version --format=csv,noheader', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('gpu-driver')!;
    const result = await scanner.scan();
    expect(result.status).toBe('unknown');
    expect(result.message).toContain('NVIDIA');
  });

  test('驱动过旧 (<525) → warn', async () => {
    setupMock(new Map([
      ['nvidia-smi --query-gpu=name,driver_version --format=csv,noheader', {
        stdout: 'NVIDIA GeForce RTX 3060, 470.50',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('gpu-driver')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('较旧');
  });

  test('正常驱动 → pass', async () => {
    setupMock(new Map([
      ['nvidia-smi --query-gpu=name,driver_version --format=csv,noheader', {
        stdout: 'NVIDIA GeForce RTX 4090, 535.104',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('gpu-driver')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('正常');
  });
});

describe('cuda-version scanner', () => {
  afterEach(teardownMock);

  test('无 CUDA → unknown', async () => {
    setupMock(new Map([
      ['nvcc --version', { exitCode: 1 }],
      ['nvidia-smi', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('cuda-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('unknown');
    expect(result.message).toContain('Toolkit');
  });

  test('CUDA Toolkit 已安装 → pass', async () => {
    setupMock(new Map([
      ['nvcc --version', {
        stdout: 'Cuda compilation tools, release 11.8, V11.8.89',
        exitCode: 0,
      }],
      ['nvidia-smi --query-gpu=driver_version --format=csv,noheader', {
        stdout: '535.104',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('cuda-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('11.8');
  });

  test('驱动支持 CUDA 但未安装 Toolkit → warn', async () => {
    setupMock(new Map([
      ['nvcc --version', { exitCode: 1 }],
      ['nvidia-smi', {
        stdout: '| NVIDIA-SMI 535.104   Driver Version: 535.104   CUDA Version: 12.2 |',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('cuda-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Toolkit 未安装');
  });
});

describe('virtualization scanner', () => {
  afterEach(teardownMock);

  test('WSL2 可用 → pass', async () => {
    setupMock(new Map([
      ['wsl --status', {
        stdout: '默认版本: 2\n默认分发: Ubuntu-24.04',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('virtualization')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('WSL2');
  });

  test('BIOS 未启用虚拟化 → warn', async () => {
    setupMock(new Map([
      ['wsl --status', { exitCode: 1 }],
      ['systeminfo', {
        stdout: 'Virtualization Enabled In Firmware: No',
        exitCode: 0,
      }],
      ['powershell -Command "(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty VirtualizationFirmwareEnabled)"', {
        stdout: 'False',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('virtualization')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('BIOS');
  });

  test('固件已启用 → pass', async () => {
    setupMock(new Map([
      ['wsl --status', { exitCode: 1 }],
      ['systeminfo', {
        stdout: 'Virtualization Enabled In Firmware: Yes',
        exitCode: 0,
      }],
      ['powershell -Command "(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty VirtualizationFirmwareEnabled)"', {
        stdout: 'True',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('virtualization')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('查询失败 → unknown', async () => {
    setupMock(new Map([
      ['wsl --status', { exitCode: 1 }],
      ['systeminfo', { exitCode: 1 }],
      ['powershell -Command "(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty VirtualizationFirmwareEnabled)"', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('virtualization')!;
    const result = await scanner.scan();
    expect(result.status).toBe('unknown');
  });
});

describe('wsl-version scanner', () => {
  afterEach(teardownMock);

  test('WSL2 → pass', async () => {
    setupMock(new Map([
      ['wsl --status', {
        stdout: '默认版本: 2\n默认分发: Ubuntu-24.04\n内核版本: 5.15.0',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('wsl-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('WSL1 → warn', async () => {
    setupMock(new Map([
      ['wsl --status', {
        stdout: '默认版本: 1\n默认分发: Ubuntu',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('wsl-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('WSL1');
  });

  test('未安装 → warn', async () => {
    setupMock(new Map([
      ['wsl --status', { exitCode: 1 }],
    ]));
    const scanner = getScannerById('wsl-version')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('未安装');
  });
});

describe('vram-usage scanner', () => {
  afterEach(teardownMock);

  test('显存正常 → pass', async () => {
    setupMock(new Map([
      ['nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', {
        stdout: '4096, 16384',
        exitCode: 0,
      }],
      ['nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv,noheader', {
        stdout: '',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('vram-usage')!;
    const result = await scanner.scan();
    expect(result.status).toBe('pass');
  });

  test('显存占用高 (>90%) → warn', async () => {
    setupMock(new Map([
      ['nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', {
        stdout: '15000, 16384',
        exitCode: 0,
      }],
      ['nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv,noheader', {
        stdout: '1234, python.exe, 14000 MiB',
        exitCode: 0,
      }],
    ]));
    const scanner = getScannerById('vram-usage')!;
    const result = await scanner.scan();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('90%');
  });

  test('无 GPU → unknown', async () => {
    setupMock(new Map([
      ['nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', {
        exitCode: 1,
      }],
    ]));
    const scanner = getScannerById('vram-usage')!;
    const result = await scanner.scan();
    expect(result.status).toBe('unknown');
  });
});
