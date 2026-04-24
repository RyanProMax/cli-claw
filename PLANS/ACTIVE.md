# Restart First-Turn Context Recovery Guard

## Goal

- Fix the issue where the first Q&A after a service restart can unexpectedly carry recent history into the prompt.
- Keep crash recovery for genuinely unprocessed user/IM messages intact.

## Done when

- Startup recovery only clears sessions and injects compact history for recoverable inbound user work, not internal prompts, slash-command mirrors, or assistant/system rows.
- Focused tests cover the recoverable-pending classifier.
- Validation, review, safe restart, roadmap sync, and commit are complete.

## Milestones

### Milestone 1

Objective:
- Identify the narrow startup recovery predicate and lock the intended behavior in tests.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/db.ts` only if message fields required by the predicate are not exposed
- `tests/restart-recovery.test.ts`
- directly related tests only if required

Validation:
- `npm test -- --run tests/restart-recovery.test.ts`
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
- Root cause candidate: startup `recoverPendingMessages()` currently treats any `getMessagesSince()` row after `lastCommittedCursor` as unprocessed work. That query is user-side only, but it does not expose/filter `source_kind`, so internal `scheduled_task_prompt` / `user_command` rows can falsely trigger recovery and compact history injection.
- The fix should preserve real crash recovery for normal user/IM rows.
- Implemented:
  - `src/db.ts` now exposes `source_kind` from `getMessagesSince()`.
  - `src/index.ts` now filters startup recovery through `isRecoverableRestartPendingMessage()`, ignoring internal scheduled prompt rows, command mirrors, and assistant/system rows.
  - `tests/restart-recovery.test.ts` covers real user/IM recovery and ignored internal rows.
- Validation evidence:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; scope stayed inside the active milestone and no public protocol docs changed.
- Safe restart:
  - `restart-2026-04-24T15-45-15-537Z-7d38d20e` passed via `node dist/cli.js restart`.
  - Post-restart backend PID is `1823`; `/api/health` is healthy and `active_streaming_turns` is `{}`.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- Done. Restart recovery no longer injects compact history for internal scheduled prompt, command mirror, assistant, or system rows.

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/db.ts`
- `src/index.ts`
- `tests/restart-recovery.test.ts`

Last failure summary:
- First review helper run failed on Prettier formatting for `src/index.ts`; fixed with Prettier and reran validation successfully.

Suspected cause:
- Internal non-user rows after the committed cursor can be misclassified as restart-recoverable pending work.

Next step:
- Commit the focused restart recovery guard fix.
