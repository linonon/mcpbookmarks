import * as vscode from 'vscode';
import * as path from 'path';
import { Bookmark, BookmarkCategory } from '../store/types';
import { parseLocation, toAbsolutePath } from '../utils';
import { extractBookmark } from '../shared/itemHelpers';
import { editTextInEditor } from '../shared/editorHelpers';
import { BOOKMARK_CATEGORIES } from '../shared/constants';
import { CommandDependencies } from './types';

export function registerBookmarkCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  const { store, sidebarProvider, workspaceRoot } = deps;

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
      const bookmark = extractBookmark(item);
      if (!bookmark) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete bookmark "${bookmark.title}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        store.removeBookmark(bookmark.id);
        vscode.window.showInformationMessage(`Bookmark "${bookmark.title}" deleted`);
      }
    })
  );

  // Add manual bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.addManual', async () => {
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
      const groups = store.listGroups();
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

        groupId = store.createGroup(groupTitle, undefined, 'user');
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
      const selectedCategory = await vscode.window.showQuickPick(BOOKMARK_CATEGORIES, {
        placeHolder: 'Select a category (optional)'
      });

      // Capture code snapshot
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = Math.min(editor.document.lineCount, endLine);
      const codeSnapshot = editor.document.getText(
        new vscode.Range(startIdx, 0, endIdx, 0)
      ).trim();

      // Add bookmark with code snapshot
      store.addBookmark(groupId, location, title, description, {
        category: selectedCategory?.label as BookmarkCategory | undefined,
        codeSnapshot
      });

      vscode.window.showInformationMessage(`Bookmark "${title}" added`);
    })
  );

  // Add child bookmark command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.addChildBookmark', async (item: unknown) => {
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
      const selectedCategory = await vscode.window.showQuickPick(BOOKMARK_CATEGORIES, {
        placeHolder: 'Select a category (optional)'
      });

      // Capture code snapshot
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = Math.min(editor.document.lineCount, endLine);
      const codeSnapshot = editor.document.getText(
        new vscode.Range(startIdx, 0, endIdx, 0)
      ).trim();

      // Add child bookmark with parentId
      store.addBookmark(group.id, location, title, description, {
        parentId: parentBookmark.id,
        category: selectedCategory?.label as BookmarkCategory | undefined,
        codeSnapshot
      });

      vscode.window.showInformationMessage(`Child bookmark "${title}" added under "${parentBookmark.title}"`);
    })
  );

  // Edit bookmark command - 改为提示用户在 sidebar 中双击编辑
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.editBookmark', async (item: unknown) => {
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
            store.updateBookmark(bookmark.id, { title: newTitle });
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
          sidebarProvider.revealBookmark(bookmark.id);
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
            const category = newCat.label === 'None' ? undefined : newCat.label as BookmarkCategory;
            store.updateBookmark(bookmark.id, { category });
            vscode.window.showInformationMessage('Category updated');
          }
          break;
        }
      }
    })
  );

  // Check bookmark validity command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.checkValidity', async (item: unknown) => {
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

      const result = await store.checkBookmarkValidity(bookmark.id, getFileContent);

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
              store.updateBookmarkSnapshot(bookmark.id, snapshot);
              vscode.window.showInformationMessage('Bookmark snapshot updated');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to update snapshot: ${error}`);
          }
        } else if (action === 'Delete Bookmark') {
          store.removeBookmark(bookmark.id);
          vscode.window.showInformationMessage('Bookmark deleted');
        }
      }
    })
  );
}
