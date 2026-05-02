# TASK-180 Safe Auto-Repair Design

## Scope

This design implements `TASK-180: WinAICheck Safe Auto-Repair` on top of the current Phase 6 protocol.

The goal is narrow:

- let WinAICheck consume `execution_task.kind=owner_repair`
- gate L2 auto-repair behind owner targeting, consent/full-auto eligibility, backup, rollback, and local verification
- support an allowlist of 3 tested Windows repair types in the first MVP
- upload structured execution evidence back to the platform

Out of scope:

- Mac parity work, owned by `TASK-190`
- bounty ranking and routing changes, owned by `TASK-200`
- learning / scoring changes, owned by `TASK-210`
- broad fixer refactors outside the needs of this task

## Recommended MVP Repair Allowlist

The first public-safe allowlist will include only fixers that already expose meaningful backup and rollback behavior and can be verified locally:

1. `powershell-policy`
2. `long-paths`
3. `firewall-ports`

These three are a better first slice than installer-heavy fixers because they are:

- already represented by concrete scanner IDs
- stateful enough to prove backup and rollback
- bounded enough to test deterministically
- safer than package-install or driver-change automation

## High-Level Approach

WinAICheck already has a local fixer pipeline with `preflight -> backup -> execute -> verify -> rollback`.

`TASK-180` should not invent a parallel execution engine. It should add an owner-repair adapter in `agent-lite.js` that:

1. reads platform owner task payloads
2. checks whether the incoming task is eligible for local execution
3. maps the task to one allowlisted local fixer
4. captures before-state evidence
5. executes the existing fixer pipeline
6. runs post-repair verification
7. triggers rollback on failure when allowed
8. submits a structured owner verification payload to the platform

This keeps the risk surface small and reuses the existing WinAICheck repair primitives instead of duplicating repair logic in the agent loop.

## Execution Contract

The local owner-repair path will only run when all gates pass:

1. Task targets the local bound owner profile.
2. `execution_task.kind === "owner_repair"`.
3. `risk_level === "L2"`.
4. Consent is granted, or policy is `full_auto_limited` and the exact action is eligible.
5. The selected fixer is in the tested allowlist.
6. Backup data can be produced.
7. Rollback exists, or task is blocked with `rollback_state=unavailable`.
8. A scanner exists for post-repair verification.

If any gate fails, WinAICheck will not execute repair. It will surface a blocked result and submit evidence explaining which gate prevented execution.

## Data Flow

### Input

The existing platform owner task payload already carries:

- `execution_task`
- `automation_mode`
- `consent_state`
- `rollback_state`
- `risk_level`
- owner verification context

If the current payload is missing fields required by the Win client, platform changes should be limited to adding those exact fields in `server/app/routers/agent_api.py` and documenting them in `docs/API_CONTRACT.md`.

### Local Decision

`agent-lite.js` will introduce a dedicated owner-repair decision path:

- reject non-`owner_repair` tasks
- reject non-L2 tasks
- reject unsupported fixer IDs
- reject tasks without local authorization
- reject tasks without backup / rollback / verify readiness

This decision should be explicit and serializable so tests can assert why execution did or did not happen.

### Local Evidence

The repair run should collect:

- task identifiers
- selected scanner/fixer ID
- automation mode
- consent state
- rollback state before execution
- before scan result snapshot
- commands executed
- stdout / stderr captures
- backup metadata and backup ID when available
- execution result
- after scan result snapshot
- before/after diff summary
- rollback attempted: yes/no
- rollback result: success / failed / not_needed / unavailable

### Output

WinAICheck will submit an owner verification payload that preserves current review semantics while attaching structured repair evidence. The platform should be able to store this under the existing verification flow without introducing a new adjudication model.

## Code Changes

### WinAICheck

`bin/agent-lite.js`

- add owner-repair routing from platform task to local repair executor
- add gate evaluation helpers for consent, risk, rollback, allowlist, and profile targeting
- add evidence assembly and submission
- add rollback reporting

`src/agent/embedded-agent-lite-source.ts`

- regenerate after `agent-lite.js` changes

`src/fixers/index.ts`

- expose enough structured result data for owner-repair evidence
- normalize fixer pipeline outputs so blocked / executed / rolled_back states are observable

`src/fixers/registry.ts`

- no behavioral redesign, only helper additions if owner-repair mapping needs explicit lookup guarantees

`src/fixers/verify.ts`

- ensure verification output can be captured in evidence form

`src/scanners/types.ts`

- extend types only if current `FixResult` / backup / verification shapes are too weak for evidence reporting

`tests/agent-protocol-v2.test.ts`

- add protocol-level tests for owner-repair gating and submission payloads

`tests/fixers.test.ts`

- add execution-path tests for the 3 allowlisted L2 repair types, plus rollback behavior

`README.md`, `CHANGELOG.md`

- document the limited MVP allowlist and gating behavior

### Platform

Only modify platform files if WinAICheck cannot complete the flow with current payloads:

- `server/app/routers/agent_api.py`
- `docs/API_CONTRACT.md`

No unrelated platform behavior changes belong in this task.

## Testing Strategy

Implementation will be test-first.

Required tests:

1. L0/L1 validation paths still auto-run and do not enter repair.
2. L2 repair is blocked without consent.
3. L2 repair is blocked when `full_auto_limited` is not eligible.
4. L2 repair is blocked when rollback is unavailable.
5. L2 repair is blocked for non-allowlisted fixers.
6. Each allowlisted repair type can execute through backup -> execute -> verify.
7. Failed execution triggers rollback when available.
8. Owner verification submission includes structured evidence and rollback fields.

Baseline verification commands:

```powershell
cd E:\WinAICheck; bun test tests\agent-protocol-v2.test.ts
cd E:\WinAICheck; bun test tests\fixers.test.ts
cd E:\WinAICheck; bun run scripts/prebuild.ts
cd E:\WinAICheck; bun run build
cd E:\aicoevo-platform\server; E:\aicoevo-platform\server\venv\Scripts\python.exe -m pytest tests/test_agent_api_expanded.py -q
```

## Risks And Mitigations

### Risk 1: Dirty main WinAICheck workspace

Mitigation:

- implement only in the isolated `task-180-safe-auto-repair` worktree
- do not touch the dirty root checkout

### Risk 2: Existing fixers are inconsistent in backup/rollback semantics

Mitigation:

- restrict MVP to the 3 fixers with acceptable rollback shape
- normalize result reporting instead of trying to perfect every fixer now

### Risk 3: Payload mismatch between platform and WinAICheck

Mitigation:

- first implement against existing platform payload from merged `TASK-160` and `TASK-170`
- only add minimal contract fields if tests prove the gap

### Risk 4: Over-claiming public capability

Mitigation:

- document clearly that only the tested allowlist is eligible for limited safe auto-repair in MVP

## Acceptance Interpretation

`TASK-180` is done only when all of these are true:

- WinAICheck can safely consume owner repair tasks for the 3 allowlisted L2 repair types
- blocked states are explicit and tested
- rollback behavior is explicit and tested
- evidence submission is structured and tested
- generated embedded source is synchronized
- docs and contract reflect the true MVP scope

## Implementation Shape

The implementation should proceed in 4 small batches:

1. tests for gates and protocol payloads
2. agent-lite owner-repair adapter
3. fixer/evidence normalization
4. docs + contract sync

That keeps the diff reviewable and makes it easy to catch safety regressions before repair execution is enabled.
