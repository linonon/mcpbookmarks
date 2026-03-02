import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { MCPHandlers } from './handlers';
import { TOOLS } from './toolDefinitions';

export class MCPServer {
  private server: Server;
  private handlers: MCPHandlers;

  constructor(store: BookmarkStoreManager) {
    this.handlers = new MCPHandlers(store);
    this.server = new Server(
      { name: 'mcp-bookmarks', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
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
