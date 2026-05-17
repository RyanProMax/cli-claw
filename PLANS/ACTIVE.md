# Active Task: Codex-Only Runtime Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or direct controller execution with verification gates. Plans live in `PLANS/`; do not write new plans under `docs/superpowers`.

**Goal:** Remove executable Claude runtime/provider/UI/API/dependency paths, keep a minimal pluggable `AgentRuntime` abstraction, and register only the OpenAI/Codex runtime for this release.

**Architecture:** `agent_type` remains a persisted runtime id field for future extension, but all legacy values (`null`, empty, `codex`, `claude`) normalize to `openai`. Runtime defaults, model options, usage, and launch preparation must flow through the runtime registry. Claude-specific implementation code should be deleted with its references rather than hidden behind dead branches.

**Tech Stack:** TypeScript ESM, NodeNext imports, Vitest, Hono, Bun/tsx dev runtime, OpenAI Agents SDK, Codex CLI login state.

---

## Scope

In scope:
- Add `src/core/runtime/agent-runtime.ts`, `openai-runtime.ts`, and `runtime-registry.ts`.
- Remove `/claude`, Claude model presets, Claude provider config/routes/UI, Claude OAuth usage, provider pool, Anthropic env overrides, and Claude SDK runner branches.
- Remove `@anthropic-ai/claude-agent-sdk` from root and container runner dependencies.
- Migrate legacy `registered_groups.agent_type` values to `openai` and reset incompatible runtime sessions.
- Remove `.claude/skills` discovery and runtime `.claude` session/config handling.
- Update `/help` standards in `AGENTS.md` and trim `/kol` description redundancy.
- Update docs/tests to reflect OpenAI/Codex-only runtime.

Out of scope:
- Adding a second runtime implementation.
- Preserving executable Claude compatibility shims.
- Rewriting historical message JSON; render old unknown runtime identities generically.

## Execution Steps

- [x] Split safe parallel work across implementation workers.
- [x] Introduce runtime registry and OpenAI runtime defaults/capabilities/usage.
- [x] Normalize all legacy runtime ids to `openai` and add DB migration/session reset.
- [x] Remove Claude branches from host/container runner and container agent runner.
- [x] Delete Claude provider API/routes/settings/UI and dependency references.
- [x] Remove `.claude/skills` fallback and runtime-neutralize docs/UI labels.
- [x] Update help/KOL standards and assertions.
- [x] Run typecheck, targeted tests, full validation, review, and health check.

## Validation

Required before completion:
- `npm run typecheck`
- targeted Vitest suites for runtime/routes/web/feishu/openai
- `./scripts/validate.sh`
- `./scripts/review.sh`
- `curl -fsS http://127.0.0.1:3000/api/health`

## Handoff

Current status:
- done

Validation evidence:
- `./scripts/validate.sh` passed on 2026-05-17 after final cleanup.
- `./scripts/review.sh` passed on 2026-05-17 after final cleanup.
- `curl -fsS http://127.0.0.1:3000/api/health` returned healthy.

Review status:
- passed: scope, objective, pattern fit, tests, hygiene, docs, and regression-contract checks all satisfied.

Notes:
- Destructive cleanup is allowed. When deleting behavior, remove the full reference chain and keep the remaining architecture simpler.
- Runtime/session migrations may break old Claude workspaces intentionally by converting them to OpenAI/Codex.
