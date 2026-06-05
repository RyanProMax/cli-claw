---
name: stock-kol-intel
description: Repository-level slash command bridge for public stock-market KOL intelligence reports.
---

# stock-kol-intel

This repository-level skill exposes `/kol` through the workspace
`.agents/skills` command contract.

`/kol [--days=30]` returns a Cli Claw workflow trigger for the built-in `kol`
workflow. The workflow local task reads the sibling `stock-kol-intel`
repository, or `STOCK_KOL_INTEL_ROOT` when set, to load the KOL whitelist and
run the X/Twitter twscrape source preflight before the report role writes the
mobile-friendly intelligence brief.

`/kol-add <@handle or X link...>` writes new X/Twitter accounts into that same
`references/kol_whitelist.json` source, deduping by handle. It accepts direct
handles, X/Twitter URLs, or pasted Markdown lists, with optional `--name`,
`--focus`, and `--note` metadata for single-account additions.
