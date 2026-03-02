import * as vscode from 'vscode';
import { Bookmark } from '../store/types';
import { navigateBookmark } from '../shared/editorHelpers';
import { CommandDependencies } from './types';

export function registerNavigationCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  const { store, workspaceRoot } = deps;

  // Navigate to next bookmark
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.nextBookmark', async () => {
      await navigateBookmark(store, 'next', workspaceRoot);
    })
  );

  // Navigate to previous bookmark
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.prevBookmark', async () => {
      await navigateBookmark(store, 'prev', workspaceRoot);
    })
  );

  // Search bookmarks command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.search', async () => {
      const allBookmarks = store.getAllBookmarks();
      if (allBookmarks.length === 0) {
        vscode.window.showInformationMessage('No bookmarks to search');
        return;
      }

      // Create quick pick items
      const items: Array<vscode.QuickPickItem & { bookmark: Bookmark }> = allBookmarks.map(
        ({ bookmark, group }) => ({
          label: `${bookmark.order}. ${bookmark.title}`,
          description: bookmark.location,
          detail: `[${group.title}] ${bookmark.description.substring(0, 100)}${bookmark.description.length > 100 ? '...' : ''}`,
          bookmark
        })
      );

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search bookmarks by title, location, or description',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (selected) {
        // Jump to the selected bookmark
        vscode.commands.executeCommand('mcpBookmarks.jumpTo', selected.bookmark);
      }
    })
  );
}
