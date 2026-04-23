# Skill Command Dispatch And HK IPO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic skill-owned slash-command dispatch, ship `stock-analysis-skill` `/hkipo` plus `/cnipo` placeholder support, and fix Feishu completed reply rendering.

**Architecture:** `cli-claw` keeps built-in command routing first, then falls through to a generic skill-command layer that discovers enabled workspace/user skills, executes declared commands over stdin/stdout JSON, and appends those commands to dynamic help. `stock-analysis-skill` owns all IPO-specific discovery/report logic. Feishu final rendering is fixed by tightening answer/commentary separation and aligning completed-card markdown normalization with the streaming presentation contract.

**Tech Stack:** TypeScript, Vitest, Node `execFile`, Python 3, markdown-based Feishu cards.

---

### Task 1: Add failing tests for skill command discovery and dispatch

**Files:**
- Modify: `tests/im-slash-command.test.ts`
- Create: `tests/skill-command-dispatch.test.ts`
- Create: `tests/web-slash-command.test.ts`

- [ ] **Step 1: Write failing discovery/dispatch tests**
- [ ] **Step 2: Run dispatch-related tests to verify failures**
- [ ] **Step 3: Implement the minimal discovery/dispatch code**
- [ ] **Step 4: Re-run dispatch-related tests to verify they pass**

### Task 2: Wire IM/Web help and slash routing into skill command dispatch

**Files:**
- Modify: `src/index.ts`
- Modify: `src/web.ts`
- Modify: `tests/runtime-command-registry.test.ts`

- [ ] **Step 1: Add failing help-output expectations for skill commands**
- [ ] **Step 2: Run help tests to verify failures**
- [ ] **Step 3: Implement help append + IM/Web fallback routing**
- [ ] **Step 4: Re-run the updated help/dispatch tests**

### Task 3: Fix Feishu final reply visibility and final-card markdown compaction

**Files:**
- Modify: `src/reply-visibility.ts`
- Modify: `src/index.ts`
- Modify: `src/feishu-markdown-style.ts`
- Modify: `src/feishu-streaming-card.ts`
- Modify: `tests/reply-visibility.test.ts`
- Modify: `tests/feishu-markdown-style.test.ts`
- Modify: `tests/feishu-streaming-card.test.ts`
- Modify: `tests/feishu-connection.test.ts`

- [ ] **Step 1: Add failing regression tests for commentary leakage and completed-card spacing**
- [ ] **Step 2: Run the Feishu/reply tests to verify failures**
- [ ] **Step 3: Implement the minimal reply/card fixes**
- [ ] **Step 4: Re-run the Feishu/reply tests**

### Task 4: Add stock-analysis-skill command manifests and executors

**Files:**
- Modify: `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- Create: `/Users/ryan/projects/stock-analysis-skill/commands.json`
- Create: `/Users/ryan/projects/stock-analysis-skill/commands/hkipo.py`
- Create: `/Users/ryan/projects/stock-analysis-skill/commands/cnipo.py`
- Create: `/Users/ryan/projects/stock-analysis-skill/tests/test_skill_commands.py`

- [ ] **Step 1: Add failing executor tests for `/hkipo` and `/cnipo`**
- [ ] **Step 2: Run skill tests to verify failures**
- [ ] **Step 3: Implement manifest + executors**
- [ ] **Step 4: Re-run skill tests**

### Task 5: Sync docs, validate, review, commit

**Files:**
- Modify: `docs/COMMAND.md`
- Modify: `docs/MODULE.md`
- Modify: `PLANS/ACTIVE.md`

- [ ] **Step 1: Update owner docs for skill-command routing and new module**
- [ ] **Step 2: Run milestone validation commands**
- [ ] **Step 3: Run review gate and inspect diff**
- [ ] **Step 4: Update active plan statuses and handoff**
- [ ] **Step 5: Commit with a focused English message**
