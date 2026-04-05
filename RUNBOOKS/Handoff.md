# Handoff Runbook

Write a handoff whenever the current Codex thread cannot safely finish the current milestone end-to-end.

## Handoff Is Required When

- validation keeps failing after repeated repair attempts
- the current milestone is blocked by missing context, dependency, or external action
- work must move to another thread or another Codex session
- you need to preserve current state for later continuation

## Handoff Rules

- Update the current milestone notes in `PLANS/ACTIVE.md`.
- Do not mark the milestone `done`.
- Record the latest concrete failure, not a vague summary.
- Prefer exact file paths and exact commands.

## Copy-Paste Template

```md
## Handoff

Current milestone:
- <milestone id>

Current status:
- <in_progress | blocked | validation_failed | review_failed>

Changed files:
- `<path>`

Recent validation or review failure:
- <command or review finding>

Suspected cause:
- <root cause or best current hypothesis>

Next step:
- <next concrete action for the next session>
```
