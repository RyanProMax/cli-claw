# `/usage` Command Design

## Goal

Add an IM-only `/usage` slash command in cli-claw that returns quota snapshots for both Codex and Claude without routing the request into an agent conversation.

## Scope

In scope:
- Add `/usage` to the IM slash-command registry and local command dispatch.
- Return both Codex and Claude quota summaries in one reply.
- Read Codex usage from local Codex session files.
- Read Claude usage from the existing OAuth usage API path when available.
- Degrade gracefully when one side is unavailable.
- Add tests and command documentation for the new command.

Out of scope:
- Web support.
- Background polling or long-lived caching for Codex usage.
- Runner changes.
- Claude CLI text scraping fallback.
- Support for additional providers such as Copilot or Gemini.

## User-Facing Behavior

`/usage` is available only in IM, at the same level as `/status`.

When invoked, the command returns a single local reply with two sections:

1. Codex usage
2. Claude usage

Each section should include:
- availability status
- 5-hour window remaining percentage
- 7-day or weekly remaining percentage
- reset time
- data source

If one provider cannot be queried, the command still succeeds and marks that provider as unavailable with a concrete reason.

## Requirements

### Command semantics

- `/usage` must be recognized as a first-class IM slash command.
- Unknown-command handling must remain unchanged.
- The command must not be forwarded to the active agent.
- The command should not depend on the current workspace runtime; it always reports both providers.

### Codex data source

- Source of truth is the latest `token_count` event with `rate_limits` in `~/.codex/sessions/**/*.jsonl`.
- The implementation should scan recent session files and select the newest usable snapshot.
- Primary window is the 300-minute bucket.
- Secondary window is the 10080-minute bucket.
- Remaining percentage is derived as `100 - used_percent`.
- Reset time is derived from the reported epoch timestamp.

### Claude data source

- Source of truth is the existing Claude OAuth usage fetch path already present in the backend.
- Use the currently enabled Claude provider if and only if it has OAuth credentials.
- Preferred buckets are:
  - `five_hour`
  - `seven_day`
- If the active Claude provider is not OAuth-backed, return unavailable instead of guessing or scraping CLI output.

### Output formatting

- Keep the response compact enough for Feishu text replies.
- Use stable labels so tests can assert exact fields.
- Include the data source explicitly:
  - `local ~/.codex/sessions`
  - `Claude OAuth API`
- Show unavailable reasons inline, for example:
  - `未启用 Claude OAuth provider`
  - `未找到 Codex usage snapshot`

## Architecture

`/usage` stays in the local IM slash-command layer, parallel to `/status`, and delegates all quota gathering to a small backend usage service. That service aggregates two adapters: a Codex local-session adapter and a Claude OAuth adapter, then returns a normalized snapshot for reply formatting.

This keeps command dispatch, data retrieval, and text formatting separate. It also limits change scope to command plumbing plus one new quota-aggregation module instead of spreading provider-specific parsing through `src/index.ts`.

## Approach selection

Three implementation options were considered:

1. Stable dual-source aggregation
2. Add Claude CLI scraping fallback
3. Build a generic provider-monitor framework first

Selected option: stable dual-source aggregation.

Reasoning:
- It matches the repository's current abstractions.
- It is testable without UI or runner coupling.
- It avoids binding the backend to undocumented web or CLI text contracts.
- It delivers the requested user value now without widening scope.

## Proposed structure

### Registry and dispatch

- Add `/usage` as IM-only in `shared/runtime-command-registry.ts`.
- Update `/help` and command docs automatically via the shared registry and `docs/COMMAND.md`.
- Add a new IM local handler branch in `src/index.ts`, parallel to `/status`.

### Usage service

Create a dedicated backend module responsible for local quota aggregation. It should expose a small surface such as:

- `getCodexUsageSnapshot()`
- `getClaudeUsageSnapshot()`
- `buildUsageReply()`

This keeps parsing and formatting logic out of the main IM command switch.

### Codex parser

The Codex parser should:

- resolve the Codex sessions root from the current user home
- enumerate recent session files
- read them newest-first
- parse JSONL safely line by line
- keep the newest event containing `payload.type === "token_count"` and `payload.rate_limits`
- normalize the `primary` and `secondary` windows into a stable internal shape

This is intentionally snapshot-based rather than cumulative analytics. We only need the latest quota state, not a billing report.

### Claude adapter

The Claude adapter should reuse the existing backend OAuth usage retrieval path rather than duplicating HTTP logic.

Normalization should map:

- `five_hour` to the 5-hour response bucket
- `seven_day` to the weekly response bucket

If no enabled OAuth-backed provider exists, the adapter returns an unavailable result with a reason string.

## Reply shape

The exact text can still be refined during implementation, but it should follow this structure:

```text
📈 用量查询
━━━━━━━━━━
Codex
- 5h 剩余: 39%
- 7d 剩余: 46%
- 重置时间: 2026-04-10 11:30
- 数据源: local ~/.codex/sessions

Claude
- 5h 剩余: unavailable
- 7d 剩余: unavailable
- 原因: 未启用 Claude OAuth provider
- 数据源: Claude OAuth API
```

Formatting details:
- Use local time formatting consistent with other IM replies.
- Avoid markdown tables.
- Prefer one stable shape for both success and partial-failure cases.

## Error handling

- Missing Codex directory: unavailable, not fatal.
- Malformed JSONL line: skip the line and continue.
- No usable Codex snapshot: unavailable.
- Claude usage API failure: unavailable with returned error message where safe.
- One provider failing must not suppress the other provider's output.

## Testing strategy

Tests should cover:

- registry visibility: `/usage` appears in IM help and not in Web help
- unknown-command behavior remains unchanged
- Codex snapshot parsing from representative JSONL fixtures
- selection of the newest valid Codex usage event
- Claude unavailable path when no OAuth provider is enabled
- combined reply formatting with both success and partial-failure cases
- IM slash dispatch path confirms `/usage` is handled locally

## Files expected to change

- `PLANS/ACTIVE.md`
- `shared/runtime-command-registry.ts`
- `src/index.ts`
- `src/runtime-command-handler.ts` or a new dedicated usage module if cleaner
- `src/routes/config.ts` or a shared extract if the Claude OAuth fetcher must be reused outside the route
- `tests/runtime-command-registry.test.ts`
- command and IM handler tests
- `docs/COMMAND.md`

## Risks

- The existing Claude OAuth usage fetcher currently lives inside route code; reusing it cleanly may require a small extraction.
- Codex session logs are a local contract, so the parser should be defensive and tolerate schema drift.
- If multiple users run the same backend account on one host, local Codex usage reflects the host login state, not per-workspace isolation. This is acceptable for the current scope because the request is specifically for Codex and Claude weekly/5h balance lookup, not per-user billing.

## Validation plan

- Targeted tests for the new parser and command behavior
- Relevant backend build/typecheck
- Repository review gate

## Decision

Proceed with an IM-only `/usage` command that always reports both Codex and Claude, using local Codex session snapshots plus Claude OAuth usage where available, and explicit unavailable states otherwise.
