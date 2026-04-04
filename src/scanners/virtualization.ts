import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测虚拟化支持状态 */
const scanner: Scanner = {
  id: 'virtualization',
  name: '虚拟化支持检测',
  category: 'gpu',

  async scan(): Promise<ScanResult> {
    const wsl = runCommand('wsl --status', 8000);
    if (wsl.exitCode === 0 && /默认版本:\s*2|default version:\s*2/i.test(wsl.stdout)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: '虚拟化可用（WSL2 已正常工作）',
      };
    }

    const systemInfo = runCommand('systeminfo', 12000);
    const firmwareFlag = runCommand(
      'powershell -Command "(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty VirtualizationFirmwareEnabled)"',
      8000,
    );

    const systemOutput = systemInfo.stdout;
    const firmwareEnabled = /Virtualization Enabled In Firmware:\s*Yes|固件中已启用虚拟化:\s*是/i.test(systemOutput)
      || /^true$/i.test(firmwareFlag.stdout.trim());
    const firmwareDisabled = /Virtualization Enabled In Firmware:\s*No|固件中已启用虚拟化:\s*否/i.test(systemOutput)
      || /^false$/i.test(firmwareFlag.stdout.trim());

    if (firmwareEnabled) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: 'CPU/BIOS 虚拟化已启用',
      };
    }

    if (firmwareDisabled) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'BIOS/UEFI 中的虚拟化未启用',
        detail: '请在 BIOS/UEFI 中启用 Intel VT-x / AMD-V；如需 WSL2 或 Docker，再启用对应 Windows 功能。',
      };
    }

    if (systemInfo.exitCode !== 0 && firmwareFlag.exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法检测虚拟化状态',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'unknown',
      message: '无法确认虚拟化是否已启用',
    };
  },
};

registerScanner(scanner);
