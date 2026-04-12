# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WinAICheck is a Windows AI development environment diagnostic and repair tool. It scans 37+ system dimensions, generates a 0-100 weighted score, provides automated fixes with backup/rollback, and uploads results to [aicoevo.net](https://aicoevo.net) for community-driven recommendations.

Built with **Bun + TypeScript**. Distributed as a single `.exe` or via npm (`npx winaicheck`). npm 入口智能检测：有 Bun + 源码存在时直接运行源码，节省下载时间；无 Bun 时下载 exe。可选安装 agent 插件：`npx winaicheck-agent`。

## Commands

```bash
bun run dev                    # Web UI mode (opens browser, default port 3000)
bun run dev:cli                # CLI terminal mode
bun run build                  # Compile to dist/WinAICheck.exe
bun test                       # Run all tests (bun test runner)
bun run test:core              # Core tests only (calculator, fixers, uploader)
bun run test:integration       # Integration tests (scanners, scoring e2e, SSE)
bun run test:all               # Serial execution of all test groups
```

Build uses `bun build --compile` to produce a single Windows executable.

## Architecture

### Scanner System (self-registration)

Each scanner in `src/scanners/` implements the `Scanner` interface and calls `registerScanner()` at module bottom. Import side-effects in `src/scanners/index.ts` trigger registration.

`runAllScanners(limit=5, onProgress)` executes scanners concurrently with configurable parallelism.

Categories and weights: `path` (1.5), `permission` (1.2), `toolchain` (1.0), `network` (1.0), `gpu` (0.8).

### Fixer System (backup → execute → rollback)

Each fixer in `src/fixers/` implements: `backup()` → `execute()` → optional `rollback()`. Fixers are paired with scanners by `scannerId`.

Risk tiers determine UI presentation:
- **green**: one-click auto-fix (mirror config, execution policy)
- **yellow**: confirm required (tool installation via winget)
- **red**: manual guidance only (BIOS settings, username path)
- **black**: informational (VRAM notes)

After execute, the scanner re-runs to verify. On failure, backup data auto-restores.

### Scoring (`src/scoring/`)

`weightedScore = sum(pass_rate_per_category × weight) / sum(weights) × 100`. `unknown` status and optional tools (`affectsScore: false`) excluded from denominator. Grades: 90+ excellent, 70+ good, 50+ fair, <50 poor.

### Web UI (`src/web/ui.ts`)

Single-page app served by `Bun.serve`. SSE streams real-time scan progress. API endpoints:
- `POST /api/scan` — streaming scan (SSE)
- `POST /api/fix` — execute fixer
- `POST /api/install` — install AI tools (Claude Code, OpenClaw, CCSwitch)
- `POST /api/scan-one` — re-scan single item
- `GET /api/history` — local scan history

### Privacy & Upload (`src/privacy/`)

`src/privacy/sanitizer.ts` strips API keys, tokens, usernames, IPs, emails before upload.
`src/privacy/uploader.ts` handles stash/claim flow: POST to `/api/v1/stash` → get token → open browser to `aicoevo.net/claim?t=TOKEN`. Upload consent stored in `~/.aicoevo/config.json`.

### Command Executor (`src/executor/`)

`runCommand(cmd, timeout)`, `runPS(script)` for PowerShell, `runReg(query)` for registry reads. UTF-16LE decoding for WSL output. Test hooks via `_test.mockExecSync`.

## Key Types

```typescript
// src/scanners/types.ts
type ScannerCategory = 'path' | 'permission' | 'toolchain' | 'network' | 'gpu';
type ScanStatus = 'pass' | 'fail' | 'warn' | 'unknown';
interface ScanResult { id: string; name: string; category: ScannerCategory; status: ScanStatus; message: string; affectsScore?: boolean; }
interface Scanner { id: string; name: string; category: ScannerCategory; scan(): Promise<ScanResult>; }

// src/fixers/index.ts
interface Fixer { scannerId: string; getFix(result): FixSuggestion; backup?(result): Promise<BackupData>; execute(fix, backup): Promise<FixResult>; rollback?(backup): Promise<void>; }
```

## Test Patterns

Tests use `createCommandMock()` from `tests/integration/mock-helper.ts` to mock shell commands. Environment injection via `withEnv()`. Scanner integration tests grouped by category in `tests/integration/`.

## Conventions

- TypeScript strict mode, ES2022 target, ESNext modules
- Scanner/Fixer IDs use kebab-case (e.g., `mirror-sources`, `gpu-driver`)
- All user-facing messages in Chinese
- Conventional Commits: `feat:`, `fix:`, `chore:`, `release:`
- CI via GitHub Actions: type check → build → test on Windows
- Release: update version → commit → tag → push --tags → npm publish
