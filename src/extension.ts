import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStoreManager } from './store/bookmarkStore';
import { BookmarkSidebarProvider } from './providers/sidebarProvider';
import { DecorationProvider } from './providers/decorationProvider';
import { BookmarkHoverProvider } from './providers/hoverProvider';
import { BookmarkCodeLensProvider } from './providers/codeLensProvider';
import { BookmarkDetailProvider } from './providers/webviewProvider';
import { Bookmark, BookmarkGroup, createDefaultStore } from './store/types';
import { parseLocation, toAbsolutePath } from './utils';

let bookmarkStore: BookmarkStoreManager | undefined;
let sidebarProvider: BookmarkSidebarProvider | undefined;
let decorationProvider: DecorationProvider | undefined;
let codeLensProvider: BookmarkCodeLensProvider | undefined;
let detailProvider: BookmarkDetailProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {

  // Install/update launcher script to fixed location
  installLauncher(context).catch((err: any) => {
    console.error('Failed to install launcher:', err);
  });

  // Get workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Initialize bookmark store
  bookmarkStore = new BookmarkStoreManager(workspaceRoot);

  // Initialize and register sidebar webview provider
  sidebarProvider = new BookmarkSidebarProvider(context.extensionUri, bookmarkStore, workspaceRoot);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mcpBookmarks', sidebarProvider)
  );

  // Initialize decoration provider
  decorationProvider = new DecorationProvider(bookmarkStore, workspaceRoot);

  // Initialize hover provider
  const hoverProvider = new BookmarkHoverProvider(bookmarkStore, workspaceRoot);

  // Register hover provider for all languages
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
  );

  // Initialize and register CodeLens provider
  codeLensProvider = new BookmarkCodeLensProvider(bookmarkStore, workspaceRoot);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  // Initialize bookmark detail provider
  detailProvider = new BookmarkDetailProvider(context.extensionUri, bookmarkStore, workspaceRoot);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'mcpBookmarks.search';
  updateStatusBar();

  // Update status bar when bookmarks change
  bookmarkStore.onDidChange(() => {
    updateStatusBar();
  });

  // Update status bar when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateStatusBar();
    })
  );

  // Listen for document changes to handle line drift
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!bookmarkStore) {
        return;
      }

      const document = event.document;
      // 只处理文件 scheme
      if (document.uri.scheme !== 'file') {
        return;
      }

      // 计算行号变化
      for (const change of event.contentChanges) {
        const startLine = change.range.start.line + 1; // 转为 1-indexed
        const oldLineCount = change.range.end.line - change.range.start.line + 1;
        const newLineCount = change.text.split('\n').length;
        const lineDelta = newLineCount - oldLineCount;

        if (lineDelta !== 0) {
          bookmarkStore.adjustBookmarksForFileChange(
            document.uri.fsPath,
            startLine,
            lineDelta
          );
        }
      }
    })
  );

  // Register commands
  registerCommands(context, workspaceRoot);

  // Add to subscriptions
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push({
    dispose: () => {
      bookmarkStore?.dispose();
      sidebarProvider?.dispose();
      decorationProvider?.dispose();
    }
  });

}

