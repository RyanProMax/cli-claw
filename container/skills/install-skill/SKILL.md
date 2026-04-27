---
name: install-skill
description: Use when the user asks to install or uninstall a skill from skills.sh, GitHub, owner/repo, or owner/repo@skill input.
user-invocable: false
---

# Skill Installation

## RULES

- Follow the global Skill/MCP security review before installing external code.
- Install with the `install_skill` MCP tool only after the package ID is unambiguous.
- Uninstall by skill directory ID with `uninstall_skill`; project-level skills cannot be removed here.
- Keep user-facing results short: installed skill IDs, failure reason, and where to manage skills.

## Workflow

1. Parse input into `owner/repo` or `owner/repo@skill`.
2. Complete the required security review and approval flow.
3. Call `install_skill({ "package": "<package>" })`.
4. Report success or the exact blocker.

## Package Formats

| Input Format        | Example                                               | Extract As              |
| ------------------- | ----------------------------------------------------- | ----------------------- |
| skills.sh URL       | `https://skills.sh/s/owner/repo`                      | `owner/repo`            |
| skills.sh skill URL | `https://skills.sh/s/owner/repo/skill-name`           | `owner/repo@skill-name` |
| GitHub URL          | `https://github.com/owner/repo`                       | `owner/repo`            |
| GitHub tree URL     | `https://github.com/owner/repo/tree/main/skills/name` | `owner/repo@name`       |
| Direct package      | `owner/repo`                                          | `owner/repo`            |
| Package with skill  | `owner/repo@skill`                                    | `owner/repo@skill`      |

## Tool Calls

Install a package or one skill inside a package:

```text
install_skill({ "package": "owner/repo" })
install_skill({ "package": "owner/repo@skill-name" })
```

Uninstall:

```text
uninstall_skill({ "skill_id": "skill-name" })
```
