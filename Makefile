.PHONY: dev dev-backend dev-web build build-shared build-backend build-web start \
       typecheck typecheck-backend typecheck-web typecheck-agent-runner \
       format format-check install clean reset-init sync-types \
       backup restore help

# ─── Runtime Detection ──────────────────────────────────────
# 优先使用 bun（跳过编译、启动更快），fallback 到 npm + tsx + node
HAS_BUN := $(shell command -v bun >/dev/null 2>&1 && echo 1 || echo 0)

ifeq ($(HAS_BUN),1)
  PKG     := bun
  RUN     := bun
  RUNNER  := bun src/index.ts
  PKG_PFX  = cd $(1) && bun install
else
  PKG     := npm
  RUN     := npx
  RUNNER  := npx tsx src/index.ts
  PKG_PFX  = npm --prefix $(1) install
endif

CLI_CLAW_HOME := $(HOME)/.cli-claw
CLI_CLAW ?= cli-claw

# ─── Development ─────────────────────────────────────────────

dev: ## 启动前后端（首次自动安装依赖并编译 agent-runner）
	@if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ web/package.json -nt web/node_modules ] || [ container/agent-runner/package.json -nt container/agent-runner/node_modules ]; then echo "📦 依赖有更新，安装依赖..."; $(MAKE) install; fi
	@$(PKG) --prefix container/agent-runner run build --silent 2>/dev/null || $(PKG) --prefix container/agent-runner run build
	@echo "🚀 使用 $(PKG) 启动..."
ifeq ($(HAS_BUN),1)
	npx concurrently --timestamp-format "yyyy-MM-dd HH:mm:ss.SSS" -n backend,frontend -c blue,green "bun start" "cd web && bun run dev"
else
	npx concurrently --timestamp-format "yyyy-MM-dd HH:mm:ss.SSS" -n backend,frontend -c blue,green "$(RUNNER)" "cd web && npm run dev"
endif

dev-backend: ## 仅启动后端（bun 直接跑 TS，node 用 tsx）
	$(RUNNER)

dev-web: ## 仅启动前端
	cd web && $(PKG) run dev

# ─── Build ───────────────────────────────────────────────────

build: build-shared sync-types ## 编译前后端及 agent-runner
	$(PKG) run build
	@touch .build-sentinel

build-shared: ## 编译 shared/ 单一定义产物
	$(PKG) run build:shared

build-backend: ## 仅编译后端
	$(PKG) run build:backend

build-web: build-shared ## 仅编译前端
	$(PKG) run build:web

# ─── Production ──────────────────────────────────────────────

start: ## 一键启动生产环境
	@if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ web/package.json -nt web/node_modules ] || [ container/agent-runner/package.json -nt container/agent-runner/node_modules ]; then echo "📦 依赖有更新，安装依赖..."; $(MAKE) install; fi
	@$(MAKE) build-shared
	@$(MAKE) build-backend
	@NEED_SYNC=0; \
	for target in src/messaging/image-detector.ts container/agent-runner/src/image-detector.ts src/messaging/channel-prefixes.ts container/agent-runner/src/channel-prefixes.ts; do \
	  if [ ! -f "$$target" ] || [ -n "$$(find shared/ -newer "$$target" -name '*.ts' 2>/dev/null | head -1)" ]; then NEED_SYNC=1; break; fi; \
	done; \
	if [ "$$NEED_SYNC" = "1" ]; then echo "🔄 检测到 shared/ 类型变更，同步类型..."; $(MAKE) sync-types; fi
ifeq ($(HAS_BUN),1)
	@NEED_WEB=0; \
	if [ ! -f web/dist/index.html ]; then NEED_WEB=1; \
	else \
	  for f in web/package.json web/vite.config.ts web/index.html web/tsconfig.json; do \
	    if [ -f "$$f" ] && [ "$$f" -nt web/dist/index.html ]; then NEED_WEB=1; break; fi; \
	  done; \
	  if [ "$$NEED_WEB" = "0" ] && [ -n "$$(find web/src/ -newer web/dist/index.html \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) 2>/dev/null | head -1)" ]; then NEED_WEB=1; fi; \
	fi; \
	if [ "$$NEED_WEB" = "1" ]; then echo "🔨 检测到前端变更，重新编译前端..."; cd web && bun run build; else echo "✅ 前端无变更，跳过编译"; fi
	@NEED_AR=0; \
	if [ ! -f container/agent-runner/dist/.tsbuildinfo ]; then NEED_AR=1; \
	else \
	  for f in container/agent-runner/package.json container/agent-runner/tsconfig.json; do \
	    if [ -f "$$f" ] && [ "$$f" -nt container/agent-runner/dist/.tsbuildinfo ]; then NEED_AR=1; break; fi; \
	  done; \
	  if [ "$$NEED_AR" = "0" ] && [ -n "$$(find container/agent-runner/src/ -newer container/agent-runner/dist/.tsbuildinfo -name '*.ts' 2>/dev/null | head -1)" ]; then NEED_AR=1; fi; \
	fi; \
	if [ "$$NEED_AR" = "1" ]; then echo "🔨 检测到 agent-runner 变更，重新编译..."; cd container/agent-runner && bun run build; else echo "✅ agent-runner 无变更，跳过编译"; fi
