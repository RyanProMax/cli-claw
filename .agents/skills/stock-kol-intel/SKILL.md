---
name: stock-kol-intel
description: Repository-level slash command bridge for public stock-market KOL intelligence reports.
---

# stock-kol-intel

This repository-level skill exposes `/kol` through the workspace
`.agents/skills` command contract. The implementation is delegated to the
sibling `stock-kol-intel` repository when present, or to
`STOCK_KOL_INTEL_ROOT` when set.
