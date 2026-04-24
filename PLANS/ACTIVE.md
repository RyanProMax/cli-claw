# Shared Runner IM Reply Route Hijack

## Goal

- Reproduce and fix the regression where a shared `main` runner accepts a Feishu IM turn, then a follow-up `web:main` autopilot/web turn clears the IM reply route and commits only the web cursor.
- Ensure post-restart pending Feishu replies are not starved by shared web/autopilot work in the same folder.

## Done when

- We have a focused failing regression test that proves web-originated work is deferred once an active shared runner has accepted IM-originated IPC work.
- The minimal production fix prevents web/autopilot work from re-entering that shared runner until the IM turn is committed or the runner exits.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Capture the shared-runner IM/web route-hijack in tests and implement the smallest queue-side fix.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `tests/group-queue.test.ts`

Validation:
- `npm test -- --run tests/group-queue.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Evidence gathered on 2026-04-24 before implementation:
  - `feishu:oc_98f0bb60f284627bf20f9386704f8c82` received a user message at `2026-04-24T08:45:11.753Z` and no assistant reply afterward.
  - `web:main` received `[WORKSPACE_AUTOPILOT]` at `2026-04-24T08:45:11.903Z`, then stored an assistant `error` reply at `2026-04-24T08:45:12.459Z`.
  - `router_state.last_committed_cursor` advanced `web:main` to `08:45:11.903Z` but left the Feishu chat at `08:40:53.796Z`.
  - `router_state.active_streaming_turns` still contains the Feishu turn with `snapshotJid: "web:main"` and cursor `08:45:11.753Z`, which means the IM turn was accepted into the shared runner but never committed.
- Root cause hypothesis:
  - A shared web-owned runner can accept an IM IPC message and then later accept another web/autopilot IPC message before the IM turn is committed.
  - The later web IPC clears the active IM reply route and lets the runner finish on behalf of `web:main`, so the IM cursor is left pending and the visible reply is stored only under the web chat.
- Fix implemented:
  - `GroupQueue.sendMessage()` and `enqueueMessageCheck()` now defer web-originated work not only behind an IM-owned runner, but also behind any active shared runner that has already accepted IM-originated IPC work.
  - `GroupQueue.drainGroup()` now lets waiting IM sibling chats run before restarting queued web/autopilot work on the same serialization key.
  - added a regression test that reproduces `web:main` accepting Feishu IPC and verifies the follow-up web/autopilot turn stays queued until the Feishu sibling runs.
- Validation evidence:
  - `npm test -- --run tests/group-queue.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review; the change stays inside queue ordering, does not widen runtime contracts, and preserves web work by queueing it behind the IM sibling instead of dropping it.
- Scope guard:
  - Do not widen into restart-recovery or streaming-card code unless the queue-side fix proves insufficient and `PLANS/ACTIVE.md` is updated first.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- implementation, validation, and review completed; pending commit and safe restart apply

Changed files:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `tests/group-queue.test.ts`

Last failure summary:
- After restart, the Feishu message is stored but a near-simultaneous `web:main` autopilot turn reclaims the shared runner and the visible assistant reply lands under `web:main` instead of the IM chat.

Suspected cause:
- Fixed: shared-runner queueing only deferred web work behind an active IM-owned runner; it still allowed web work to re-enter an active web-owned runner after that runner had already accepted IM IPC work.

Next step:
- Commit the scoped queue fix and apply it through the safe restart path so the next Feishu/autopilot overlap exercises the corrected ordering.
