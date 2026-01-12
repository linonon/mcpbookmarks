#!/bin/bash
# 测试 MCP Server 是否正常启动

export AI_BOOKMARKS_WORKSPACE="$(pwd)"

echo "Testing MCP Server startup..."
timeout 3 node dist/mcp-server.js << 'INPUT' 2>&1 || true
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
INPUT

echo ""
echo "If you see 'AI Bookmarks MCP server started' and tool list, the server works."
