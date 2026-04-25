# Minimal Necessary Reply Policy

## Goal

- Make user-visible replies default to the minimal necessary information: decision-relevant results, concrete blockers, verification state, and next actions only.
- Keep process-heavy commentary, tool narration, and internal execution details out of final outbound message bodies unless the user explicitly asks for them.

## Done when

- The outbound reply contract has an explicit minimal-necessary policy in the implementation boundary that shapes agent-visible instructions.
- Direct tests cover the policy text so regressions are caught.
- Validation and review pass, and RM-2026-04-24-06 is updated with evidence.

## Milestones

### Milestone 1

Objective:
- Solidify the minimal-necessary reply policy in the outbound reply contract and add focused tests for it.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `container/agent-runner/prompts/**`
- `container/agent-runner/src/**`
- `container/agent-runner/tests/**`
- `src/**`
- `shared/**`
- `tests/**`
- directly related owner docs if the changed contract needs documentation

Validation:
- `npm test -- --run <directly-related-tests>`
- `npm run typecheck`
- `npm --prefix container/agent-runner run build:runner`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this scoped to default reply policy. Do not change Feishu card rendering, queueing, or restart behavior unless a direct test shows the policy cannot be enforced without it.
- The policy should not prevent detailed answers when the user explicitly asks for detail, commands, logs, code explanation, or review findings.
- Implemented:
  - Added `container/agent-runner/src/reply-policy.ts` as the tested minimal-necessary reply policy contract.
  - Injected the policy into the agent-runner system prompt as `<reply-policy>`.
  - Added `tests/minimal-reply-policy.test.ts` for default rule, include/exclude, and explicit-detail exceptions.
- Validation evidence:
  - `npm test -- --run tests/minimal-reply-policy.test.ts`
  - `npm run typecheck`
  - `npm --prefix container/agent-runner run build:runner`
  - `git diff --check`
  - `./node_modules/.bin/prettier --check container/agent-runner/src/reply-policy.ts tests/minimal-reply-policy.test.ts`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; scope stayed limited to reply-policy prompt contract and focused tests.

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
- `PLANS/ROADMAP.md`
- `container/agent-runner/src/index.ts`
- `container/agent-runner/src/reply-policy.ts`
- `tests/minimal-reply-policy.test.ts`

Last failure summary:
- Initial extra Prettier check flagged `tests/minimal-reply-policy.test.ts`; fixed with Prettier and reran the direct test plus full milestone validation.

Next step:
- Commit the minimal necessary reply policy contract, then apply it with a safe service restart.
