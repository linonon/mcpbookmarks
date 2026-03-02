import * as fs from 'fs';
import { WorkspaceManager } from '../store/workspaceManager';
import { HANDLER_MAP, ToolResult } from './handlersCore';

export { ToolResult };

export class MCPHandlersStandalone {
  constructor(private workspaceManager: WorkspaceManager) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(toolName: string, args: any): ToolResult {
    // standalone 专属工具
    if (toolName === 'set_workspace') {
      return this.setWorkspace(args);
    }
    if (toolName === 'get_workspace') {
      return this.getWorkspace();
    }

    // 通过 projectRoot 获取对应 store, 委托给 handlersCore
    const store = this.workspaceManager.getStore(args?.projectRoot);

    const handler = HANDLER_MAP[toolName];
    if (!handler) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }
    return handler(store, args);
  }

  private setWorkspace(args: { path: string }): ToolResult {
    try {
      const { path } = args;

      if (!path || typeof path !== 'string') {
        return { success: false, error: 'path is required and must be a string' };
      }

      if (!fs.existsSync(path)) {
        return { success: false, error: `Workspace path does not exist: ${path}` };
      }

      this.workspaceManager.setDefaultWorkspace(path);
      // 预先获取 store 以验证并初始化
      this.workspaceManager.getStore(path);

      return {
        success: true,
        data: {
          workspace: path,
          message: `Workspace set to: ${path}`,
          bookmarkFile: `${path}/.vscode/mcp-bookmarks.json`
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to set workspace: ${error}` };
    }
  }

  private getWorkspace(): ToolResult {
    try {
      const defaultWorkspace = this.workspaceManager.getDefaultWorkspace();
      const activeWorkspaces = this.workspaceManager.listActiveWorkspaces();

      return {
        success: true,
        data: {
          currentWorkspace: defaultWorkspace,
          activeWorkspaces,
          bookmarkFile: `${defaultWorkspace}/.vscode/mcp-bookmarks.json`
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to get workspace: ${error}` };
    }
  }
}
