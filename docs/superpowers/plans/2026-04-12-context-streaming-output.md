# Context And Streaming Output Optimization Implementation Plan

> **For agentic workers:** Execute inline in the current session. The user explicitly requested no subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce token-heavy continuation context and improve Feishu streaming/tool-step readability.

**Architecture:** Add small helpers at the existing boundaries: compact messages before agent prompt construction, normalize Markdown before Feishu CardKit streaming, and add emoji in the shared tool-step formatter.

**Tech Stack:** TypeScript, Vitest, existing Feishu CardKit streaming code, shared build via `tsc`.

---

### Task 1: Compact continuation context

**Files:**
- Create: `src/context-compaction.ts`
- Modify: `src/index.ts`
- Test: `tests/context-compaction.test.ts`

- [x] **Step 1: Write failing tests**

Expected coverage:
- recovery context keeps chronological order, caps message count, truncates long content, and avoids raw 500-char history blocks.
- pending message selection keeps the newest messages within count and total character limits.

Run: `npm test -- tests/context-compaction.test.ts`

- [x] **Step 2: Implement helper**

Add:
- `buildRecoveryContext(messages, options)`
- `compactMessagesForAgent(messages, options)`

- [x] **Step 3: Wire helper**

Use `buildRecoveryContext()` in the restart recovery block and `compactMessagesForAgent()` before active runner IPC injection.

- [x] **Step 4: Validate**

Run:
- `npm test -- tests/context-compaction.test.ts`
- `npm run build:backend`

### Task 2: Improve Feishu streaming and tool steps

**Files:**
- Modify: `shared/tool-step-display.ts`
- Modify: `src/feishu-markdown-style.ts`
- Modify: `src/feishu-streaming-card.ts`
- Test: `tests/tool-step-display.test.ts`
- Test: `tests/feishu-streaming-card.test.ts`
- Test: `tests/feishu-markdown-style.test.ts`

- [x] **Step 1: Write failing tests**

Expected coverage:
- `formatToolStepLine('exec_command', 'npm test')` starts with an emoji.
- streaming Markdown adds spacing around headings/lists/rules.
- fenced code blocks remain unchanged.

Run: `npm test -- tests/tool-step-display.test.ts tests/feishu-markdown-style.test.ts`

- [x] **Step 2: Implement and wire**

Add emoji mapping in shared formatter, add `normalizeStreamingMarkdown()`, and call it before `cardElement.content()`.

- [x] **Step 3: Validate**

Run:
- `npm run build:shared`
- `npm test -- tests/tool-step-display.test.ts tests/feishu-streaming-card.test.ts tests/feishu-markdown-style.test.ts`
- `npm run build:backend`
- `./scripts/review.sh`

Result:
- Passed.

### Task 3: Cut stale pending history after long gaps

**Files:**
- Modify: `src/context-compaction.ts`
- Modify: `src/index.ts`
- Test: `tests/context-compaction.test.ts`

- [x] **Step 1: Write failing tests**

Expected coverage:
- pending messages split by a gap longer than 2 hours keep only the newest contiguous segment.
- compacting still applies after stale history is removed.
- invalid/missing timestamps keep existing safe behavior instead of dropping messages.

Run: `npm test -- tests/context-compaction.test.ts`

- [x] **Step 2: Implement helper**

Add `selectRecentTurnMessages(messages, options)` in `src/context-compaction.ts`.

- [x] **Step 3: Wire helper**

Use `selectRecentTurnMessages()` before `compactMessagesForAgent()` in both normal prompt construction and active runner IPC injection.

- [x] **Step 4: Validate**

Run:
- `npm test -- tests/context-compaction.test.ts`
- `npm run build:backend`
- `./scripts/review.sh`

Result:
- Passed.
