# Skill Command Dispatch And HK IPO Design

## Goal

Allow workspace/user-enabled skills to declare slash commands owned by the skill itself, then use that path to ship `stock-analysis-skill` commands for Hong Kong IPO analysis without embedding IPO business logic in `cli-claw`. In the same change set, repair Feishu final rendering so Codex commentary stays out of final reply bodies and completed cards keep compact markdown spacing.

## Requirements

- Built-in slash commands remain first-class and keep current behavior.
- Unknown slash commands should not immediately fail if an enabled skill declares that command for the current workspace.
- Skill command execution must be thin and generic:
  - command discovery
  - duplicate detection
  - controlled executor launch
  - stdout JSON parsing
- `stock-analysis-skill` owns:
  - `/hkipo`: discover current subscribable or pending-listing Hong Kong IPOs and output one consolidated markdown report
  - `/cnipo`: reserved placeholder for future China A-share IPO support
- Feishu final rendering must:
  - prefer answer-only text for Codex final delivery
  - avoid commentary leakage into the completed reply
  - keep final static card markdown spacing close to the streaming experience

## Command Protocol

### Manifest

Each skill may expose `commands.json` in its root:

```json
{
  "version": 1,
  "commands": {
    "hkipo": {
      "description": "分析当前可认购或待上市的港股新股",
      "entrypoints": ["im", "web"],
      "executor": {
        "command": "python3",
        "args": ["commands/hkipo.py"]
      }
    }
  }
}
```

### Request Payload

`cli-claw` launches the executor with `cwd=<skill dir>` and writes stdin JSON:

```json
{
  "version": 1,
  "command": "hkipo",
  "entrypoint": "im",
  "chatJid": "feishu:chat",
  "argsText": "",
  "args": [],
  "workspace": {
    "jid": "web:workspace",
    "folder": "workspace-folder",
    "name": "Workspace Name"
  }
}
```

### Response Payload

Executors respond with stdout JSON:

```json
{
  "reply": {
    "type": "final_markdown",
    "content": "..."
  }
}
```

Only `final_markdown` is needed for v1. Later extensions can add richer types without changing the dispatch ownership model.

## Discovery Rules

- Search current workspace skill directory first: `<workspace root>/.claude/skills`
- Then search user-level synced skills: `~/.cli-claw/skills/<userId>`
- Ignore disabled skills (`SKILL.md.disabled`)
- If more than one enabled skill declares the same command name, fail with a clear duplicate-command reply
- `/help` appends discovered skill commands after built-in commands, scoped to the current entrypoint

## HK IPO Skill Behavior

### Scope

`/hkipo` automatically covers:

- currently subscribable Hong Kong IPOs
- already-closed but not-yet-listed Hong Kong IPOs

### Report Sections

- `IPO 池总览`
- `重点结论`
- `逐标的分析`
- `横向比较`
- `风险与赔率提示`

### Single-IPO Analysis Factors

- issuance basics: range, lot size, proceeds, sponsors, cornerstone investors
- company profile: business, commercialization stage, financial trend, use of proceeds
- heat: public tranche subscription multiple, international tranche demand, listing window timing
- odds: allocation rate if available, otherwise explicit downgrade note
- valuation: comparable companies and issue valuation pressure

### Heat And Odds Interpretation

Use qualitative bands, not fake precision:

- `低`
- `中`
- `高`
- `极高`

Examples:

- very high subscription + very low allocation rate => hot but poor odds
- moderate heat + acceptable allocation rate => less crowded but better odds

## Feishu Rendering Fix

- Keep stream-time presentation state scoped to the active streaming card only
- Ensure final IM/static-card delivery uses the current runtime raw/final output after visibility filtering, never `answerText`
- Add final-card markdown normalization for plain prose / heading transitions so the completed card matches the tighter streaming feel

## Files

- `src/skill-command-dispatch.ts`
  - manifest loading
  - command discovery
  - duplicate detection
  - executor launch / response parsing
- `src/index.ts`
  - IM slash-command fallback to skill dispatch
  - IM help appends discovered skill commands
- `src/web.ts`
  - Web slash-command fallback to skill dispatch
- `src/skill-utils.ts`
  - shared helpers for user/workspace skill roots and command manifest parsing
- `src/feishu-markdown-style.ts`
  - final-card markdown tightening helper
- `src/feishu-streaming-card.ts`
  - apply tightened final-card markdown formatting
- `stock-analysis-skill/commands.json`
  - skill-owned command declarations
- `stock-analysis-skill/commands/hkipo.py`
  - IPO discovery + report generation
- `stock-analysis-skill/commands/cnipo.py`
  - reserved placeholder reply

## Validation

- unit tests for command discovery, duplicate detection, IM fallback, Web fallback, help output
- regression tests for reply visibility and Feishu completed-card formatting
- `stock-analysis-skill` executor tests for `/hkipo` and `/cnipo`
