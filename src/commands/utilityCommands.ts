import * as vscode from 'vscode';
import * as path from 'path';
import { Bookmark, BookmarkGroup, createDefaultStore } from '../store/types';
import { extractBookmark } from '../shared/itemHelpers';
import { toAbsolutePath } from '../utils';
import { CommandDependencies } from './types';

export function registerUtilityCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  const { store, sidebarProvider, detailProvider, workspaceRoot } = deps;

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.refresh', () => {
      sidebarProvider.refresh();
    })
  );

  // Reveal bookmark in sidebar (for CodeLens click)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.revealBookmark', (bookmark: Bookmark, _group: BookmarkGroup) => {
      // Focus and highlight the bookmark in sidebar
      sidebarProvider.revealBookmark(bookmark.id);
    })
  );

  // Export to markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.exportMarkdown', async () => {
      const markdown = store.exportToMarkdown();

      // Create a new untitled document with the markdown content
      const document = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown'
      });

      await vscode.window.showTextDocument(document);

      vscode.window.showInformationMessage('Bookmarks exported to markdown');
    })
  );

  // Open bookmark detail command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.openBookmarkDetail', (item: unknown) => {
      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type === 'bookmark' && bookmarkItem.bookmark) {
        detailProvider.showBookmarkDetail(bookmarkItem.bookmark.id);
      }
    })
  );

  // Open file command (for clickable links in hover)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.openFile', async (args: { path: string; line?: number }) => {
      try {
        const { path: filePath, line } = args;

        // Helper to open and jump to document
        const jumpToDocument = async (uri: vscode.Uri) => {
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);

          if (line !== undefined) {
            const targetLine = Math.max(0, line - 1); // Convert to 0-indexed
            const position = new vscode.Position(targetLine, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );
          }
        };

        try {
          // 1. 先尝试相对路径(相对于当前工作区)
          const relativePath = toAbsolutePath(filePath, workspaceRoot);
          const uri = vscode.Uri.file(relativePath);
          await jumpToDocument(uri);
        } catch (error) {
          // 2. 如果失败, 尝试将路径作为绝对路径
          try {
            const absoluteUri = vscode.Uri.file(filePath);
            await jumpToDocument(absoluteUri);
          } catch (error2) {
            vscode.window.showErrorMessage(
              `Failed to open file "${filePath}".\n` +
              `Error: ${error2}`
            );
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to parse file link: ${error}`);
      }
    })
  );

  // Open bookmark store file
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.openStoreFile', async () => {
      try {
        const fs = await import('fs');
        const storePath = path.join(workspaceRoot, '.vscode', 'mcp-bookmarks.json');

        if (!fs.existsSync(storePath)) {
          const defaultStore = createDefaultStore(path.basename(workspaceRoot));
          fs.mkdirSync(path.dirname(storePath), { recursive: true });
          fs.writeFileSync(storePath, JSON.stringify(defaultStore, null, 2), 'utf-8');
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(storePath));
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open mcp-bookmarks.json: ${error}`);
      }
    })
  );

  // Move bookmark up command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.moveBookmarkUp', (item: unknown) => {
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to move');
        return;
      }

      const success = store.reorderBookmark(bookmark.id, 'up');
      if (!success) {
        vscode.window.showInformationMessage('Bookmark is already at the top');
      }
    })
  );

  // Move bookmark down command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.moveBookmarkDown', (item: unknown) => {
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to move');
        return;
      }

      const success = store.reorderBookmark(bookmark.id, 'down');
      if (!success) {
        vscode.window.showInformationMessage('Bookmark is already at the bottom');
      }
    })
  );

  // Move bookmark to another group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.moveBookmark', async (item: unknown) => {
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to move');
        return;
      }

      const groups = store.listGroups();

      if (groups.length < 2) {
        vscode.window.showInformationMessage('Need at least 2 groups to move bookmarks');
        return;
      }

      // Find current group
      const currentGroup = groups.find(g => g.bookmarks.some(b => b.id === bookmark.id));
      if (!currentGroup) {
        vscode.window.showErrorMessage('Cannot find the group containing this bookmark');
        return;
      }

      // Show other groups to choose from
      const groupItems = groups
        .filter(g => g.id !== currentGroup.id)
        .map(g => ({
          label: g.title,
          description: `${g.bookmarks.length} bookmark(s)`,
          detail: g.id
        }));

      const selectedGroup = await vscode.window.showQuickPick(groupItems, {
        placeHolder: `Move "${bookmark.title}" to which group?`
      });

      if (!selectedGroup) {
        return;
      }

      const targetGroupId = selectedGroup.detail!;
      const success = store.moveBookmarkToGroup(bookmark.id, targetGroupId);

      if (success) {
        vscode.window.showInformationMessage(
          `Bookmark "${bookmark.title}" moved to "${selectedGroup.label}"`
        );
      } else {
        vscode.window.showErrorMessage('Failed to move bookmark');
      }
    })
  );
}
