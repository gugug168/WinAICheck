import type { Scanner, ScanResult } from './types';
import { runPS } from '../executor/index';
import { registerScanner } from './registry';

/** 检查 TEMP 目录所在磁盘剩余空间 */
const scanner: Scanner = {
  id: 'temp-space',
  name: 'TEMP 磁盘空间检测',
  category: 'path',

  async scan(): Promise<ScanResult> {
    const MIN_GB = 10;
    try {
      // 获取 TEMP 所在盘符
      const tempDir = process.env.TEMP || process.env.TMP || 'C:\\Temp';
      const driveLetter = tempDir.charAt(0).toUpperCase();

      const output = runPS(
        `(Get-PSDrive -Name '${driveLetter}' -ErrorAction SilentlyContinue).Free`,
        8000,
      );
      const freeBytes = parseInt(output.trim(), 10);

      if (isNaN(freeBytes)) {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          status: 'unknown',
          message: '无法读取磁盘剩余空间',
        };
      }

      const freeGB = Math.round(freeBytes / (1024 ** 3));

      if (freeGB < MIN_GB) {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          status: 'fail',
          message: `${driveLetter}: 盘剩余空间不足 (${freeGB} GB < ${MIN_GB} GB)`,
          detail: `TEMP 目录: ${tempDir}`,
        };
      }
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `${driveLetter}: 盘剩余空间充足 (${freeGB} GB)`,
      };
    } catch {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法检测 TEMP 磁盘空间',
      };
    }
  },
};

registerScanner(scanner);
