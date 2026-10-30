# agentbuddy — Tauri v2 desktop shell + Vue 3 workbench, talking to an agenthub server.
#
# Building the desktop app embeds the console at compile time (rust-embed), so
# every desktop target depends on web-build having run first. That dependency is
# spelled out explicitly below rather than hidden in a helper.

SHELL := /bin/bash
BUN   := bun
WEB   := web
DESK  := desktop

VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo 0.1.0)

.PHONY: help
help: ## List the targets.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-24s %s\n", $$1, $$2}'

# ---------------------------------------------------------------- web (console)

.PHONY: web-install
web-install: ## Install the console dependencies with bun.
	cd $(WEB) && $(BUN) install

.PHONY: web-dev
web-dev: web-install ## Vite dev server on :5173, proxying /api to localhost:3500.
	cd $(WEB) && $(BUN) run dev

.PHONY: web-build
web-build: web-install ## Build the console into web/dist (embedded by the shell).
	cd $(WEB) && $(BUN) run build
	@test -f $(WEB)/dist/index.html || { echo "agentbuddy: console build produced no index.html"; exit 1; }

.PHONY: web-test
web-test: web-install ## Vitest suite (i18n completeness + monochrome guard).
	cd $(WEB) && $(BUN) run test

# ------------------------------------------------------------------- desktop

.PHONY: desktop-install
desktop-install: ## Install the Tauri CLI.
	cd $(DESK) && $(BUN) install

.PHONY: desktop-dev
desktop-dev: desktop-install web-build icons ## Run the shell against the freshly built console.
	cd $(DESK) && $(BUN) run dev

.PHONY: desktop-build
desktop-build: desktop-install web-build icons ## Produce installers for the host platform.
	cd $(DESK) && $(BUN) run build

.PHONY: desktop-test
desktop-test: desktop-install ## Rust unit tests (proxy, config, i18n).
	cd $(DESK)/src-tauri && cargo test

.PHONY: desktop-check
desktop-check: ## cargo check without bundling (fast feedback in CI).
	cd $(DESK)/src-tauri && cargo check --all-targets

.PHONY: icons
icons: desktop-install ## Re-derive every icon size from assets/app-icon.png.
	cd $(DESK) && $(BUN) run icons

.PHONY: stamp
stamp: desktop-install ## Write $(VERSION) into Cargo.toml + tauri.conf.json.
	cd $(DESK) && $(BUN) run stamp $(VERSION)

# ---------------------------------------------------------------- aggregate

.PHONY: test
test: web-test desktop-test ## Everything that runs offline.

.PHONY: build
build: web-build ## Console + a host-platform installer.
	$(MAKE) desktop-build

.PHONY: clean
clean: ## Remove build artefacts.
	rm -rf $(WEB)/dist $(DESK)/src-tauri/target coverage.out
