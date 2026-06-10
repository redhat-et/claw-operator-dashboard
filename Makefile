# Image URL to use for building and pushing the dashboard image.
DEPLOYER_IMG ?= quay.io/redhat-et/claw-deployer-ui:latest
ADMIN_IMG ?= quay.io/redhat-et/claw-admin-dashboard:latest
PLATFORM ?= linux/amd64
DEPLOYER_LOCAL_ADDR ?= :18080
DEPLOYER_LOCAL_USER ?= $(USER)
DEPLOYER_LOCAL_KUBE_API_SERVER ?= http://127.0.0.1:9
ADMIN_LOCAL_ADDR ?= :18082
ADMIN_LOCAL_USER ?= $(USER)
ADMIN_LOCAL_KUBE_API_SERVER ?= http://127.0.0.1:9

# CONTAINER_TOOL defines the container tool to be used for building images.
CONTAINER_TOOL ?= podman

# Setting SHELL to bash allows bash commands to be executed by recipes.
SHELL = /usr/bin/env bash -o pipefail

.PHONY: test
test:
	go test ./...

.PHONY: deployer-build
deployer-build: ## Build the OpenClaw deployer UI image. Override with DEPLOYER_IMG=...
	$(CONTAINER_TOOL) build --platform=$(PLATFORM) -f Containerfile -t $(DEPLOYER_IMG) .

.PHONY: deployer-push
deployer-push: ## Push the OpenClaw deployer UI image.
	$(CONTAINER_TOOL) push $(DEPLOYER_IMG)

.PHONY: admin-build
admin-build: ## Build the OpenClaw admin dashboard image. Override with ADMIN_IMG=...
	$(CONTAINER_TOOL) build --platform=$(PLATFORM) -f Containerfile.admin -t $(ADMIN_IMG) .

.PHONY: admin-push
admin-push: ## Push the OpenClaw admin dashboard image.
	$(CONTAINER_TOOL) push $(ADMIN_IMG)

.PHONY: deployer-run-local
deployer-run-local: ## Run the OpenClaw deployer UI locally for frontend preview.
	LISTEN_ADDR=$(DEPLOYER_LOCAL_ADDR) \
	KUBE_API_SERVER=$(DEPLOYER_LOCAL_KUBE_API_SERVER) \
	DEVELOPER_BEARER_TOKEN=preview \
	DEVELOPER_USERNAME=$(DEPLOYER_LOCAL_USER) \
	OPENCLAW_DEPLOYER_IMPERSONATE=false \
	go run ./cmd/deployer

.PHONY: admin-run-local
admin-run-local: ## Run the OpenClaw admin dashboard locally for frontend preview.
	LISTEN_ADDR=$(ADMIN_LOCAL_ADDR) \
	KUBE_API_SERVER=$(ADMIN_LOCAL_KUBE_API_SERVER) \
	DEVELOPER_BEARER_TOKEN=preview \
	DEVELOPER_USERNAME=$(ADMIN_LOCAL_USER) \
	go run ./cmd/admin
