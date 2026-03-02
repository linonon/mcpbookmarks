import { BookmarkStoreManager } from '../store/bookmarkStore';
import { HANDLER_MAP, ToolResult } from './handlersCore';

export { ToolResult };

export class MCPHandlers {
  constructor(private store: BookmarkStoreManager) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(toolName: string, args: any): ToolResult {
    const handler = HANDLER_MAP[toolName];
    if (!handler) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }
    return handler(this.store, args);
  }
}
