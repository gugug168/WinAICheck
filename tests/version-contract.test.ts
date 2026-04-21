import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from '../package.json';
import { APP_NAME, VERSION } from '../src/constants';

const repoRoot = path.resolve(import.meta.dir, '..');
const releaseVersion = readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();

describe('version contract', () => {
  test('constants match release metadata', () => {
    expect(APP_NAME).toBe('WinAICheck');
    expect(VERSION).toBe(pkg.version);
    expect(releaseVersion).toBe(pkg.version);
  });
});
