GO_RUNNER := ./scripts/run-go-toolchain.sh
VERSION ?= 1.1.2
OUTPUT ?= ./build/idena-go

.PHONY: build test-validation test-wasm node-macos-arm64

build:
	mkdir -p $(dir $(OUTPUT))
	$(GO_RUNNER) build -ldflags "-X main.version=$(VERSION)" -o $(OUTPUT) .

test-validation:
	$(GO_RUNNER) test ./config ./database ./api ./core/ceremony

test-wasm:
	$(GO_RUNNER) test ./vm/wasm -count=1

node-macos-arm64:
	./scripts/build-node-macos-arm64.sh "$(OUTPUT)"
