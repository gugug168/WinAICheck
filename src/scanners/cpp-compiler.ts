import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 C/C++ 编译器 */
const scanner: Scanner = {
  id: 'cpp-compiler',
  name: 'C/C++ 编译器检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    // 先检查 MSVC cl.exe
    const cl = runCommand('cl.exe 2>&1', 3000);
    if (cl.exitCode === 0 || cl.stderr.includes('Microsoft')) {
      const verMatch = cl.stdout.match(/(\d+\.\d+\.\d+)/) || cl.stderr.match(/(\d+\.\d+\.\d+)/);
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `MSVC 编译器可用${verMatch ? ` (${verMatch[1]})` : ''}`,
      };
    }

    // 再检查 GCC
    const gcc = runCommand('gcc --version', 3000);
    if (gcc.exitCode === 0) {
      const verMatch = gcc.stdout.match(/(\d+\.\d+\.\d+)/);
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `GCC 可用${verMatch ? ` (${verMatch[1]})` : ''}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'fail',
      message: '未检测到 C/C++ 编译器（MSVC 或 GCC）',
      detail: '部分 Python 包需要编译器支持',
    };
  },
};

registerScanner(scanner);
