# Feishu Startup Reply Recovery

## Goal

- Reproduce and fix the restart-window regression where the first Feishu message sent shortly after service startup is not replied to.
- Ensure startup behaves like reconnect recovery for known Feishu chats: messages created while the service is restarting must still be ingested once the Feishu connection is ready.

## Done when

- We have a focused failing test that proves initial Feishu connect performs a startup backfill for known chats instead of only relying on live WebSocket delivery.
- The smallest production fix recovers restart-window Feishu messages without duplicating already-delivered live messages.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Capture the missing startup-backfill behavior in tests and implement the minimal Feishu startup recovery path.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/index.ts`
- `src/im-manager.ts`
- `src/im-channel.ts`
- `src/feishu.ts`
- `tests/feishu-connection.test.ts`

Validation:
- `npm test -- --run tests/feishu-connection.test.ts`
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
- Evidence gathered on 2026-04-24:
  - user reports that after every restart, the first Feishu message does not receive a reply
  - startup path in `src/index.ts` connects user IM channels with `ignoreMessagesBefore: Date.now()`
  - `src/feishu.ts` only runs `runBackfill()` on reconnect / recovered WebSocket paths, not on initial connect
  - initial connect currently returns after `wsClient.start()` and `onReady()` with no startup replay path
- Fix implemented:
  - startup now passes each user's known `feishu:` chat IDs into the Feishu connection bootstrap path
  - initial Feishu connect runs the existing backfill flow once after WS startup for those known chats
  - live WS and startup backfill now use separate ignore thresholds, so restart-window messages sent before channel readiness are recoverable without reopening older pre-start backlog
- Validation evidence:
  - `npm test -- --run tests/feishu-connection.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review; scope stayed inside the milestone and the existing message-id dedupe still prevents startup backfill from duplicating live WS delivery
- Out of scope for this milestone:
  - broader IM channel startup semantics for Telegram / QQ / WeChat / DingTalk unless the investigation proves the same root cause and the plan is updated first
  - `/model` discovery alignment and the existing Feishu card-layout roadmap items

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
- validation/review passed

Changed files:
- `PLANS/ACTIVE.md`
- `src/feishu.ts`
- `src/im-channel.ts`
- `src/im-manager.ts`
- `src/index.ts`
- `tests/feishu-connection.test.ts`

Last failure summary:
- initial red tests proved two gaps:
  - startup connect never called Feishu message-list backfill for known chats
  - startup backfill incorrectly reused the later live-WS ignore threshold, so messages sent earlier in the restart window were still filtered out

Suspected cause:
- fixed:
  - initial Feishu startup now seeds known chats and runs one startup backfill pass after WS readiness
  - startup recovery reuses the existing deduped `handleIncomingMessage(..., 'backfill')` path instead of inventing a second ingest flow
  - startup backfill now uses a startup-time lower bound instead of the later connection-time live-WS lower bound

Next step:
- commit the scoped fix and apply it through the safe restart path so the next restart-window Feishu message is recoverable
