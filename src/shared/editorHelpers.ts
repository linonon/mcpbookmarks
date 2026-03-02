import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { parseLocation } from '../utils';

/**
 * 在临时编辑器中编辑多行文本, 关闭后确认保存
 * @param initialContent 初始文本内容
 * @param title 编辑器标题提示
 * @returns 编辑后的文本, 取消则返回 undefined
 */
export async function editTextInEditor(initialContent: string, title: string): Promise<string | undefined> {
  // 创建带指示说明的临时文档
  const instructions = `<!-- ${title} -->\n<!-- Edit the content below. Close this tab when done to save. -->\n<!-- To cancel, close without making changes. -->\n\n${initialContent}`;

  const document = await vscode.workspace.openTextDocument({
    content: instructions,
    language: 'markdown'
  });

  // 在编辑器中打开
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.ViewColumn.Beside
  });

  // 将光标定位到内容区域 (跳过指示注释)
  const contentStartLine = 4;
  editor.selection = new vscode.Selection(
    new vscode.Position(contentStartLine, 0),
    new vscode.Position(contentStartLine, 0)
  );

  // 等待用户关闭编辑器
  return new Promise((resolve) => {
    let isResolved = false;

    const disposable = vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
      if (closedDoc === document && !isResolved) {
        isResolved = true;
        disposable.dispose();

        // 提取最终内容 (去除指示注释)
        const lines = closedDoc.getText().split('\n');
        const contentLines = lines.slice(contentStartLine);
        const finalContent = contentLines.join('\n').trim();

        // 检查内容是否变更
        const contentChanged = finalContent !== initialContent;

        if (!contentChanged) {
          resolve(undefined);
          return;
        }

        // 确认保存
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

    vscode.window.showInformationMessage(
      `Edit: ${title} - Edit in the opened tab, then close it to continue`,
      { modal: false }
    );
  });
}

/**
 * 在书签之间导航 (上一个/下一个)
 */
export async function navigateBookmark(
  store: BookmarkStoreManager,
  direction: 'next' | 'prev',
  workspaceRoot: string
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('No active editor');
    return;
  }

  const currentFile = path.relative(workspaceRoot, editor.document.uri.fsPath);
  const currentLine = editor.selection.active.line + 1;

  const allBookmarks = store.getAllBookmarks();
  if (allBookmarks.length === 0) {
    vscode.window.showInformationMessage('No bookmarks available');
    return;
  }

  // 按文件和行号排序
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

  // 在排序列表中找到当前位置
  let targetIdx = -1;

  if (direction === 'next') {
    for (let i = 0; i < sortedBookmarks.length; i++) {
      const bm = sortedBookmarks[i];
      if (bm.filePath > currentFile || (bm.filePath === currentFile && bm.line > currentLine)) {
        targetIdx = i;
        break;
      }
    }
    // 未找到则回绕到第一个
    if (targetIdx === -1) {
      targetIdx = 0;
    }
  } else {
    for (let i = sortedBookmarks.length - 1; i >= 0; i--) {
      const bm = sortedBookmarks[i];
      if (bm.filePath < currentFile || (bm.filePath === currentFile && bm.line < currentLine)) {
        targetIdx = i;
        break;
      }
    }
    // 未找到则回绕到最后一个
    if (targetIdx === -1) {
      targetIdx = sortedBookmarks.length - 1;
    }
  }

  if (targetIdx >= 0 && targetIdx < sortedBookmarks.length) {
    await vscode.commands.executeCommand('mcpBookmarks.jumpTo', sortedBookmarks[targetIdx].bookmark);
  }
}
