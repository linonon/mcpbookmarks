import * as vscode from 'vscode';
import { CommandDependencies } from './types';

export function registerViewCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  const { sidebarProvider } = deps;

  // Expand all command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.expandAll', () => {
      sidebarProvider.expandAll();
    })
  );

  // Collapse all command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.collapseAll', () => {
      sidebarProvider.collapseAll();
    })
  );

  // Expand single group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.expandGroup', (item: unknown) => {
      const groupItem = item as { type: string; group?: { id: string } };
      if (groupItem?.type === 'group' && groupItem.group) {
        sidebarProvider.expandGroup(groupItem.group.id);
      }
    })
  );

  // Collapse single group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.collapseGroup', (item: unknown) => {
      const groupItem = item as { type: string; group?: { id: string } };
      if (groupItem?.type === 'group' && groupItem.group) {
        sidebarProvider.collapseGroup(groupItem.group.id);
      }
    })
  );

  // Toggle view style command (Nested/Tree)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.toggleViewMode', () => {
      sidebarProvider.switchViewStyle();
    })
  );

  // Switch view style command (UI style)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.switchViewStyle', () => {
      sidebarProvider.switchViewStyle();
    })
  );
}
