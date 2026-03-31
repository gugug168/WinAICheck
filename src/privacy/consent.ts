import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.aicoevo');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface UserConsent {
  shareData: boolean;
  confirmedAt: string;
}

/** 读取用户同意配置 */
export function getConsent(): UserConsent | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/** 保存用户同意配置 */
export function saveConsent(shareData: boolean): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const consent: UserConsent = {
    shareData,
    confirmedAt: new Date().toISOString(),
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(consent, null, 2), 'utf-8');
}

/** 检查是否已确认 */
export function hasConsented(): boolean {
  return getConsent() !== null;
}
