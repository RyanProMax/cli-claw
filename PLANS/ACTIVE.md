# Feishu Stale Chat Backfill Cleanup

## Goal

- Stop startup/reconnect Feishu backfill from repeatedly retrying chats where the bot/user is no longer in the chat.
- Treat Feishu `230002 Bot/User can NOT be out of the chat` as a stale chat signal, not a generic delivery/backfill failure.
- Keep the change narrowly scoped to stale Feishu chat cleanup, concise logging, and regression coverage.

## Done when

- Feishu backfill classifies chat-unavailable errors and removes that chat from the active backfill set.
- The IM registered group for a removed/disbanded/unavailable chat is retired so future startups do not keep backfilling it.
- Backfill still continues for other known chats.
- Related tests, typecheck, diff hygiene, and review pass.

## Milestones

### Milestone 1

Objective:
- Add targeted Feishu stale-chat handling for backfill and persistently retire unreachable IM chat source rows.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/feishu.ts`
- `src/index.ts`
- `tests/feishu-connection.test.ts`
- `PLANS/ROADMAP.md` only if a cross-round monitoring note changes

Validation:
- `npm test -- --run tests/feishu-connection.test.ts`
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
- Trigger observed in live launchd log after safe restart: Feishu message list returns `code: 230002`, `msg: "Bot/User can NOT be out of the chat."` for stale chat `oc_d80e19baf0a9be91ef37a5c3cbe5101a`.
- The stale chat is currently retried on every startup backfill because startup candidates come from owned registered Feishu groups.
- The fix should preserve message/chat history; retiring the source should remove only the registered IM source row and routing/failure counters.
- Implemented targeted Feishu stale-chat classification for backfill errors and active backfill-set cleanup.
- Bot-removed/disbanded/unavailable IM source rows are now deleted from `registered_groups` while preserving message/chat history.
- Validation passed:
  - `npm test -- --run tests/feishu-connection.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`; no docs update required because no public command/runtime contract changed.

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
- done

Changed files:
- `PLANS/ACTIVE.md`
- `src/feishu.ts`
- `src/index.ts`
- `tests/feishu-connection.test.ts`

Next step:
- Commit the fix, then apply it through the safe restart path and confirm health.
