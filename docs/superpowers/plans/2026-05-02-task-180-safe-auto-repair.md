# TASK-180 Safe Auto-Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable WinAICheck to safely execute a limited allowlist of Phase 6 owner repair tasks for Windows L2 fixes, with consent gates, backup/rollback guards, verification, and structured evidence submission.

**Architecture:** Extend the existing owner verification flow in `bin/agent-lite.js` with a new owner-repair decision path that adapts platform `execution_task.kind=owner_repair` payloads into the existing fixer pipeline. Keep the MVP constrained to three allowlisted fixers and normalize evidence/rollback reporting through small type additions rather than introducing a second repair engine.

**Tech Stack:** Bun, TypeScript, WinAICheck agent-lite runtime, fixer registry/pipeline, platform FastAPI verification endpoint compatibility

---

### Task 1: Define owner-repair protocol tests

**Files:**
- Modify: `tests/agent-protocol-v2.test.ts`
- Test: `tests/agent-protocol-v2.test.ts`

- [ ] **Step 1: Add a failing test for blocked L2 repair without consent**

Add a test near the existing owner auto-validation cases that feeds `/status` with one pending owner verification carrying:

- `execution_task.kind = "owner_repair"`
- `execution_task.scanner_id = "powershell-policy"`
- `risk_level = "L2"`
- `consent_state = "required"`
- `automation_mode = "consent_before_repair"`
- `rollback_state = "ready"`

Expected behavior:

- worker daemon does not call local execution
- worker daemon does not submit `/owner-verify`
- output contains a blocked reason mentioning consent

- [ ] **Step 2: Run the new blocked-consent test and verify it fails**

Run:

```powershell
bun test tests/agent-protocol-v2.test.ts --test-name-pattern "blocked without consent"
```

Expected: FAIL because owner-repair routing does not exist yet.

- [ ] **Step 3: Add a failing test for blocked L2 repair when rollback is unavailable**

Add a second test with:

- `execution_task.kind = "owner_repair"`
- `scanner_id = "long-paths"`
- `risk_level = "L2"`
- `consent_state = "granted"`
- `automation_mode = "full_auto_limited"`
- `rollback_state = "unavailable"`

Expected behavior:

- no local execution
- no `/owner-verify` submission
- output contains rollback blocked messaging

- [ ] **Step 4: Run the rollback-gate test and verify it fails**

Run:

```powershell
bun test tests/agent-protocol-v2.test.ts --test-name-pattern "rollback is unavailable"
```

Expected: FAIL because rollback gating for owner repair is not implemented.

- [ ] **Step 5: Add a failing test for successful allowlisted owner repair submission**

Add a third protocol test with:

- `execution_task.kind = "owner_repair"`
- `scanner_id = "powershell-policy"`
- `risk_level = "L2"`
- `consent_state = "granted"`
- `automation_mode = "full_auto_limited"`
- `rollback_state = "ready"`
- current profile targeted

Stub the local repair runner to succeed and assert the submitted `/owner-verify` payload includes:

- `artifacts.owner_repair_mode === true`
- `artifacts.owner_repair_scanner_id === "powershell-policy"`
- `proof_payload.before_context`
- `proof_payload.after_context`
- rollback fields

- [ ] **Step 6: Run the allowlisted owner-repair test and verify it fails**

Run:

```powershell
bun test tests/agent-protocol-v2.test.ts --test-name-pattern "successful allowlisted owner repair"
```

Expected: FAIL because owner-repair payload construction does not exist yet.

- [ ] **Step 7: Commit the test-only red state**

```bash
git add tests/agent-protocol-v2.test.ts
git commit -m "test: define owner repair protocol coverage"
```

### Task 2: Define fixer execution and rollback tests

**Files:**
- Modify: `tests/fixers.test.ts`
- Test: `tests/fixers.test.ts`

- [ ] **Step 1: Add a failing test for allowlisted fixer metadata**

Add a test asserting the owner-repair allowlist contains exactly:

- `powershell-policy`
- `long-paths`
- `firewall-ports`

Expected: the helper or constant does not exist yet.

- [ ] **Step 2: Run the allowlist metadata test and verify it fails**

Run:

```powershell
bun test tests/fixers.test.ts --test-name-pattern "allowlist"
```

