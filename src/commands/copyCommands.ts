import * as vscode from 'vscode';
import * as path from 'path';
import { Bookmark, BookmarkGroup } from '../store/types';
import { extractBookmark, extractGroup } from '../shared/itemHelpers';
import { CommandDependencies } from './types';

export function registerCopyCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  // Copy bookmark info command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyBookmarkInfo', async (item: unknown) => {
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to copy');
        return;
      }

      const infoText = `${bookmark.location}: ${bookmark.title}`;
      await vscode.env.clipboard.writeText(infoText);
      vscode.window.showInformationMessage('Bookmark info copied');
    })
  );

  // Copy group info command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyGroupInfo', async (item: unknown) => {
      const group = extractGroup(item);
      if (!group) {
        vscode.window.showErrorMessage('Please select a group to copy');
        return;
      }

      const infoText = `${group.title}(${group.id})`;
      await vscode.env.clipboard.writeText(infoText);
      vscode.window.showInformationMessage('Group info copied');
    })
  );

  // Copy relative path command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyRelativePath', async (item: unknown) => {
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to copy');
        return;
      }

      // Extract file path from location (remove :line or :start-end)
      const filePath = bookmark.location.split(':')[0];
      await vscode.env.clipboard.writeText(filePath);
      vscode.window.showInformationMessage('Relative path copied');
    })
  );

  // Copy absolute path command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyAbsolutePath', async (item: unknown) => {
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to copy');
        return;
      }

      // Extract file path from location (remove :line or :start-end)
      const relativePath = bookmark.location.split(':')[0];

      // Get workspace folder and construct absolute path
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      const absolutePath = vscode.Uri.joinPath(workspaceFolder.uri, relativePath).fsPath;
      await vscode.env.clipboard.writeText(absolutePath);
      vscode.window.showInformationMessage('Absolute path copied');
    })
  );

  // Copy MCP setup command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyMCPCommand', async () => {
      const extensionPath = context.extensionPath;
      const serverPath = path.join(extensionPath, 'dist', 'mcp-server.js');

      // Check if server file exists
      const fs = await import('fs');
      if (!fs.existsSync(serverPath)) {
        vscode.window.showErrorMessage(
          'MCP server file not found. Please reinstall the extension.'
        );
        return;
      }

      // Get launcher path
      const os = await import('os');
      const launcherPath = path.join(os.homedir(), '.vscode', 'mcp-bookmarks-launcher.js');

      // Generate commands for different tools
      const commands = [
        {
          label: 'Claude Code',
          description: 'Auto-updates with extension, no npm required',
          command: `claude mcp add -s user mcp-bookmarks -- node "${launcherPath}"`
        },
        {
          label: 'Gemini',
          description: 'Auto-updates with extension, no npm required',
          command: `gemini mcp add -s user mcp-bookmarks node "${launcherPath}"`
        },
        {
          label: 'Codex (config.toml)',
          description: 'Copy a snippet for ~/.codex/config.toml',
          command:
            `[mcp_servers."mcp-bookmarks"]\n` +
            `command = "node"\n` +
            `args = ["${launcherPath}"]`
        },
        {
          label: 'VSCode (Manual Configuration)',
          description: 'Copy launcher path for VSCode MCP configuration',
          command: launcherPath
        }
      ];

      const selected = await vscode.window.showQuickPick(commands, {
        placeHolder: 'Select which MCP command to copy'
      });

      if (!selected) {
        return;
      }

      await vscode.env.clipboard.writeText(selected.command);

      if (selected.label === 'VSCode (Manual Configuration)') {
        vscode.window.showInformationMessage(
          `Launcher path copied!\n\n` +
          `To configure in VSCode:\n` +
          `1. Press Cmd+P (Mac) or Ctrl+P (Windows)\n` +
          `2. Type ">MCP: Open User Configuration"\n` +
          `3. Add this configuration:\n\n` +
          `{\n` +
          `  "servers": {\n` +
          `    "mcp-bookmarks": {\n` +
          `      "type": "stdio",\n` +
          `      "command": "node",\n` +
          `      "args": ["${launcherPath}"]\n` +
          `    }\n` +
          `  }\n` +
          `}`,
          'Got it'
        );
      } else if (selected.label === 'Codex (config.toml)') {
        vscode.window.showInformationMessage(
          `Codex config snippet copied!\n\n` +
          `Paste into ~/.codex/config.toml (or your project config):\n\n` +
          selected.command,
          'Got it'
        );
      } else {
        vscode.window.showInformationMessage(
          `${selected.label} command copied to clipboard!\n` +
          `Run the command in your terminal to configure MCP.`,
          'Got it'
        );
      }
    })
  );
}
