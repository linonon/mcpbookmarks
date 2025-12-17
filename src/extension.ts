import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStoreManager } from './store/bookmarkStore';
import { BookmarkTreeProvider } from './providers/treeProvider';
import { DecorationProvider } from './providers/decorationProvider';
import { BookmarkHoverProvider } from './providers/hoverProvider';
import { BookmarkCodeLensProvider } from './providers/codeLensProvider';
import { Bookmark, BookmarkGroup } from './store/types';
import { parseLocation, toAbsolutePath } from './utils';

let bookmarkStore: BookmarkStoreManager | undefined;
let treeProvider: BookmarkTreeProvider | undefined;
let decorationProvider: DecorationProvider | undefined;
let codeLensProvider: BookmarkCodeLensProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let treeView: vscode.TreeView<unknown> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('AI Bookmarks extension is activating...');

  // Get workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('No workspace folder found, AI Bookmarks will not activate');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Initialize bookmark store
  bookmarkStore = new BookmarkStoreManager(workspaceRoot);

  // Initialize tree provider
  treeProvider = new BookmarkTreeProvider(bookmarkStore);

  // Register tree view
  treeView = vscode.window.createTreeView('aiBookmarks', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });

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

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'aiBookmarks.search';
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
  context.subscriptions.push(treeView);
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push({
    dispose: () => {
      bookmarkStore?.dispose();
      treeProvider?.dispose();
      decorationProvider?.dispose();
    }
  });

  console.log('AI Bookmarks extension activated');
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
    statusBarItem.tooltip.appendMarkdown(`**AI Bookmarks**\n\n`);
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
    vscode.commands.registerCommand('aiBookmarks.refresh', () => {
      treeProvider?.refresh();
    })
  );

  // Reveal bookmark in tree view (for CodeLens click)
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.revealBookmark', (bookmark: Bookmark, group: BookmarkGroup) => {
      if (!treeView || !treeProvider) {
        return;
      }
      const treeItem = { type: 'bookmark' as const, bookmark, group };
      treeView.reveal(treeItem, { select: true, focus: true, expand: true });
    })
  );

  // Jump to bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.jumpTo', async (bookmark: Bookmark) => {
      if (!bookmark) {
        return;
      }

      try {
        const parsed = parseLocation(bookmark.location);
        const absolutePath = toAbsolutePath(parsed.filePath, workspaceRoot);
        const uri = vscode.Uri.file(absolutePath);

        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);

        // Go to the start line (0-indexed)
        const startLine = Math.max(0, parsed.startLine - 1);
        const endLine = Math.max(0, parsed.endLine - 1);

        const range = new vscode.Range(
          new vscode.Position(startLine, 0),
          new vscode.Position(endLine, 0)
        );

        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to jump to bookmark: ${error}`);
      }
    })
  );

  // Delete bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.delete', async (item: unknown) => {
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
    vscode.commands.registerCommand('aiBookmarks.deleteGroup', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      // Extract group from tree item
      const groupItem = item as { type: string; group?: { id: string; name: string; bookmarks: unknown[] } };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        return;
      }

      const group = groupItem.group;
      const confirm = await vscode.window.showWarningMessage(
        `Delete group "${group.name}" and all ${group.bookmarks.length} bookmark(s)?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        bookmarkStore.removeGroup(group.id);
        vscode.window.showInformationMessage(`Group "${group.name}" deleted`);
      }
    })
  );

  // Add manual bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.addManual', async () => {
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
          label: g.name,
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
        const groupName = await vscode.window.showInputBox({
          prompt: 'Enter group name',
          placeHolder: 'e.g., Bug fixes, Feature implementation'
        });

        if (!groupName) {
          return;
        }

        groupId = bookmarkStore.createGroup(groupName, undefined, undefined, 'user');
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

      // Get bookmark description
      const description = await vscode.window.showInputBox({
        prompt: 'Enter bookmark description',
        placeHolder: 'Describe what this code does...'
      });

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
    vscode.commands.registerCommand('aiBookmarks.createGroup', async () => {
      if (!bookmarkStore) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Enter group name',
        placeHolder: 'e.g., Authentication flow'
      });

      if (!name) {
        return;
      }

      const description = await vscode.window.showInputBox({
        prompt: 'Enter group description (optional)',
        placeHolder: 'Describe the purpose of this group...'
      });

      bookmarkStore.createGroup(name, description || undefined, undefined, 'user');
      vscode.window.showInformationMessage(`Group "${name}" created`);
    })
  );

  // Export to markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.exportMarkdown', async () => {
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
    vscode.commands.registerCommand('aiBookmarks.search', async () => {
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
          detail: `[${group.name}] ${bookmark.description.substring(0, 100)}${bookmark.description.length > 100 ? '...' : ''}`,
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
        vscode.commands.executeCommand('aiBookmarks.jumpTo', selected.bookmark);
      }
    })
  );

  // Check bookmark validity command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.checkValidity', async (item: unknown) => {
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

  // Edit bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.editBookmark', async (item: unknown) => {
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
        { label: 'Description', description: bookmark.description.substring(0, 50) + '...' },
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
        case 'Description': {
          const newDesc = await vscode.window.showInputBox({
            prompt: 'Enter new description',
            value: bookmark.description
          });
          if (newDesc) {
            bookmarkStore.updateBookmark(bookmark.id, { description: newDesc });
            vscode.window.showInformationMessage('Description updated');
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
    vscode.commands.registerCommand('aiBookmarks.nextBookmark', async () => {
      await navigateBookmark('next', workspaceRoot);
    })
  );

  // Navigate to previous bookmark
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.prevBookmark', async () => {
      await navigateBookmark('prev', workspaceRoot);
    })
  );

  // Toggle view mode command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.toggleViewMode', () => {
      if (treeProvider) {
        treeProvider.toggleViewMode();
        const mode = treeProvider.viewMode === 'group' ? 'Group' : 'File';
        vscode.window.showInformationMessage(`View mode: ${mode}`);
      }
    })
  );

  // Move bookmark up command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.moveBookmarkUp', (item: unknown) => {
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
    vscode.commands.registerCommand('aiBookmarks.moveBookmarkDown', (item: unknown) => {
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
    vscode.commands.registerCommand('aiBookmarks.expandAll', async () => {
      if (!treeProvider || !treeView) {
        return;
      }

      // 获取所有根节点并展开
      const rootItems = await treeProvider.getChildren();
      if (rootItems && rootItems.length > 0) {
        for (const item of rootItems) {
          try {
            await treeView.reveal(item, { expand: 3, select: false, focus: false });
          } catch {
            // 忽略展开失败的节点
          }
        }
      }
    })
  );

  // Collapse all command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.collapseAll', async () => {
      if (!treeProvider || !treeView) {
        return;
      }

      // 获取所有根节点并折叠
      const rootItems = await treeProvider.getChildren();
      if (rootItems && rootItems.length > 0) {
        for (const item of rootItems) {
          try {
            await treeView.reveal(item, { expand: false, select: false, focus: false });
          } catch {
            // 忽略折叠失败的节点
          }
        }
      }
    })
  );

  // Edit group command (edit name and description)
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.editGroup', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const groupItem = item as { type: string; group?: { id: string; name: string; description?: string } };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        vscode.window.showErrorMessage('Please select a group to edit');
        return;
      }

      const group = groupItem.group;

      // Choose what to edit
      const editOptions = [
        { label: 'Name', description: group.name },
        { label: 'Description', description: group.description || 'None' },
        { label: 'Both', description: 'Edit name and description' }
      ];

      const selected = await vscode.window.showQuickPick(editOptions, {
        placeHolder: 'What do you want to edit?'
      });

      if (!selected) {
        return;
      }

      let newName: string | undefined;
      let newDescription: string | undefined;

      if (selected.label === 'Name' || selected.label === 'Both') {
        newName = await vscode.window.showInputBox({
          prompt: 'Enter new group name',
          value: group.name
        });
        if (selected.label === 'Name' && !newName) {
          return;
        }
      }

      if (selected.label === 'Description' || selected.label === 'Both') {
        newDescription = await vscode.window.showInputBox({
          prompt: 'Enter new group description',
          value: group.description || ''
        });
      }

      const updates: { name?: string; description?: string } = {};
      if (newName !== undefined) {
        updates.name = newName;
      }
      if (newDescription !== undefined) {
        updates.description = newDescription || undefined;
      }

      if (Object.keys(updates).length > 0) {
        bookmarkStore.updateGroup(group.id, updates);
        vscode.window.showInformationMessage(`Group "${newName || group.name}" updated`);
      }
    })
  );

  // Rename group command (quick rename with F2)
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.renameGroup', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      const groupItem = item as { type: string; group?: { id: string; name: string } };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        vscode.window.showErrorMessage('Please select a group to rename');
        return;
      }

      const group = groupItem.group;
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new group name',
        value: group.name
      });

      if (newName && newName !== group.name) {
        bookmarkStore.updateGroup(group.id, { name: newName });
        vscode.window.showInformationMessage(`Group renamed to "${newName}"`);
      }
    })
  );

  // Move bookmark to another group command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.moveBookmark', async (item: unknown) => {
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
          label: g.name,
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
    vscode.commands.registerCommand('aiBookmarks.copyBookmarkInfo', async (item: unknown) => {
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
    vscode.commands.registerCommand('aiBookmarks.copyGroupInfo', async (item: unknown) => {
      const groupItem = item as { type: string; group?: BookmarkGroup };
      if (groupItem?.type !== 'group' || !groupItem.group) {
        vscode.window.showErrorMessage('Please select a group to copy');
        return;
      }

      const infoText = `[Bookmark Group] ${groupItem.group.name}`;
      await vscode.env.clipboard.writeText(infoText);
      vscode.window.showInformationMessage('Group info copied');
    })
  );

  // Add child bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBookmarks.addChildBookmark', async (item: unknown) => {
      if (!bookmarkStore) {
        return;
      }

      // Extract parent bookmark from tree item
      const bookmarkItem = item as { type: string; bookmark?: Bookmark; group?: { id: string; name: string } };
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

      // Get bookmark description
      const description = await vscode.window.showInputBox({
        prompt: 'Enter bookmark description',
        placeHolder: 'Describe what this code does...'
      });

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
    await vscode.commands.executeCommand('aiBookmarks.jumpTo', sortedBookmarks[targetIdx].bookmark);
  }
}

export function deactivate(): void {
  bookmarkStore?.dispose();
  treeProvider?.dispose();
  decorationProvider?.dispose();
  codeLensProvider?.dispose();
}