else
	@NEED_SYNC=0; \
	for target in src/messaging/image-detector.ts container/agent-runner/src/image-detector.ts src/messaging/channel-prefixes.ts container/agent-runner/src/channel-prefixes.ts; do \
	  if [ ! -f "$$target" ] || [ -n "$$(find shared/ -newer "$$target" -name '*.ts' 2>/dev/null | head -1)" ]; then NEED_SYNC=1; break; fi; \
	done; \
	if [ "$$NEED_SYNC" = "1" ]; then echo "🔄 检测到 shared/ 类型变更，同步类型..."; $(MAKE) sync-types; fi
	@NEED_BACKEND=0; \
	if [ ! -f dist/index.js ]; then NEED_BACKEND=1; \
	else \
	  for f in package.json tsconfig.json; do \
	    if [ "$$f" -nt dist/index.js ]; then NEED_BACKEND=1; break; fi; \
	  done; \
	  if [ "$$NEED_BACKEND" = "0" ] && [ -n "$$(find src/ -newer dist/index.js -name '*.ts' 2>/dev/null | head -1)" ]; then NEED_BACKEND=1; fi; \
	fi; \
	if [ "$$NEED_BACKEND" = "1" ]; then echo "🔨 检测到后端源码变更，重新编译后端..."; npm run build; else echo "✅ 后端无变更，跳过编译"; fi
	@NEED_WEB=0; \
	if [ ! -f web/dist/index.html ]; then NEED_WEB=1; \
	else \
	  for f in web/package.json web/vite.config.ts web/index.html web/tsconfig.json; do \
	    if [ -f "$$f" ] && [ "$$f" -nt web/dist/index.html ]; then NEED_WEB=1; break; fi; \
	  done; \
	  if [ "$$NEED_WEB" = "0" ] && [ -n "$$(find web/src/ -newer web/dist/index.html \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) 2>/dev/null | head -1)" ]; then NEED_WEB=1; fi; \
	fi; \
	if [ "$$NEED_WEB" = "1" ]; then echo "🔨 检测到前端变更，重新编译前端..."; cd web && npm run build; else echo "✅ 前端无变更，跳过编译"; fi
	@NEED_AR=0; \
	if [ ! -f container/agent-runner/dist/.tsbuildinfo ]; then NEED_AR=1; \
	else \
	  for f in container/agent-runner/package.json container/agent-runner/tsconfig.json; do \
	    if [ -f "$$f" ] && [ "$$f" -nt container/agent-runner/dist/.tsbuildinfo ]; then NEED_AR=1; break; fi; \
	  done; \
	  if [ "$$NEED_AR" = "0" ] && [ -n "$$(find container/agent-runner/src/ -newer container/agent-runner/dist/.tsbuildinfo -name '*.ts' 2>/dev/null | head -1)" ]; then NEED_AR=1; fi; \
	fi; \
	if [ "$$NEED_AR" = "1" ]; then echo "🔨 检测到 agent-runner 变更，重新编译..."; cd container/agent-runner && npm run build; else echo "✅ agent-runner 无变更，跳过编译"; fi
endif
	@echo "🚀 使用 cli-claw launcher 启动服务..."
	$(CLI_CLAW) start

# ─── Quality ─────────────────────────────────────────────────

typecheck: build-shared sync-types typecheck-backend typecheck-web typecheck-agent-runner ## 全量类型检查
	@./scripts/check-stream-event-sync.sh

typecheck-backend:
	$(RUN) tsc --noEmit

typecheck-web:
	cd web && $(RUN) tsc --noEmit

typecheck-agent-runner:
	cd container/agent-runner && $(RUN) tsc --noEmit

test: ## 运行单元测试
	bun test

format: ## 格式化代码
	$(PKG) run format

format-check: ## 检查代码格式
	$(PKG) run format:check

# ─── Shared Types ────────────────────────────────────────────

sync-types: ## 同步 shared/ 下仍采用镜像复制的公共源
	@./scripts/sync-stream-event.sh

