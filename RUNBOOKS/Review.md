# Review Runbook

This file defines the review gate that runs after validation passes and before a milestone can be marked `done`.

## Review Outcome

- `passed`: all checks below are satisfied and no blocking issues remain
- `failed`: at least one blocking issue exists; the milestone stays open and must return to implementation plus validation

## Review Checklist

1. Scope check
   - Did the change stay inside the milestone's `Allowed scope`?
   - Were unrelated files modified without a plan update?
2. Objective check
   - Does the diff satisfy the milestone `Objective`?
   - Is any promised behavior still missing?
3. Pattern-fit check
   - Do the changes follow existing repository structure, naming, and conventions?
   - Did the change avoid inventing a heavier framework than the repo needs?
4. Test and validation check
   - Were the milestone's required validation steps actually run?
   - Are any directly related tests still missing?
5. Hygiene check
   - Any leftover `TODO`, `FIXME`, debug logging, temporary hacks, commented dead code, or placeholder text?
   - Any duplicated or contradictory instructions across docs?
6. Docs and comments check
   - Do affected public protocols or developer entrypoints need doc updates?
   - Are new scripts, templates, or workflow files documented clearly enough to use?
7. Regression and contract check
   - Is there an obvious behavior regression risk?
   - Did the change weaken an existing contract, path convention, or validation workflow?

## Review Procedure

1. Read the milestone `Objective`, `Allowed scope`, and `Validation`.
2. Inspect the diff and changed files.
3. Record any findings with file references where possible.
4. Decide `passed` or `failed`.
5. Write the result back into the milestone's `Review status`.

## Blocking Findings

Any of the following means review fails:

- scope violation
- missing objective coverage
- missing required validation
- obvious repository-pattern mismatch
- leftover debug or temporary code
- required docs not updated
- clear regression or contract-break risk
