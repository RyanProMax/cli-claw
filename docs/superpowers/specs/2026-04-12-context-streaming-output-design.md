# Context And Streaming Output Optimization Design

## Problem

- Restart recovery currently injects recent history as raw `<system_context>`, which can repeat long prior task context and waste tokens.
- Active runner continuation sends all pending messages since the last agent cursor, so a long burst can be forwarded unbounded.
- Feishu streaming pushes raw Markdown through CardKit, while final cards run Markdown optimization; streaming output can visually collapse.
- Tool step lines are plain text and do not match runclaw-style visual status cues.

## Design

1. Add `src/context-compaction.ts` with two helpers:
   - `buildRecoveryContext()` formats a compact restart context with configurable message count and per-message character caps.
   - `selectPendingMessagesForAgent()` keeps the latest pending messages within count and total character limits.
2. Keep the existing `<messages>` XML protocol. Compacting happens before `formatMessages()`, not inside XML escaping.
3. Add `normalizeStreamingMarkdown()` in `src/feishu-markdown-style.ts`.
   - Protect fenced code blocks.
   - Add blank lines around headings, bullets, ordered lists, and horizontal rules.
   - Compress excessive blank lines.
4. Apply streaming normalization only in `FeishuStreamingBackend.streamContent()` before `cardElement.content()`.
5. Add emoji in `shared/tool-step-display.ts` based on common tool names, with a safe default for unknown tools.

## Non-Goals

- No subagent workflow changes.
- No database schema changes.
- No model prompt rewrite beyond recovery context formatting.
- No change to final assistant answer style beyond this task's concise reporting.

## Validation

- Context compaction unit tests prove caps and chronological ordering.
- Streaming Markdown tests prove spacing is improved without altering code blocks.
- Tool display tests prove emoji prefixes.
- Existing Feishu streaming card tests stay green.
