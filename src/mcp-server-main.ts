#!/usr/bin/env node

/**
 * Standalone MCP Server entry point for Claude Code integration.
 * This runs independently of the VSCode extension.
 *
 * Usage:
 *   node mcp-server.js /path/to/workspace
 *   node mcp-server.js  # uses cwd or WORKSPACE_ROOT env
 *
 * In mcp.json:
 *   {
 *     "ai-bookmark": {
 *       "command": "node",
 *       "args": ["/path/to/mcp-server.js", "/path/to/project"]
 *     }
 *   }
 */

import * as fs from 'fs';
import { WorkspaceManager } from './store/workspaceManager';
import { MCPServerStandalone } from './mcp/serverStandalone';

// Get workspace from: 1) command line arg, 2) env var, 3) cwd
const defaultWorkspace = process.argv[2] || process.env.WORKSPACE_ROOT || process.cwd();

// Verify default workspace exists
if (!fs.existsSync(defaultWorkspace)) {
  console.error(`Workspace does not exist: ${defaultWorkspace}`);
  console.error('Usage: node mcp-server.js [workspace-path]');
  process.exit(1);
}

// Initialize workspace manager and server
// WorkspaceManager supports dynamic workspace switching via projectRoot parameter
const workspaceManager = new WorkspaceManager(defaultWorkspace);
const server = new MCPServerStandalone(workspaceManager);

// Start server
server.start().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.stop();
  workspaceManager.dispose();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  workspaceManager.dispose();
  process.exit(0);
});