# ─── Setup ───────────────────────────────────────────────────

install: ## 安装全部依赖并编译 agent-runner
	$(PKG) install
	cd container/agent-runner && $(PKG) install
	cd container/agent-runner && $(PKG) run build
	cd web && $(PKG) install
	@touch node_modules web/node_modules container/agent-runner/node_modules

clean: ## 清理构建产物
	rm -rf dist
	rm -rf web/dist
	rm -rf container/agent-runner/dist
	rm -f .build-sentinel

reset-init: ## 完全重置为首装状态（清空所有运行时数据）
	rm -rf "$(CLI_CLAW_HOME)"
	@echo "✅ 已完全重置为首装状态（数据库、配置、工作区、记忆、会话全部清除）"

# ─── Backup / Restore ────────────────────────────────────────

backup: ## 备份运行时数据到 cli-claw-backup-{date}.tar.gz
	@ROOT="$(CLI_CLAW_HOME)"; \
	if [ ! -d "$$ROOT" ]; then \
	  echo "❌ 未找到运行时目录：$$ROOT"; \
	  exit 1; \
	fi; \
	DATE=$$(date +%Y%m%d-%H%M%S); \
	FILE="cli-claw-backup-$$DATE.tar.gz"; \
	echo "📦 正在打包备份到 $$FILE ..."; \
	tar -czf "$$FILE" -C "$$ROOT" \
	  --exclude='ipc' \
	  --exclude='env' \
	  --exclude='streaming-buffer' \
	  --exclude='cli-claw.log' \
	  --exclude='db/messages.db-shm' \
	  --exclude='db/messages.db-wal' \
	  --exclude='groups/*/logs' \
	  $$([ -d "$$ROOT/db" ] && echo db) \
	  $$([ -d "$$ROOT/config" ] && echo config) \
	  $$([ -d "$$ROOT/groups" ] && echo groups) \
	  $$([ -d "$$ROOT/sessions" ] && echo sessions) \
	  $$([ -d "$$ROOT/memory" ] && echo memory) \
	  $$([ -d "$$ROOT/mcp-servers" ] && echo mcp-servers) \
	  $$([ -d "$$ROOT/avatars" ] && echo avatars) \
	  $$([ -d "$$ROOT/skills" ] && echo skills) \
	  2>/dev/null; \
	echo "✅ 备份完成：$$FILE ($$(du -sh $$FILE | cut -f1))"

restore: ## 从 cli-claw-backup-*.tar.gz 恢复数据（用法：make restore 或 make restore FILE=xxx.tar.gz）
	@if [ -n "$(FILE)" ]; then \
	  BACKUP="$(FILE)"; \
	elif [ $$(ls cli-claw-backup-*.tar.gz 2>/dev/null | wc -l) -eq 1 ]; then \
	  BACKUP=$$(ls cli-claw-backup-*.tar.gz); \
	elif [ $$(ls cli-claw-backup-*.tar.gz 2>/dev/null | wc -l) -gt 1 ]; then \
	  echo "❌ 发现多个备份文件，请用 make restore FILE=xxx.tar.gz 指定："; \
	  ls cli-claw-backup-*.tar.gz; \
	  exit 1; \
	else \
	  echo "❌ 未找到备份文件，请将 cli-claw-backup-*.tar.gz 放到当前目录"; \
	  exit 1; \
	fi; \
	ROOT="$(CLI_CLAW_HOME)"; \
	echo "📂 正在从 $$BACKUP 恢复..."; \
	if [ -d "$$ROOT" ] && [ "$$(ls -A "$$ROOT" 2>/dev/null)" ]; then \
	  echo "⚠️  $$ROOT 已存在数据，继续将覆盖。是否继续？[y/N] "; \
	  read CONFIRM; \
	  [ "$$CONFIRM" = "y" ] || [ "$$CONFIRM" = "Y" ] || { echo "已取消"; exit 1; }; \
	fi; \
	mkdir -p "$$ROOT"; \
	tar -xzf "$$BACKUP" -C "$$ROOT"; \
	if [ ! -f "$$ROOT/config/session-secret.key" ]; then \
	  echo "⚠️  警告：备份中缺少 session-secret.key，用户登录 cookie 将失效，需重新登录"; \
	fi; \
	echo "✅ 数据恢复完成"; \
	echo ""; \
	echo "后续步骤："; \
	echo "  1. 启动服务：make start"

# ─── Help ────────────────────────────────────────────────────

help: ## 显示帮助
	@echo "检测到运行时: $(if $(filter 1,$(HAS_BUN)),⚡ Bun,🟢 Node.js)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