Expected: FAIL because the allowlist helper is not defined.

- [ ] **Step 3: Add a failing test for structured execute result metadata**

Add a test for a mocked allowlisted fixer pipeline expecting the returned result to surface:

- backup metadata
- verify state
- rollback state

Expected: current `FixResult` does not expose enough structured fields.

- [ ] **Step 4: Run the structured result test and verify it fails**

Run:

```powershell
bun test tests/fixers.test.ts --test-name-pattern "structured execute result metadata"
```

Expected: FAIL because the result shape is too weak.

- [ ] **Step 5: Add a failing test for rollback-on-execute-failure**

Mock one allowlisted fixer so `execute()` throws and `rollback()` succeeds. Assert the normalized result reports:

- `success === false`
- rollback attempted
- rollback success

- [ ] **Step 6: Run the rollback-on-failure test and verify it fails**

Run:

```powershell
bun test tests/fixers.test.ts --test-name-pattern "rollback-on-execute-failure"
```

Expected: FAIL because rollback metadata is not explicit enough.

- [ ] **Step 7: Commit the fixer red-state tests**

```bash
git add tests/fixers.test.ts
git commit -m "test: define owner repair fixer coverage"
```

### Task 3: Add owner-repair decision and routing in agent-lite

**Files:**
- Modify: `bin/agent-lite.js`
- Test: `tests/agent-protocol-v2.test.ts`

- [ ] **Step 1: Add owner-repair gate helpers**

Implement small helpers in `bin/agent-lite.js` for:

- detecting `execution_task.kind === "owner_repair"`
- checking allowlisted scanner IDs
- checking `risk_level === "L2"`
- checking consent / `full_auto_limited`
- checking rollback readiness

- [ ] **Step 2: Add a local repair executor seam**

Add a function that takes one pending owner task and returns a serializable decision:

- `blocked`
- `ready`

When `ready`, include:

- scanner ID
- selected workdir if any
- evidence seed data

- [ ] **Step 3: Reuse the existing worker owner loop**

Extend `processPendingOwnerVerifications()` so owner-repair items branch away from command-based validation and call the new local repair executor seam.

- [ ] **Step 4: Submit structured owner-repair payloads**

Extend `submitOwnerVerification()` so owner-repair submissions can include:

- repair artifacts
- backup metadata
- rollback status
- before/after scan diff summary

Do not break the existing owner-validation path.

- [ ] **Step 5: Run the three protocol tests**

Run:

```powershell
bun test tests/agent-protocol-v2.test.ts --test-name-pattern "blocked without consent|rollback is unavailable|successful allowlisted owner repair"
```

Expected: PASS

- [ ] **Step 6: Commit the owner-repair routing changes**

```bash
git add bin/agent-lite.js tests/agent-protocol-v2.test.ts
git commit -m "feat: route owner repair tasks through gated local execution"
```

### Task 4: Normalize fixer results for evidence and rollback reporting

**Files:**
- Modify: `src/scanners/types.ts`
- Modify: `src/fixers/index.ts`
- Modify: `src/fixers/registry.ts`
- Modify: `src/fixers/verify.ts`
- Test: `tests/fixers.test.ts`

- [ ] **Step 1: Extend fixer result types with structured repair metadata**

Add only the fields needed for this task, such as:

- backup summary
- rollback attempted
- rollback result
- verification status summary

- [ ] **Step 2: Normalize `executeFix()` results**

Update `src/fixers/index.ts` so all execute paths produce consistent metadata for:

- backup success/failure
- execute success/failure
- rollback attempted/not attempted
- rollback success/failure
- scanner verification pass/warn/fail

- [ ] **Step 3: Add helper lookup only if needed**

If owner-repair code needs a cleaner lookup boundary, add a small helper in `src/fixers/registry.ts`. Do not redesign the registry.

- [ ] **Step 4: Ensure verify output can be serialized cleanly**

If `src/fixers/verify.ts` needs shaping changes for evidence generation, make only those minimal changes.

- [ ] **Step 5: Run the fixer tests**

Run:

