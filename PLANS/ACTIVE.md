# Assistant Prompt Session Isolation Fix

## Goal

- Stop skill-generated `assistant_prompt` turns such as `/hkipo` from becoming the primary runtime session for later normal Web/Feishu messages.
- Prove the fix with a Feishu real-flow regression that models the observed replay: a previous stock-analysis skill final must not appear in the next ordinary Feishu card.

## Done when

- `assistant_prompt` turns run in an isolated runtime session: they do not inherit the primary session and do not replace it when they finish.
- A normal Feishu message after an `assistant_prompt` turn does not receive that skill task's session id.
- The real Feishu card payload, persisted final reply, and prompt for the normal message contain only the current request.
- Validation and review pass; service restart is left manual unless explicitly requested.

## Milestones

### Milestone 55

Objective:
- Fix `assistant_prompt` runtime session pollution and cover the next-turn Feishu replay path.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `docs/MEMORY.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `tests/feishu-e2e.test.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- --run tests/feishu-e2e.test.ts tests/restart-recovery.test.ts tests/reply-visibility.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed 2026-04-29:
  - RED: `npm test -- --run tests/feishu-e2e.test.ts -t "does not reuse assistant-prompt skill session"` failed before the fix because the next ordinary Feishu run received `sess-hkipo-skill`.
  - `npm test -- --run tests/feishu-e2e.test.ts tests/restart-recovery.test.ts tests/reply-visibility.test.ts` (66 tests)
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed:
  - Manual semantic review confirmed `assistant_prompt` turns are isolated and cannot persist their runtime session as the workspace primary session.
  - The historical cleanup path only ignores a primary session when it matches the previous skill final's session id, so a valid pre-skill primary session is preserved.
  - `assistant_prompt` also cuts pending batch boundaries, so it cannot merge with same-source ordinary Feishu/Web messages.

Risks / Notes / Handoff:
- Live evidence: `~/.cli-claw/streaming-buffer/d2ViOm1haW4.json` for the 2026-04-29 15:34 Feishu message begins with the 2026-04-29 15:14 `/hkipo` final, then appends the current "thinking answer" request handling.
- DB evidence: `/hkipo` was stored as `source_kind='assistant_prompt'` at 2026-04-29T15:04:38.401Z; its final saved session `019dd9c5-6bfd-7ec2-ab24-64e6eebe31a6`; the next ordinary message reused that session.
- Root cause: the previous fix correctly bounded stream/card events, but the skill command session itself polluted primary runtime continuity.
- Fix summary: `assistant_prompt` runs with no primary session and does not persist its session; a later ordinary turn drops only a historically polluted skill session; docs now state the isolation contract.
- No service restart performed because the user previously asked not to auto-restart while tasks may be running.
