import * as vscode from 'vscode';
import * as fs from 'fs';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { BookmarkGroup, Bookmark } from '../store/types';
import { parseLocation, toAbsolutePath } from '../utils';

export class BookmarkSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiBookmarks';

  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _viewMode: 'group' | 'file' = 'group';

  /**
   * 获取当前视图模式
   */
  public get viewMode(): 'group' | 'file' {
    return this._viewMode;
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bookmarkStore: BookmarkStoreManager,
    private readonly workspaceRoot: string
  ) {
    // 监听 BookmarkStore 变化, 自动刷新
    this._disposables.push(
      this.bookmarkStore.onDidChange(() => {
        this.refresh();
      })
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webview')
      ]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // 监听来自 Webview 的消息
    webviewView.webview.onDidReceiveMessage(
      message => this.handleMessage(message),
      null,
      this._disposables
    );

    // 视图可见时刷新数据
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });

    // 初始化数据
    this.refresh();
  }

  /**
   * 刷新侧边栏数据
   */
  public refresh(): void {
    if (!this._view) {
      return;
    }

    const groups = this.bookmarkStore.listGroups();
    const viewMode = vscode.workspace.getConfiguration('aiBookmarks').get<string>('viewMode') || 'group';

    this._view.webview.postMessage({
      type: 'refresh',
      data: {
        groups,
        viewMode
      }
    });
  }

  /**
   * 切换视图模式 (group/file)
   */
  public toggleViewMode(): void {
    this._viewMode = this._viewMode === 'group' ? 'file' : 'group';
    vscode.workspace.getConfiguration('aiBookmarks').update('viewMode', this._viewMode, true);
    this.refresh();
  }

  /**
   * 展开所有分组和书签
   */
  public expandAll(): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'expandAll'
    });
  }

  /**
   * 折叠所有分组和书签
   */
  public collapseAll(): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'collapseAll'
    });
  }

  /**
   * 聚焦到指定书签 (用于 CodeLens 点击)
   */
  public revealBookmark(bookmarkId: string): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'revealBookmark',
      bookmarkId
    });
  }

  /**
   * 处理来自 Webview 的消息
   */
  private async handleMessage(message: {
    type: string;
    bookmarkId?: string;
    groupId?: string;
    expanded?: boolean;
    query?: string;
    message?: string;
  }): Promise<void> {
    switch (message.type) {
      case 'jumpToBookmark':
        if (message.bookmarkId) {
          await this.jumpToBookmark(message.bookmarkId);
        }
        break;

      case 'toggleGroup':
        // 展开/折叠分组状态可以在这里处理或存储
        break;

      case 'toggleBookmark':
        // 展开/折叠书签子项
        if (message.bookmarkId) {
          this.bookmarkStore.toggleBookmarkCollapsed(message.bookmarkId);
        }
        break;

      case 'searchBookmarks':
        // 弹出输入框让用户输入搜索关键词
        const query = await vscode.window.showInputBox({
          placeHolder: 'Search bookmarks by title, description or location...',
          prompt: 'Enter search query'
        });
        if (query) {
          this.performSearch(query);
        }
        break;

      case 'search':
        if (message.query !== undefined) {
          this.performSearch(message.query);
        }
        break;

      case 'deleteBookmark':
        if (message.bookmarkId) {
          const confirmDelete = vscode.workspace.getConfiguration('aiBookmarks').get<boolean>('confirmBeforeDelete', true);
          if (confirmDelete) {
            const confirm = await vscode.window.showWarningMessage(
              'Delete this bookmark?',
              { modal: true },
              'Delete'
            );
            if (confirm !== 'Delete') {
              return;
            }
          }
          this.bookmarkStore.removeBookmark(message.bookmarkId);
        }
        break;

      case 'deleteGroup':
        if (message.groupId) {
          const confirmDelete = vscode.workspace.getConfiguration('aiBookmarks').get<boolean>('confirmBeforeDelete', true);
          if (confirmDelete) {
            const confirm = await vscode.window.showWarningMessage(
              'Delete this group and all its bookmarks?',
              { modal: true },
              'Delete'
            );
            if (confirm !== 'Delete') {
              return;
            }
          }
          this.bookmarkStore.removeGroup(message.groupId);
        }
        break;

      case 'editBookmark':
        if (message.bookmarkId) {
          const editResult = this.bookmarkStore.getBookmark(message.bookmarkId);
          if (editResult) {
            vscode.commands.executeCommand('aiBookmarks.editBookmark', {
              type: 'bookmark',
              bookmark: editResult.bookmark
            });
          }
        }
        break;

      case 'editGroup':
        if (message.groupId) {
          vscode.commands.executeCommand('aiBookmarks.editGroup', { id: message.groupId });
        }
        break;

      case 'ready':
        // Webview 已加载完成, 发送初始数据
        this.refresh();
        break;

      case 'showInfo':
        if (message.message) {
          vscode.window.showInformationMessage(message.message as string);
        }
        break;

      case 'createGroup':
        // 创建新分组
        vscode.commands.executeCommand('aiBookmarks.createGroup');
        break;

      case 'exportBookmarks':
        // 导出书签
        vscode.commands.executeCommand('aiBookmarks.exportMarkdown');
        break;

      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * 跳转到书签位置
   */
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

      // 跳转到指定行并选中
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

  /**
   * 执行搜索
   */
  private performSearch(query: string): void {
    if (!this._view) {
      return;
    }

    if (!query.trim()) {
      // 空查询, 恢复正常显示
      this.refresh();
      return;
    }

    const allBookmarks = this.bookmarkStore.getAllBookmarks();
    const lowerQuery = query.toLowerCase();

    const results = allBookmarks.filter(({ bookmark, group }) => {
      return (
        bookmark.title.toLowerCase().includes(lowerQuery) ||
        bookmark.description.toLowerCase().includes(lowerQuery) ||
        bookmark.location.toLowerCase().includes(lowerQuery) ||
        group.name.toLowerCase().includes(lowerQuery)
      );
    });

    this._view.webview.postMessage({
      type: 'searchResults',
      data: {
        query,
        results
      }
    });
  }

  /**
   * 获取 HTML 内容
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'sidebar.html');
    const cssPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'sidebar.css');
    const jsPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'sidebar.js');

    const cssUri = webview.asWebviewUri(cssPath);
    const jsUri = webview.asWebviewUri(jsPath);

    let htmlContent = '';
    try {
      htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
    } catch (error) {
      console.error('Failed to read sidebar HTML template:', error);
      htmlContent = this.getDefaultHtmlTemplate();
    }

    // 替换占位符
    htmlContent = htmlContent
      .replace(/\{\{cssUri\}\}/g, cssUri.toString())
      .replace(/\{\{jsUri\}\}/g, jsUri.toString())
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);

    return htmlContent;
  }

  /**
   * 默认 HTML 模板 (备用)
   */
  private getDefaultHtmlTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src {{cspSource}};">
  <title>AI Bookmarks</title>
  <link rel="stylesheet" href="{{cssUri}}">
</head>
<body>
  <div class="loading">Loading bookmarks...</div>
  <script src="{{jsUri}}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    this._disposables.forEach(d => d.dispose());
  }
}