```powershell
bun test tests/fixers.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the fixer normalization**

```bash
git add src/scanners/types.ts src/fixers/index.ts src/fixers/registry.ts src/fixers/verify.ts tests/fixers.test.ts
git commit -m "feat: normalize fixer results for owner repair evidence"
```

### Task 5: Regenerate embedded source and verify local build integrity

**Files:**
- Modify: `src/agent/embedded-agent-lite-source.ts`
- Modify: `bin/agent-lite.js`
- Test: generated source sync

- [ ] **Step 1: Regenerate embedded agent source**

Run:

```powershell
bun run scripts/prebuild.ts
```

Expected: regenerated `src/agent/embedded-agent-lite-source.ts`

- [ ] **Step 2: Verify generated source changed only as expected**

Run:

```powershell
git diff -- bin/agent-lite.js src/agent/embedded-agent-lite-source.ts
```

Expected: embedded source reflects the current `agent-lite.js`

- [ ] **Step 3: Build WinAICheck**

Run:

```powershell
bun run build
```

Expected: PASS with updated executable bundle

- [ ] **Step 4: Commit the generated sync**

```bash
git add bin/agent-lite.js src/agent/embedded-agent-lite-source.ts
git commit -m "build: regenerate embedded agent source for owner repair"
```

### Task 6: Verify platform compatibility and patch only if required

**Files:**
- Modify if needed: `E:\aicoevo-platform\server\app\routers\agent_api.py`
- Modify if needed: `E:\aicoevo-platform\docs\API_CONTRACT.md`
- Test: `E:\aicoevo-platform\server\tests\test_agent_api_expanded.py`

- [ ] **Step 1: Check whether current merged platform payload already satisfies WinAICheck**

Inspect the merged payload assumptions against the new Win tests. If all required fields already exist, do not edit platform files.

- [ ] **Step 2: If there is a real gap, add the smallest possible payload field(s)**

Patch only the exact fields needed by the Win client. No unrelated Phase 6 contract changes.

- [ ] **Step 3: Run platform compatibility tests**

Run:

```powershell
cd E:\aicoevo-platform\server
E:\aicoevo-platform\server\venv\Scripts\python.exe -m pytest tests/test_agent_api_expanded.py -q
```

Expected: PASS

- [ ] **Step 4: Commit platform compatibility updates if any**

```bash
git add E:\aicoevo-platform\server\app\routers\agent_api.py E:\aicoevo-platform\docs\API_CONTRACT.md
git commit -m "feat: expose owner repair payload fields for WinAICheck"
```

### Task 7: Document the limited MVP claim

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/plans/tasks/TASK-180-winaicheck-safe-auto-repair.md`
- Modify if needed: `E:\aicoevo-platform\docs\API_CONTRACT.md`

- [ ] **Step 1: Update README with the exact MVP scope**

Document that limited safe auto-repair currently supports only:

- `powershell-policy`
- `long-paths`
- `firewall-ports`

and requires consent / rollback readiness / local verification.

- [ ] **Step 2: Update CHANGELOG**

Add a concise entry describing gated owner repair support and the initial allowlist.

- [ ] **Step 3: Mark TASK-180 status fields accurately**

Update the task doc only when the implementation and verification gates are actually complete.

- [ ] **Step 4: Commit the documentation sync**

```bash
git add README.md CHANGELOG.md docs/plans/tasks/TASK-180-winaicheck-safe-auto-repair.md
git commit -m "docs: record task-180 limited safe auto-repair scope"
```

### Task 8: Final verification and PR preparation

**Files:**
- Verify all changed files

- [ ] **Step 1: Run full WinAICheck verification**

Run:

```powershell
bun test tests/agent-protocol-v2.test.ts
bun test tests/fixers.test.ts
bun run scripts/prebuild.ts
bun run build
```

Expected: all PASS

- [ ] **Step 2: Run platform verification**

Run:

```powershell
cd E:\aicoevo-platform\server
E:\aicoevo-platform\server\venv\Scripts\python.exe -m pytest tests/test_agent_api_expanded.py -q
```

Expected: PASS

- [ ] **Step 3: Review diff scope**

Run:

```powershell
git status --short
git diff --stat origin/main...HEAD
```

Expected: only TASK-180 scoped WinAICheck changes, plus minimal platform contract changes if truly required

- [ ] **Step 4: Prepare PR branch state**

Run:

```bash
git push -u origin task-180-safe-auto-repair
```

Expected: branch published and ready for formal review / PR creation