function updateStatusBar(): void {
  if (!statusBarItem || !bookmarkStore) {
    return;
  }

  const allBookmarks = bookmarkStore.getAllBookmarks();
  const groupCount = bookmarkStore.listGroups().length;

  // Get current file bookmark count
  const editor = vscode.window.activeTextEditor;
  let currentFileCount = 0;
  let currentFileInfo = '';

  if (editor && editor.document.uri.scheme === 'file') {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const relativePath = path.relative(workspaceRoot, editor.document.uri.fsPath);

      currentFileCount = allBookmarks.filter(({ bookmark }) => {
        try {
          const parsed = parseLocation(bookmark.location);
          return parsed.filePath === relativePath;
        } catch {
          return false;
        }
      }).length;

      if (currentFileCount > 0) {
        currentFileInfo = ` (${currentFileCount} in file)`;
      }
    }
  }

  if (allBookmarks.length > 0) {
    statusBarItem.text = `$(bookmark) ${allBookmarks.length}${currentFileInfo}`;
    statusBarItem.tooltip = new vscode.MarkdownString();
    statusBarItem.tooltip.appendMarkdown(`**MCP Bookmarks**\n\n`);
    statusBarItem.tooltip.appendMarkdown(`- Total: ${allBookmarks.length} bookmark(s)\n`);
    statusBarItem.tooltip.appendMarkdown(`- Groups: ${groupCount}\n`);
    if (currentFileCount > 0) {
      statusBarItem.tooltip.appendMarkdown(`- Current file: ${currentFileCount}\n`);
    }
    statusBarItem.tooltip.appendMarkdown(`\n*Click to search*`);
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function registerCommands(context: vscode.ExtensionContext, workspaceRoot: string): void {
  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.refresh', () => {
      sidebarProvider?.refresh();
    })
  );

  // Reveal bookmark in sidebar (for CodeLens click)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.revealBookmark', (bookmark: Bookmark, _group: BookmarkGroup) => {
      // Focus and highlight the bookmark in sidebar
      sidebarProvider?.revealBookmark(bookmark.id);
    })
  );

  // Jump to bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.jumpTo', async (bookmark: Bookmark) => {
      if (!bookmark) {
        return;
      }

      const parsed = parseLocation(bookmark.location);

      // Helper to open and jump to document
      const jumpToDocument = async (uri: vscode.Uri) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);

        // 跳转到目标行并选中范围
        const startLine = Math.max(0, parsed.startLine - 1);
        const endLine = Math.max(0, parsed.endLine - 1);

        const range = new vscode.Range(
          new vscode.Position(startLine, 0),
          new vscode.Position(endLine, document.lineAt(endLine).text.length)
        );

        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      };

      // Strategy 1: Try direct path (Relative resolved to workspace, or Absolute as is)
      try {
        const absolutePath = toAbsolutePath(parsed.filePath, workspaceRoot);
        const uri = vscode.Uri.file(absolutePath);
        await jumpToDocument(uri);
        return;
      } catch (error) {
        console.log(`[JumpTo] Direct path failed: ${error}`);
      }

      // Strategy 2: If path is absolute but failed, try to find it in the workspace
      // This handles cases where the project was moved or opened on a different machine
      if (path.isAbsolute(parsed.filePath)) {
        try {
          const fileName = path.basename(parsed.filePath);
          // Find all files with the same name in the workspace
          const foundFiles = await vscode.workspace.findFiles('**/' + fileName);

          if (foundFiles.length > 0) {
            // Find best match by comparing path suffixes
            let bestMatch: vscode.Uri | undefined;
            let maxMatchLength = 0;

            // Normalize separators for comparison
            const targetParts = parsed.filePath.split(/[/\\]/).reverse();

            for (const fileUri of foundFiles) {
              const candidateParts = fileUri.fsPath.split(/[/\\]/).reverse();
              let matchLength = 0;
              
              // Count matching path segments from the end (filename, parent dir, grandparent...)
              for (let i = 0; i < Math.min(targetParts.length, candidateParts.length); i++) {
                if (targetParts[i] === candidateParts[i]) {
                  matchLength++;
                } else {
                  break;
                }
              }

              if (matchLength > maxMatchLength) {
                maxMatchLength = matchLength;
                bestMatch = fileUri;
              }
            }

            if (bestMatch) {
              await jumpToDocument(bestMatch);
              return;
            }
          }
        } catch (error) {
          console.log(`[JumpTo] Smart resolve failed: ${error}`);
        }
      }

      // Strategy 3: Try to find by relative path parts if Strategy 2 failed (or wasn't absolute)
      // e.g. if stored path is "src/utils/file.ts" but it's actually in "backend/src/utils/file.ts"
      try {
         const fileName = path.basename(parsed.filePath);
         const foundFiles = await vscode.workspace.findFiles('**/' + fileName);
         
         // Simple heuristic: just pick the first one if we haven't tried this already
         // (Strategy 2 covers the robust suffix matching for absolute paths, 
         // but if the input was relative and failed `toAbsolutePath`, we might want to search)
         if (foundFiles.length === 1) {
            await jumpToDocument(foundFiles[0]);
            return;
         }
      } catch (e) {
         // Ignore
      }

      // If all strategies fail
      vscode.window.showErrorMessage(
        `Failed to jump to bookmark "${bookmark.title}".\n` +
        `Could not resolve path: ${parsed.filePath}\n` +
        `Please check if the file exists.`
      );
    })
  );

  // Delete bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.delete', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      // Extract bookmark from tree item
      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        return;
      }

      const bookmark = bookmarkItem.bookmark;
      const confirm = await vscode.window.showWarningMessage(
        `Delete bookmark "${bookmark.title}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        bookmarkStore.removeBookmark(bookmark.id);
        vscode.window.showInformationMessage(`Bookmark "${bookmark.title}" deleted`);
      }
    })
  );

  // Delete group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.deleteGroup', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      // Extract group from tree item
      const groupItem = item as { type: string; group?: { id: string; title: string; bookmarks: unknown[] } };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        return;
      }

      const group = groupItem.group;
      const confirm = await vscode.window.showWarningMessage(
        `Delete group "${group.title}" and all ${group.bookmarks.length} bookmark(s)?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        bookmarkStore.removeGroup(group.id);
        vscode.window.showInformationMessage(`Group "${group.title}" deleted`);
      }
    })
  );

  // Add manual bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.addManual', async () => {
      if (!bookmarkStore) {
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      // Get current selection or cursor position
      const selection = editor.selection;
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      // Get file path relative to workspace
      const relativePath = path.relative(workspaceRoot, editor.document.uri.fsPath);
      const location = startLine === endLine
        ? `${relativePath}:${startLine}`
        : `${relativePath}:${startLine}-${endLine}`;

      // Get or create group
      const groups = bookmarkStore.listGroups();
      const groupItems: vscode.QuickPickItem[] = [
        { label: '$(add) Create New Group', description: 'Create a new bookmark group' },
        ...groups.map(g => ({
          label: g.title,
          description: `${g.bookmarks.length} bookmark(s)`,
          detail: g.id
        }))
      ];

      const selectedGroup = await vscode.window.showQuickPick(groupItems, {
        placeHolder: 'Select a group or create a new one'
      });

      if (!selectedGroup) {
        return;
      }

      let groupId: string;

      if (selectedGroup.label === '$(add) Create New Group') {
        const groupTitle = await vscode.window.showInputBox({
          prompt: 'Enter group title',
          placeHolder: 'e.g., Bug fixes, Feature implementation'
        });

        if (!groupTitle) {
          return;
        }

        groupId = bookmarkStore.createGroup(groupTitle, undefined, 'user');
      } else {
        groupId = selectedGroup.detail!;
      }

      // Get bookmark title
      const title = await vscode.window.showInputBox({
        prompt: 'Enter bookmark title',
        placeHolder: 'e.g., Main entry point'
      });

      if (!title) {
        return;
      }

      // Get bookmark description (use editor for multi-line input)
      const description = await editTextInEditor(
        '',
        'Enter bookmark description'
      );

      if (!description) {
        return;
      }

      // Get category
      const categories = [
        { label: 'entry-point', description: 'Entry point to a feature or module' },
        { label: 'core-logic', description: 'Core business logic' },
        { label: 'issue', description: 'Problem, bug, or todo item' },
        { label: 'note', description: 'Explanation or reference' }
      ];

      const selectedCategory = await vscode.window.showQuickPick(categories, {
        placeHolder: 'Select a category (optional)'
      });

      // Capture code snapshot
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = Math.min(editor.document.lineCount, endLine);
      const codeSnapshot = editor.document.getText(
        new vscode.Range(startIdx, 0, endIdx, 0)
      ).trim();

      // Add bookmark with code snapshot
      bookmarkStore.addBookmark(groupId, location, title, description, {
        category: selectedCategory?.label as import('./store/types').BookmarkCategory | undefined,
        codeSnapshot
      });

      vscode.window.showInformationMessage(`Bookmark "${title}" added`);
    })
  );

  // Create group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.createGroup', async () => {
      if (!bookmarkStore) {
        return;
      }

      const title = await vscode.window.showInputBox({
        prompt: 'Enter group title',
        placeHolder: 'e.g., Authentication flow'
      });

      if (!title) {
        return;
      }

      // Use editor for multi-line description
      const description = await editTextInEditor(
        '',
        'Enter group description (optional, close tab to skip)'
      );

      bookmarkStore.createGroup(title, description || undefined, 'user');
      vscode.window.showInformationMessage(`Group "${title}" created`);
    })
  );

  // Export to markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.exportMarkdown', async () => {
      if (!bookmarkStore) {
        return;
      }

      const markdown = bookmarkStore.exportToMarkdown();

      // Create a new untitled document with the markdown content
      const document = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown'
      });

      await vscode.window.showTextDocument(document);

      vscode.window.showInformationMessage('Bookmarks exported to markdown');
    })
  );

  // Search bookmarks command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.search', async () => {
      if (!bookmarkStore) {
        return;
      }

      const allBookmarks = bookmarkStore.getAllBookmarks();
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

  // Check bookmark validity command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.checkValidity', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to check');
        return;
      }

      const bookmark = bookmarkItem.bookmark;

      // Function to read file content
      const getFileContent = async (filePath: string): Promise<string | undefined> => {
        try {
          const uri = vscode.Uri.file(filePath);
          const document = await vscode.workspace.openTextDocument(uri);
          return document.getText();
        } catch {
          return undefined;
        }
      };

      const result = await bookmarkStore.checkBookmarkValidity(bookmark.id, getFileContent);

      if (result.valid) {
        vscode.window.showInformationMessage(
          `Bookmark "${bookmark.title}" is valid. ${result.reason || ''}`
        );
      } else {
        const action = await vscode.window.showWarningMessage(
          `Bookmark "${bookmark.title}" may be invalid: ${result.reason}`,
          'Update Snapshot',
          'Delete Bookmark'
        );

        if (action === 'Update Snapshot') {
          // Update the code snapshot
          try {
            const parsed = parseLocation(bookmark.location);
            const absolutePath = toAbsolutePath(parsed.filePath, workspaceRoot);
            const content = await getFileContent(absolutePath);
            if (content) {
              const lines = content.split('\n');
              const snapshot = lines.slice(parsed.startLine - 1, parsed.endLine).join('\n');
              bookmarkStore.updateBookmarkSnapshot(bookmark.id, snapshot);
              vscode.window.showInformationMessage('Bookmark snapshot updated');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to update snapshot: ${error}`);
          }
        } else if (action === 'Delete Bookmark') {
          bookmarkStore.removeBookmark(bookmark.id);
          vscode.window.showInformationMessage('Bookmark deleted');
        }
      }
    })
  );

  // Edit bookmark command - 改为提示用户在 sidebar 中双击编辑
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.editBookmark', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to edit');
        return;
      }

      const bookmark = bookmarkItem.bookmark;

      // Choose what to edit
      const editOptions = [
        { label: 'Title', description: bookmark.title },
        { label: 'Description (Double-click in sidebar)', description: bookmark.description.substring(0, 50) + '...' },
        { label: 'Category', description: bookmark.category || 'None' }
      ];

      const selected = await vscode.window.showQuickPick(editOptions, {
        placeHolder: 'What do you want to edit?'
      });

      if (!selected) {
        return;
      }

      switch (selected.label) {
        case 'Title': {
          const newTitle = await vscode.window.showInputBox({
            prompt: 'Enter new title',
            value: bookmark.title
          });
          if (newTitle) {
            bookmarkStore.updateBookmark(bookmark.id, { title: newTitle });
            vscode.window.showInformationMessage('Title updated');
          }
          break;
        }
        case 'Description (Double-click in sidebar)': {
          // 提示用户在 sidebar 中双击 description 编辑
          vscode.window.showInformationMessage(
            'Please double-click the description in the MCP Bookmarks sidebar to edit it',
            'Got it'
          );
          // 通知 sidebar 高亮这个书签
          if (sidebarProvider) {
            sidebarProvider.revealBookmark(bookmark.id);
          }
          break;
        }
        case 'Category': {
          const categories = [
            { label: 'None', description: 'No category' },
            { label: 'entry-point', description: 'Entry point' },
            { label: 'core-logic', description: 'Core logic' },
            { label: 'issue', description: 'Issue' },
            { label: 'note', description: 'Note' }
          ];
          const newCat = await vscode.window.showQuickPick(categories, {
            placeHolder: 'Select new category'
          });
          if (newCat) {
            const category = newCat.label === 'None' ? undefined : newCat.label as import('./store/types').BookmarkCategory;
            bookmarkStore.updateBookmark(bookmark.id, { category });
            vscode.window.showInformationMessage('Category updated');
          }
          break;
        }
      }
    })
  );

  // Navigate to next bookmark
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.nextBookmark', async () => {
      await navigateBookmark('next', workspaceRoot);
    })
  );

  // Navigate to previous bookmark
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.prevBookmark', async () => {
      await navigateBookmark('prev', workspaceRoot);
    })
  );

  // Toggle view style command (Nested/Tree)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.toggleViewMode', () => {
      if (sidebarProvider) {
        sidebarProvider.switchViewStyle();
      }
    })
  );

  // Switch view style command (UI style)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.switchViewStyle', () => {
      if (sidebarProvider) {
        sidebarProvider.switchViewStyle();
      }
    })
  );

  // Move bookmark up command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.moveBookmarkUp', (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to move');
        return;
      }

      const success = bookmarkStore.reorderBookmark(bookmarkItem.bookmark.id, 'up');
      if (!success) {
        vscode.window.showInformationMessage('Bookmark is already at the top');
      }
    })
  );

  // Move bookmark down command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.moveBookmarkDown', (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to move');
        return;
      }

      const success = bookmarkStore.reorderBookmark(bookmarkItem.bookmark.id, 'down');
      if (!success) {
        vscode.window.showInformationMessage('Bookmark is already at the bottom');
      }
    })
  );

  // Expand all command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.expandAll', () => {
      if (sidebarProvider) {
        sidebarProvider.expandAll();
      }
    })
  );

  // Collapse all command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.collapseAll', () => {
      if (sidebarProvider) {
        sidebarProvider.collapseAll();
      }
    })
  );

  // Collapse single group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.collapseGroup', (item: unknown) => {
      if (sidebarProvider) {
        const groupItem = item as { type: string; group?: { id: string } };
        if (groupItem?.type === 'group' && groupItem.group) {
          sidebarProvider.collapseGroup(groupItem.group.id);
        }
      }
    })
  );

  // Expand single group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.expandGroup', (item: unknown) => {
      if (sidebarProvider) {
        const groupItem = item as { type: string; group?: { id: string } };
        if (groupItem?.type === 'group' && groupItem.group) {
          sidebarProvider.expandGroup(groupItem.group.id);
        }
      }
    })
  );

  // Edit group command (edit title and description)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.editGroup', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const groupItem = item as { type: string; group?: { id: string; title: string; description?: string } };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        vscode.window.showErrorMessage('Please select a group to edit');
        return;
      }

      const group = groupItem.group;

      // Choose what to edit
      const editOptions = [
        { label: 'Title', description: group.title },
        { label: 'Description', description: group.description || 'None' },
        { label: 'Both', description: 'Edit title and description' }
      ];

      const selected = await vscode.window.showQuickPick(editOptions, {
        placeHolder: 'What do you want to edit?'
      });

      if (!selected) {
        return;
      }

      let newTitle: string | undefined;
      let newDescription: string | undefined;

      if (selected.label === 'Title' || selected.label === 'Both') {
        newTitle = await vscode.window.showInputBox({
          prompt: 'Enter new group title',
          value: group.title
        });
        if (selected.label === 'Title' && !newTitle) {
          return;
        }
      }

      if (selected.label === 'Description' || selected.label === 'Both') {
        newDescription = await editTextInEditor(
          group.description || '',
          'Edit group description'
        );
      }

      const updates: { title?: string; description?: string } = {};
      if (newTitle !== undefined) {
        updates.title = newTitle;
      }
      if (newDescription !== undefined) {
        updates.description = newDescription || undefined;
      }

      if (Object.keys(updates).length > 0) {
        bookmarkStore.updateGroup(group.id, updates);
        vscode.window.showInformationMessage(`Group "${newTitle || group.title}" updated`);
      }
    })
  );

  // Rename group command (quick rename with F2)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.renameGroup', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const groupItem = item as { type: string; group?: { id: string; title: string } };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        vscode.window.showErrorMessage('Please select a group to rename');
        return;
      }

      const group = groupItem.group;
      const newTitle = await vscode.window.showInputBox({
        prompt: 'Enter new group title',
        value: group.title
      });

      if (newTitle && newTitle !== group.title) {
        bookmarkStore.updateGroup(group.id, { title: newTitle });
        vscode.window.showInformationMessage(`Group renamed to "${newTitle}"`);
      }
    })
  );

  // Move bookmark to another group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.moveBookmark', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to move');
        return;
      }

      const bookmark = bookmarkItem.bookmark;
      const groups = bookmarkStore.listGroups();

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
      const success = bookmarkStore.moveBookmarkToGroup(bookmark.id, targetGroupId);

      if (success) {
        vscode.window.showInformationMessage(
          `Bookmark "${bookmark.title}" moved to "${selectedGroup.label}"`
        );
      } else {
        vscode.window.showErrorMessage('Failed to move bookmark');
      }
    })
  );

  // Copy bookmark info command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyBookmarkInfo', async (item: unknown) => {
      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to copy');
        return;
      }

      const bookmark = bookmarkItem.bookmark;
      const infoText = `${bookmark.location}: ${bookmark.title}`;
      await vscode.env.clipboard.writeText(infoText);
      vscode.window.showInformationMessage('Bookmark info copied');
    })
  );

  // Copy group info command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyGroupInfo', async (item: unknown) => {
      const groupItem = item as { type: string; group?: BookmarkGroup };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        vscode.window.showErrorMessage('Please select a group to copy');
        return;
      }

      const group = groupItem.group;
      const infoText = `${group.title}(${group.id})`;
      await vscode.env.clipboard.writeText(infoText);
      vscode.window.showInformationMessage('Group info copied');
    })
  );

  // Copy relative path command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyRelativePath', async (item: unknown) => {
      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to copy');
        return;
      }

      const bookmark = bookmarkItem.bookmark;
      // Extract file path from location (remove :line or :start-end)
      const filePath = bookmark.location.split(':')[0];
      await vscode.env.clipboard.writeText(filePath);
      vscode.window.showInformationMessage('Relative path copied');
    })
  );

  // Copy absolute path command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.copyAbsolutePath', async (item: unknown) => {
      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type !== 'bookmark' || !bookmarkItem.bookmark) {
        vscode.window.showErrorMessage('Please select a bookmark to copy');
        return;
      }

      const bookmark = bookmarkItem.bookmark;
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

  // Add child bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.addChildBookmark', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      // Extract parent bookmark from tree item
      const bookmarkItem = item as { type: string; bookmark?: Bookmark; group?: { id: string; title: string } };
      if (!bookmarkItem?.bookmark || !bookmarkItem?.group) {
        vscode.window.showErrorMessage('Please select a bookmark to add a child to');
        return;
      }

      const parentBookmark = bookmarkItem.bookmark;
      const group = bookmarkItem.group;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor. Please open a file first.');
        return;
      }

      // Get current selection or cursor position
      const selection = editor.selection;
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      // Get file path relative to workspace
      const relativePath = path.relative(workspaceRoot, editor.document.uri.fsPath);
      const location = startLine === endLine
        ? `${relativePath}:${startLine}`
        : `${relativePath}:${startLine}-${endLine}`;

      // Get bookmark title
      const title = await vscode.window.showInputBox({
        prompt: `Enter child bookmark title (parent: "${parentBookmark.title}")`,
        placeHolder: 'e.g., Implementation detail'
      });

      if (!title) {
        return;
      }

      // Get bookmark description (use editor for multi-line input)
      const description = await editTextInEditor(
        '',
        `Enter child bookmark description (parent: "${parentBookmark.title}")`
      );

      if (!description) {
        return;
      }

      // Get category
      const categories = [
        { label: 'entry-point', description: 'Entry point to a feature or module' },
        { label: 'core-logic', description: 'Core business logic' },
        { label: 'issue', description: 'Problem, bug, or todo item' },
        { label: 'note', description: 'Explanation or reference' }
      ];

      const selectedCategory = await vscode.window.showQuickPick(categories, {
        placeHolder: 'Select a category (optional)'
      });

      // Capture code snapshot
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = Math.min(editor.document.lineCount, endLine);
      const codeSnapshot = editor.document.getText(
        new vscode.Range(startIdx, 0, endIdx, 0)
      ).trim();

      // Add child bookmark with parentId
      bookmarkStore.addBookmark(group.id, location, title, description, {
        parentId: parentBookmark.id,
        category: selectedCategory?.label as import('./store/types').BookmarkCategory | undefined,
        codeSnapshot
      });

      vscode.window.showInformationMessage(`Child bookmark "${title}" added under "${parentBookmark.title}"`);
    })
  );

  // Open bookmark detail command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.openBookmarkDetail', (item: unknown) => {
      const bookmarkItem = item as { type: string; bookmark?: Bookmark };
      if (bookmarkItem?.type === 'bookmark' && bookmarkItem.bookmark) {
        detailProvider?.showBookmarkDetail(bookmarkItem.bookmark.id);
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
}

/**
 * Open a temporary editor for multi-line text editing with save confirmation
 * @param initialContent Initial text content
 * @param title Editor title hint
 * @returns Edited text or undefined if cancelled
 */
async function editTextInEditor(initialContent: string, title: string): Promise<string | undefined> {
  // Create a temporary untitled document with instructions
  const instructions = `<!-- ${title} -->\n<!-- Edit the content below. Close this tab when done to save. -->\n<!-- To cancel, close without making changes. -->\n\n${initialContent}`;

  const document = await vscode.workspace.openTextDocument({
    content: instructions,
    language: 'markdown' // Support markdown formatting
  });

  // Open the document in editor
  const editor = await vscode.window.showTextDocument(document, {
    preview: false, // Use full editor, not preview
    viewColumn: vscode.ViewColumn.Beside
  });

  // Position cursor at the content area (skip instructions)
  const contentStartLine = 4; // After instruction comments
  editor.selection = new vscode.Selection(
    new vscode.Position(contentStartLine, 0),
    new vscode.Position(contentStartLine, 0)
  );

  // Wait for user to close the editor
  return new Promise((resolve) => {
    let isResolved = false;

    const disposable = vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
      if (closedDoc === document && !isResolved) {
        isResolved = true;
        disposable.dispose();

        // Get the final content (remove instruction comments)
        const lines = closedDoc.getText().split('\n');
        const contentLines = lines.slice(contentStartLine); // Skip instruction lines
        const finalContent = contentLines.join('\n').trim();

        // Check if content changed
        const contentChanged = finalContent !== initialContent;

        if (!contentChanged) {
          // No change, treat as cancel
          resolve(undefined);
          return;
        }

        // Confirm save if content changed
        const action = await vscode.window.showInformationMessage(
          'Save changes?',
          { modal: true },
          'Save',
          'Discard'
        );

        if (action === 'Save') {
          resolve(finalContent);
        } else {
          resolve(undefined);
        }
      }
    });

    // Show info message with instructions
    vscode.window.showInformationMessage(
      `📝 ${title} - Edit in the opened tab, then close it to continue`,
      { modal: false }
    );
  });
}

// Helper function to navigate between bookmarks
async function navigateBookmark(direction: 'next' | 'prev', workspaceRoot: string): Promise<void> {
  if (!bookmarkStore) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('No active editor');
    return;
  }

  const currentFile = path.relative(workspaceRoot, editor.document.uri.fsPath);
  const currentLine = editor.selection.active.line + 1;

  const allBookmarks = bookmarkStore.getAllBookmarks();
  if (allBookmarks.length === 0) {
    vscode.window.showInformationMessage('No bookmarks available');
    return;
  }

  // Sort bookmarks by file and line
  const sortedBookmarks = allBookmarks
    .map(({ bookmark }) => {
      const parsed = parseLocation(bookmark.location);
      return { bookmark, filePath: parsed.filePath, line: parsed.startLine };
    })
    .sort((a, b) => {
      if (a.filePath !== b.filePath) {
        return a.filePath.localeCompare(b.filePath);
      }
      return a.line - b.line;
    });

  // Find current position in sorted list
  let targetIdx = -1;

  if (direction === 'next') {
    // Find next bookmark after current position
    for (let i = 0; i < sortedBookmarks.length; i++) {
      const bm = sortedBookmarks[i];
      if (bm.filePath > currentFile || (bm.filePath === currentFile && bm.line > currentLine)) {
        targetIdx = i;
        break;
      }
    }
    // Wrap to first if not found
    if (targetIdx === -1) {
      targetIdx = 0;
    }
  } else {
    // Find previous bookmark before current position
    for (let i = sortedBookmarks.length - 1; i >= 0; i--) {
      const bm = sortedBookmarks[i];
      if (bm.filePath < currentFile || (bm.filePath === currentFile && bm.line < currentLine)) {
        targetIdx = i;
        break;
      }
    }
    // Wrap to last if not found
    if (targetIdx === -1) {
      targetIdx = sortedBookmarks.length - 1;
    }
  }

  if (targetIdx >= 0 && targetIdx < sortedBookmarks.length) {
    await vscode.commands.executeCommand('mcpBookmarks.jumpTo', sortedBookmarks[targetIdx].bookmark);
  }
}

/**
 * Install or update the launcher script to a fixed location
 * This allows users to configure MCP once with a fixed path that works across extension updates
 */
async function installLauncher(context: vscode.ExtensionContext): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const crypto = await import('crypto');

  const launcherSrc = path.join(context.extensionPath, 'dist', 'launcher.js');
  const launcherDst = path.join(os.homedir(), '.vscode', 'mcp-bookmarks-launcher.js');

  try {
    // 确保目标目录存在
    await fs.promises.mkdir(path.dirname(launcherDst), { recursive: true });

    // 检查是否需要更新 (通过文件哈希比较)
    const getHash = async (file: string): Promise<string> => {
      const content = await fs.promises.readFile(file);
      return crypto.createHash('md5').update(content).digest('hex');
    };

    // 获取源文件和目标文件的哈希
    const srcHash = await getHash(launcherSrc);
    const dstHash = await getHash(launcherDst).catch(() => null);

    // 只在哈希不同时才复制 (避免每次激活都复制)
    if (srcHash !== dstHash) {
      await fs.promises.copyFile(launcherSrc, launcherDst);

      // Unix 系统: 添加可执行权限
      if (process.platform !== 'win32') {
        await fs.promises.chmod(launcherDst, 0o755);
      }


      // 首次安装时显示提示
      if (!dstHash) {
        vscode.window.showInformationMessage(
          'MCP Bookmarks launcher installed! Use "Copy MCP Setup Command" to configure.',
          'Copy Command'
        ).then(selection => {
          if (selection === 'Copy Command') {
            vscode.commands.executeCommand('mcpBookmarks.copyMCPCommand');
          }
        });
      }
    }
  } catch (error: any) {
    console.error('Failed to install launcher:', error);
    vscode.window.showErrorMessage(
      `Failed to install MCP Bookmarks launcher: ${error.message}`
    );
  }
}

export function deactivate(): void {
  bookmarkStore?.dispose();
  decorationProvider?.dispose();
  codeLensProvider?.dispose();
  detailProvider?.dispose();
}
