.PHONY: install watch compile package clean lint dev mcp-add mcp-remove
.PHONY: install watch compile package clean lint dev mcp-add mcp-remove reinstall-ext

# Project root directory
PROJECT_DIR := $(shell pwd)

# Install dependencies
install:
	npm install

# Development mode with watch
watch:
	npm run watch

# Development shortcut
dev: install watch

# Compile TypeScript
compile:
	npm run compile

# Package extension
package: compile
	npm run package

# Run linter
lint:
	npm run lint

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf node_modules
	rm -f *.vsix

# Full rebuild
rebuild: clean install compile

# Add MCP server to Claude Code
mcp-add: compile
	claude mcp add -s user mcp-bookmarks -- node $(PROJECT_DIR)/dist/mcp-server.js

# Remove MCP server from Claude Code
mcp-remove:
	claude mcp remove -s user mcp-bookmarks

# Reinstall VS Code extension
reinstall-ext: package
	@VSIX_FILE=$$(ls -t *.vsix 2>/dev/null | head -n 1); \
	if [ -z "$$VSIX_FILE" ]; then \
		echo "Error: No .vsix file found. Please run 'make package' first."; \
		exit 1; \
	fi; \
	echo "Reinstalling VS Code extension: $$VSIX_FILE"; \
	code --install-extension $$VSIX_FILE --force

# Show help
help:
	@echo "Available commands:"
	@echo "  make install    - Install dependencies"
	@echo "  make watch      - Start development mode with watch"
	@echo "  make dev        - Install and start watch mode"
	@echo "  make compile    - Compile TypeScript"
	@echo "  make package    - Package extension as .vsix"
	@echo "  make lint       - Run linter"
	@echo "  make clean      - Clean build artifacts"
	@echo "  make rebuild    - Full rebuild from scratch"
	@echo "  make mcp-add    - Add MCP server to Claude Code"
	@echo "  make mcp-remove - Remove MCP server from Claude Code"
	@echo "  make reinstall-ext - Rebuild and reinstall the VS Code extension"
