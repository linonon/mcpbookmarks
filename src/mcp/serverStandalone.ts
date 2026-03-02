import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { WorkspaceManager } from '../store/workspaceManager';
import { MCPHandlersStandalone } from './handlersStandalone';
import { TOOLS, STANDALONE_TOOLS, withProjectRoot } from './toolDefinitions';

// standalone 版本: 共享工具注入 projectRoot 参数, 再拼接 standalone 独有工具
const allTools = [...withProjectRoot(TOOLS), ...STANDALONE_TOOLS];

export class MCPServerStandalone {
  private server: Server;
  private handlers: MCPHandlersStandalone;

  constructor(workspaceManager: WorkspaceManager) {
    this.handlers = new MCPHandlersStandalone(workspaceManager);
    this.server = new Server(
      { name: 'mcp-bookmarks', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: allTools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = this.handlers.handle(name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.success
      };
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Bookmarks MCP server started');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
