import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { Bookmark, BookmarkGroup } from '../store/types';
import { parseLocation, getCategoryDisplayName, toAbsolutePath } from '../utils';

export class BookmarkDetailProvider {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private currentBookmarkId: string | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bookmarkStore: BookmarkStoreManager,
    private readonly workspaceRoot: string
  ) {
    // 监听 BookmarkStore 变化, 自动更新当前显示的书签
    this.disposables.push(
      this.bookmarkStore.onDidChange(() => {
        if (this.currentBookmarkId && BookmarkDetailProvider.currentPanel) {
          this.updateCurrentBookmark(this.currentBookmarkId);
        }
      })
    );
  }

  /**
   * 显示书签详情面板
   */
  public showBookmarkDetail(bookmarkId: string): void {
    if (BookmarkDetailProvider.currentPanel) {
      // 如果面板已存在, 更新内容并聚焦
      this.updateCurrentBookmark(bookmarkId);
      BookmarkDetailProvider.currentPanel.reveal(vscode.ViewColumn.Beside);
    } else {
      // 创建新面板
      this.createPanel(bookmarkId);
    }
  }

  private createPanel(bookmarkId: string): void {
    const panel = vscode.window.createWebviewPanel(
      'aiBookmarkDetail',
      'Bookmark Detail',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'src', 'webview')
        ]
      }
    );

    BookmarkDetailProvider.currentPanel = panel;
    this.currentBookmarkId = bookmarkId;

    // 设置 HTML 内容
    panel.webview.html = this.getWebviewContent(panel.webview);

    // 监听面板关闭事件
    panel.onDidDispose(() => {
      BookmarkDetailProvider.currentPanel = undefined;
      this.currentBookmarkId = undefined;
    }, null, this.disposables);

    // 监听来自 Webview 的消息
    panel.webview.onDidReceiveMessage(
      message => {
        this.handleWebviewMessage(message);
      },
      null,
      this.disposables
    );

    // 初始化数据
    this.updateCurrentBookmark(bookmarkId);
  }

  private updateCurrentBookmark(bookmarkId: string): void {
    const panel = BookmarkDetailProvider.currentPanel;
    if (!panel) {
      return;
    }

    const result = this.bookmarkStore.getBookmark(bookmarkId);
    if (!result) {
      vscode.window.showErrorMessage(`Bookmark not found: ${bookmarkId}`);
      return;
    }

    this.currentBookmarkId = bookmarkId;

    const { bookmark, group } = result;

    // 获取父书签信息
    let parentInfo: { id: string; title: string } | undefined;
    if (bookmark.parentId) {
      const parentResult = this.bookmarkStore.getBookmark(bookmark.parentId);
      if (parentResult) {
        parentInfo = {
          id: parentResult.bookmark.id,
          title: parentResult.bookmark.title
        };
      }
    }

    // 获取子书签信息
    const children = this.bookmarkStore.getChildBookmarks(bookmarkId).map(({ bookmark }) => ({
      id: bookmark.id,
      title: bookmark.title,
      location: bookmark.location
    }));

    // 发送初始化消息
    panel.webview.postMessage({
      type: 'init',
      data: {
        bookmark: {
          id: bookmark.id,
          title: bookmark.title,
          location: bookmark.location,
          description: bookmark.description,
          category: bookmark.category,
          order: bookmark.order
        },
        group: {
          id: group.id,
          title: group.title,
          createdBy: group.createdBy
        },
        parent: parentInfo,
        children,
        hasChildren: children.length > 0
      }
    });

    // 更新面板标题
    panel.title = `📍 ${bookmark.title}`;
  }

  private handleWebviewMessage(message: { type: string; bookmarkId?: string }): void {
    switch (message.type) {
      case 'jumpToCode':
        if (message.bookmarkId) {
          this.jumpToBookmark(message.bookmarkId);
        }
        break;

      case 'navigateToBookmark':
        if (message.bookmarkId) {
          this.showBookmarkDetail(message.bookmarkId);
        }
        break;

      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  private async jumpToBookmark(bookmarkId: string): Promise<void> {
    const result = this.bookmarkStore.getBookmark(bookmarkId);
    if (!result) {
      vscode.window.showErrorMessage(`Bookmark not found: ${bookmarkId}`);
      return;
    }

    const { bookmark } = result;

    try {
      const parsed = parseLocation(bookmark.location);
      const absolutePath = toAbsolutePath(parsed.filePath, this.workspaceRoot);

      const uri = vscode.Uri.file(absolutePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

      // 跳转到指定行并选中范围
      const range = new vscode.Range(
        parsed.startLine - 1,
        0,
        parsed.endLine - 1,
        document.lineAt(parsed.endLine - 1).text.length
      );

      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to jump to bookmark: ${error}`);
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    // 尝试打包后的路径 (dist/webview), 如果失败则使用开发路径 (src/webview)
    let htmlPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'detailPanel.html');
    let cssPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'detailPanel.css');
    let jsPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'detailPanel.js');

    // 如果打包路径不存在, 使用开发路径
    if (!fs.existsSync(htmlPath.fsPath)) {
      htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'detailPanel.html');
      cssPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'detailPanel.css');
      jsPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'detailPanel.js');
    }

    // 转换为 Webview URI
    const cssUri = webview.asWebviewUri(cssPath);
    const jsUri = webview.asWebviewUri(jsPath);

    // 读取 HTML 模板
    let htmlContent = '';
    try {
      htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
    } catch (error) {
      console.error('Failed to read HTML template:', error);
      htmlContent = this.getDefaultHtmlTemplate();
    }

    // 替换占位符
    htmlContent = htmlContent
      .replace(/\{\{cssUri\}\}/g, cssUri.toString())
      .replace(/\{\{jsUri\}\}/g, jsUri.toString())
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);

    return htmlContent;
  }

  private getDefaultHtmlTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src {{cspSource}};">
  <title>Bookmark Detail</title>
  <link rel="stylesheet" href="{{cssUri}}">
</head>
<body>
  <div class="loading">Loading...</div>
  <script src="{{jsUri}}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    BookmarkDetailProvider.currentPanel?.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
