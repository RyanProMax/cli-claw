---
name: stock-analysis-skill
description: Repository-level slash command bridge for stock research, HK IPO pool screening, HK IPO grey-market/OTC watch, and related stock analysis workflows.
---

# stock-analysis-skill

This repository-level skill exists only to expose executable slash commands from
Agent Fabric's workspace `.agents/skills` contract.

The command implementation is delegated to the sibling `stock-analysis-skill`
repository when present, or to `STOCK_ANALYSIS_SKILL_ROOT` when that environment
variable is set. Web UI Skill management and external fallback directories are
not part of this contract.
