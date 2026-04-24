# Feishu Outbound Message Contract Coverage

## Goal

- Strengthen Feishu outbound behavior so user-visible replies stay separate from internal commentary/tool progress across normal, interrupted, static-reply, and failure paths.
- Ensure Feishu delivery failures do not advance committed reply cursors as if a user-visible reply was delivered.

## Done when

- Tests cover Feishu terminal/static/interrupted reply boundaries without leaking internal progress into the main user-visible body.
- Tests cover Feishu API send/update failures so failed delivery is not treated as a committed outbound reply.
- Changes stay focused on Feishu outbound presentation and cursor/delivery contracts.
- Validation, review, docs assessment, safe restart decision, and commit are complete.

## Milestones

### Milestone 1

Objective:
- Lock exact outbound paths and the smallest contract tests needed for RM-2026-04-24-05.

Allowed scope:
- `PLANS/ACTIVE.md`
- read-only inspection of `PLANS/ROADMAP.md`
- read-only inspection of `src/index.ts`
- read-only inspection of `src/feishu.ts`
- read-only inspection of `src/feishu-streaming-card.ts`
- read-only inspection of `shared/stream-presentation.ts`
- read-only inspection of `tests/stream-presentation.test.ts`
- read-only inspection of `tests/chat-streaming-store.test.ts`
- read-only inspection of `tests/feishu-streaming-card.test.ts`
- read-only inspection of directly related tests

Validation:
- Identify exact files and behaviors to test or change.
- Confirm whether docs need updating before implementation.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Roadmap source: `RM-2026-04-24-05 Feishu Outbound Message Contract`.
- Target next action: cover interrupted/static-reply/send-failure paths and avoid leaking internal progress through alternate Feishu exits.
- Findings:
  - `src/feishu.ts` `FeishuConnection.sendMessage()` logs and swallows final send failures, so `imManager.sendMessage()` resolves even when Feishu delivery failed.
  - `src/im-channel.ts` `createFeishuChannel().sendMessage()` also resolves when the channel is disconnected, making disconnected Feishu delivery look successful to retry/cursor code.
  - Existing interrupted/static presentation coverage already covers commentary separation in `tests/reply-visibility.test.ts`, `tests/restart-recovery.test.ts`, and `tests/feishu-streaming-card.test.ts`; this round should add explicit Feishu delivery-failure contract coverage.
  - No docs update is required for Milestone 2 unless public command/runtime behavior changes; this is an internal delivery contract fix.

### Milestone 2

Objective:
- Add focused contract tests and minimal implementation fixes for Feishu outbound edge paths.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/feishu.ts`
- `src/feishu-streaming-card.ts`
- `shared/stream-presentation.ts`
- `tests/stream-presentation.test.ts`
- `tests/chat-streaming-store.test.ts`
- `tests/feishu-streaming-card.test.ts`
- directly related tests only if required by the discovered path

Validation:
- `npm test -- --run tests/stream-presentation.test.ts tests/chat-streaming-store.test.ts tests/feishu-streaming-card.test.ts`
- Run any newly added focused test files.
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep behavior changes narrow; do not redesign Feishu card rendering or queue handling unless tests prove it is necessary.
- Implemented:
  - `src/feishu.ts` now rejects `sendMessage()` when the Feishu client is unavailable or final card/post delivery fails.
  - `src/im-channel.ts` now rejects Feishu sends before the channel is connected and propagates adapter send failures.
  - `src/index.ts` now propagates direct IM send failures from `sendMessage()` instead of persisting/committing them as delivered replies.
  - `tests/feishu-connection.test.ts` covers failed card delivery plus failed post fallback.
  - `tests/im-channel.test.ts` covers disconnected Feishu sends and propagated adapter failures.
- Validation evidence:
  - `npm test -- --run tests/feishu-connection.test.ts tests/im-channel.test.ts tests/reply-visibility.test.ts tests/restart-recovery.test.ts tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts tests/chat-streaming-store.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; scope stayed focused on Feishu outbound failure propagation and related contract tests.

### Milestone 3

Objective:
- Finish handoff, roadmap sync, safe restart assessment, and commit.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- safe restart via documented command only if runtime-impacting code changes are made
- read-only post-restart status/log checks if restarted

Validation:
- Active plan records validation and review results.
- Roadmap reflects completed evidence or remaining follow-up.
- `git status --short` is clean after commit unless explicitly blocked.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- If this round only changes tests and non-runtime docs, safe restart may be unnecessary; record the decision explicitly.
- Runtime code changed, so safe restart was required and completed.
- Safe restart `restart-2026-04-24T15-36-30-227Z-556983dc` passed.
- Post-restart backend PID is `99348`; `/api/health` is healthy and `active_streaming_turns` is `{}`.
- Feishu and WeChat channels reconnected after restart. Feishu startup backfill logged an existing 400 response but completed and connected.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 3

Current status:
- Done. Feishu send failures now propagate instead of being treated as successful delivered replies.

Changed files:
- `PLANS/ACTIVE.md`
- `src/feishu.ts`
- `src/im-channel.ts`
- `src/index.ts`
- `tests/feishu-connection.test.ts`
- `tests/im-channel.test.ts`

Last failure summary:
- None after validation. Focused tests, typecheck, diff hygiene, review script, and semantic review passed.

Suspected cause:
- Feishu send adapters logged and swallowed final delivery failures, so upper-layer retry/cursor logic could treat failed delivery as successful.

Next step:
- Commit the focused Feishu outbound failure propagation fix, then start a separate plan for restart first-turn context leakage.
