# agentbuddy — .NET 10 / Avalonia native desktop client, talking to an agenthub server.
#
# There is no web build and no in-process embedded console: the app is a single
# self-contained .NET publish. ab-tool (desktop/tools/AgentBuddy.Build) is the
# only build helper; every target below is dotnet or ab-tool, nothing else.

SHELL   := /bin/bash
DOTNET  := dotnet
DESK    := desktop
SLN     := $(DESK)/agentbuddy.sln
APP     := $(DESK)/src/AgentBuddy.App/AgentBuddy.App.csproj
TOOL    := $(DESK)/tools/AgentBuddy.Build

# `make stamp VERSION=1.2.3` / `make dotnet-publish RID=osx-arm64`.
VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo 0.1.0)
RID     ?= linux-x64

ab-tool = $(DOTNET) run --project $(TOOL) --

.PHONY: help
help: ## List the targets.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-24s %s\n", $$1, $$2}'

# ------------------------------------------------------------------- solution

.PHONY: dotnet-install
dotnet-install: ## Verify the pinned SDK from desktop/global.json and restore packages.
	$(DOTNET) --version
	$(DOTNET) restore $(SLN)

.PHONY: dotnet-icons
dotnet-icons: ## Re-derive png/ico/icns from desktop/assets/app-icon.png.
	$(ab-tool) icons

.PHONY: dotnet-build
dotnet-build: dotnet-install dotnet-icons ## Build the whole solution (warnings are errors).
	$(DOTNET) build $(SLN) --no-restore -warnaserror

.PHONY: dotnet-test
dotnet-test: dotnet-build ## Core + Shell + App + static guards (offline).
	$(DOTNET) test $(SLN) --no-build --logger "console;verbosity=normal"

.PHONY: dotnet-test-report
dotnet-test-report: dotnet-build ## Same run, plus a pasteable summary and a kept log.
	@set -o pipefail && $(DOTNET) test $(SLN) --no-build \
		--logger "console;verbosity=normal" 2>&1 | tee dotnet-test.log
	@{ echo '### dotnet test'; echo '```'; \
		grep -E '^(Passed!|Failed!|已通过!|失败!)' dotnet-test.log || true; \
		echo '```'; }

.PHONY: dotnet-coverage
dotnet-coverage: dotnet-build ## Cobertura coverage for all four test projects.
	$(DOTNET) test $(SLN) --no-build --collect:"XPlat Code Coverage" \
		--results-directory coverage

.PHONY: dotnet-smoke
dotnet-smoke: dotnet-build ## Smoke: bootstrap → cookie → forward → SSE → notify over real sockets.
	$(DOTNET) test $(DESK)/tests/AgentBuddy.Shell.Tests/AgentBuddy.Shell.Tests.csproj \
		--no-build --filter "FullyQualifiedName~GatewaySmokeTests"

.PHONY: dotnet-publish
dotnet-publish: dotnet-install dotnet-icons ## Self-contained publish for $(RID).
	$(DOTNET) publish $(APP) -c Release -r $(RID) --self-contained true \
		-o $(DESK)/publish/$(RID)

# ------------------------------------------------------------------ ab-tool

.PHONY: icons
icons: dotnet-icons ## Alias for dotnet-icons.

.PHONY: stamp
stamp: ## Write $(VERSION) into Directory.Build.props.
	$(ab-tool) stamp $(VERSION)

.PHONY: manifest
manifest: ## Generate the two updater manifests (ASSETS/META dirs, $(VERSION)).
	$(ab-tool) manifest --version $(VERSION) --meta $(or $(META),release-meta) \
		--out $(or $(ASSETS),release-assets)

.PHONY: verify
verify: ## Assert the release directory holds exactly nine assets.
	$(ab-tool) verify $(or $(ASSETS),release-assets) $(VERSION)

# ----------------------------------------------------------------- aggregate

.PHONY: smoke
smoke: dotnet-smoke ## Loopback-only cross-process smoke test (no network).

.PHONY: test
test: dotnet-test ## Everything that runs offline.

.PHONY: build
build: dotnet-build ## Build the app and the whole solution.

.PHONY: clean
clean: ## Remove build artefacts.
	find $(DESK) -type d \( -name bin -o -name obj \) -prune -exec rm -rf {} +
	rm -rf $(DESK)/publish coverage dotnet-test.log
