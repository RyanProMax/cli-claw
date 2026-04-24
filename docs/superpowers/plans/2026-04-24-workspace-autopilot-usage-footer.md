# Workspace Autopilot And Usage-Aware Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-scoped proactive mode plus usage-aware reply footers without introducing a second immortal runner lifecycle.

**Architecture:** Reuse existing workspace/session execution for proactive turns by managing a single group-context scheduled task per workspace. Centralize runtime usage lookup and attach quota remaining to footer metadata so text and Feishu card footers share the same formatting rules.

**Tech Stack:** TypeScript, Vitest, Hono runtime command plumbing, existing scheduler/group queue infrastructure.

---

### Task 1: Lock footer behavior with tests

**Files:**
- Modify: `tests/assistant-meta-footer.test.ts`
- Modify: `tests/feishu-streaming-card.test.ts`

- [ ] **Step 1: Write failing footer-format tests**

Add assertions that:
- base footer remains visible without remaining quota info when quota is healthy
- remaining quota is appended only when primary remaining is below 30%
- text and card footer formatting stay aligned

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts`

- [ ] **Step 3: Implement shared footer formatting changes**

Update the shared footer formatter so:
- meta footer includes `AgentType`
- token/cost footer fields are replaced by conditional remaining usage fields
- remaining fields render only when `primaryRemainingPct < 30`

- [ ] **Step 4: Re-run focused tests**

Run: `npm test -- tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts`

- [ ] **Step 5: Keep the diff isolated**

Run: `git diff -- shared/assistant-meta-footer.ts src/assistant-meta-footer.ts src/feishu-streaming-card.ts tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts`

### Task 2: Attach runtime usage snapshots to outbound reply metadata

**Files:**
- Create: `src/runtime-usage.ts`
- Modify: `src/index.ts`
- Modify: `src/usage-command.ts`
- Modify: `src/claude-oauth-usage.ts`
- Create: `tests/runtime-usage.test.ts`
- Modify: `tests/usage-command.test.ts`

- [ ] **Step 1: Write failing usage snapshot tests where needed**

Add or extend tests so the shared runtime usage helper can normalize Codex and Claude usage snapshots into the footer metadata shape.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- tests/usage-command.test.ts`

- [ ] **Step 3: Implement shared runtime usage helper**

Add a helper that resolves the active runtime’s current usage snapshot and converts it into footer-ready remaining percentages.

- [ ] **Step 4: Attach usage metadata before outbound send/finalize**

Update the outbound reply path and streaming-card completion path so final reply metadata includes the current remaining percentages.

- [ ] **Step 5: Re-run focused tests**

Run: `npm test -- tests/usage-command.test.ts tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts`

### Task 3: Add workspace autopilot management and runtime commands

**Files:**
- Create: `src/workspace-autopilot.ts`
- Modify: `shared/runtime-command-registry.ts`
- Modify: `src/runtime-command-handler.ts`
- Modify: `src/index.ts`
- Modify: `src/task-scheduler.ts`
- Modify: `src/db.ts`
- Modify: `src/types.ts`
- Modify: `tests/runtime-command-registry.test.ts`
- Modify: `tests/runtime-command-handler.test.ts`
- Create: `tests/workspace-autopilot.test.ts`

- [ ] **Step 1: Write failing command/autopilot tests**

Cover:
- `/autopilot on`
- `/autopilot off`
- `/autopilot status`
- scheduler pause when `5h remaining < 20%`

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- tests/runtime-command-registry.test.ts tests/runtime-command-handler.test.ts tests/workspace-autopilot.test.ts`

- [ ] **Step 3: Implement workspace autopilot manager**

Use a single system-managed scheduled task ID per workspace, configured for `context_mode: 'group'`, and add helpers to create, find, pause, resume, and describe that task.

- [ ] **Step 4: Enforce quota-aware pause in scheduler/runtime command flow**

Pause proactive tasks when the current runtime 5h remaining is below 20%. Manual user messages must continue to work.

- [ ] **Step 5: Re-run focused tests**

Run: `npm test -- tests/runtime-command-registry.test.ts tests/runtime-command-handler.test.ts tests/workspace-autopilot.test.ts`

### Task 4: Documentation and final verification

**Files:**
- Modify: `docs/COMMAND.md`
- Modify: `docs/MODULE.md`
- Modify: `PLANS/ACTIVE.md`

- [ ] **Step 1: Update command/module docs**

Document the new `/autopilot` runtime command and where workspace autopilot lives in the codebase.

- [ ] **Step 2: Run milestone validation**

Run: `npm test -- tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts tests/usage-command.test.ts tests/runtime-command-registry.test.ts tests/runtime-command-handler.test.ts tests/workspace-autopilot.test.ts`

- [ ] **Step 3: Run repo hygiene check**

Run: `git diff --check`

- [ ] **Step 4: Review final scope against requirements**

Verify:
- base footer always shown
- remaining shown only below 30%
- proactive mode pauses below 20% 5h remaining
- proactive mode reuses workspace execution instead of a new immortal runner
