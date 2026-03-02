import * as vscode from 'vscode';
import { editTextInEditor } from '../shared/editorHelpers';
import { CommandDependencies } from './types';

export function registerGroupCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  const { store } = deps;

  // Create group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.createGroup', async () => {
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

      store.createGroup(title, description || undefined, 'user');
      vscode.window.showInformationMessage(`Group "${title}" created`);
    })
  );

  // Delete group command
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.deleteGroup', async (item: unknown) => {
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
        store.removeGroup(group.id);
        vscode.window.showInformationMessage(`Group "${group.title}" deleted`);
      }
    })
  );

  // Edit group command (edit title and description)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.editGroup', async (item: unknown) => {
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
        store.updateGroup(group.id, updates);
        vscode.window.showInformationMessage(`Group "${newTitle || group.title}" updated`);
      }
    })
  );

  // Rename group command (quick rename with F2)
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpBookmarks.renameGroup', async (item: unknown) => {
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
        store.updateGroup(group.id, { title: newTitle });
        vscode.window.showInformationMessage(`Group renamed to "${newTitle}"`);
      }
    })
  );
}
