import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { BookmarkGroup, Bookmark } from '../store/types';
import { parseLocation, toAbsolutePath } from '../utils';
import { ConfigManager } from '../config/settings';

export class BookmarkSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mcpBookmarks';

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

    // 监听配置变化 (字体、层级颜色等), 更新 CSS 变量
    this._disposables.push(
      ConfigManager.onConfigChanged(() => {
        this.updateFontSize();
        this.updateHierarchyColors();
      })
    );

    // 监听视图风格变化
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('mcpBookmarks.viewStyle')) {
          this.refresh();
        }
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
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
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
    const config = vscode.workspace.getConfiguration('mcpBookmarks');
    const viewMode = config.get<string>('viewMode') || 'group';
    const viewStyle = config.get<string>('viewStyle') || 'nested';

    this._view.webview.postMessage({
      type: 'refresh',
      data: {
        groups,
        viewMode,
        viewStyle
      }
    });

    // 同时发送字体和颜色配置
    this.updateFontSize();
    this.updateHierarchyColors();
  }

  /**
   * 更新字体大小配置
   */
  private updateFontSize(): void {
    if (!this._view) {
      return;
    }

    const fontSize = ConfigManager.getFontSizeConfig();
    this._view.webview.postMessage({
      type: 'updateFontSize',
      config: fontSize
    });
  }

  /**
   * 更新层级颜色配置
   */
  private updateHierarchyColors(): void {
    if (!this._view) {
      return;
    }

    const colors = ConfigManager.getHierarchyColorConfig();
    this._view.webview.postMessage({
      type: 'updateHierarchyColors',
      config: colors
    });
  }

  /**
   * 切换 UI 视图风格 (Nested/Tree)
   */
  public async switchViewStyle(): Promise<void> {
    if (!this._view) {
      return;
    }
    
    const config = vscode.workspace.getConfiguration('mcpBookmarks');
    const currentStyle = config.get<string>('viewStyle') || 'nested';
    const newStyle = currentStyle === 'nested' ? 'tree' : 'nested';
    
    // 更新配置
    await config.update('viewStyle', newStyle, vscode.ConfigurationTarget.Global);

    // 发送消息给 webview 切换 UI 样式
    this._view.webview.postMessage({
      type: 'toggleViewMode',
      viewStyle: newStyle
    });
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
   * 折叠指定分组
   */
  public collapseGroup(groupId: string): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'collapseGroup',
      groupId
    });
  }

  /**
   * 展开指定分组
   */
  public expandGroup(groupId: string): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'expandGroup',
      groupId
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
    description?: string;
    location?: string;
    path?: string;
    line?: number;
    updates?: { title: string; location: string; description: string };
    payload?: any;
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
        // 展开/折叠书签子项 (由前端管理状态, 不需要持久化)
        // if (message.bookmarkId) {
        //   this.bookmarkStore.toggleBookmarkCollapsed(message.bookmarkId);
        // }
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
          const confirmDelete = vscode.workspace.getConfiguration('mcpBookmarks').get<boolean>('confirmBeforeDelete', true);
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
          const confirmDelete = vscode.workspace.getConfiguration('mcpBookmarks').get<boolean>('confirmBeforeDelete', true);
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
            vscode.commands.executeCommand('mcpBookmarks.editBookmark', {
              type: 'bookmark',
              bookmark: editResult.bookmark
            });
          }
        }
        break;

      case 'editGroup':
        if (message.groupId) {
          const group = this.bookmarkStore.getGroup(message.groupId);
          if (group) {
            vscode.commands.executeCommand('mcpBookmarks.editGroup', {
              type: 'group',
              group: {
                id: group.id,
                name: group.name,
                description: group.description
              }
            });
          }
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

      case 'copyAbsolutePath':
        if (message.location) {
          const location = message.location as string;
          const relativePath = location.split(':')[0];
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            const absolutePath = vscode.Uri.joinPath(workspaceFolder.uri, relativePath).fsPath;
            vscode.env.clipboard.writeText(absolutePath);
            vscode.window.showInformationMessage('Absolute path copied to clipboard');
          }
        }
        break;

      case 'createGroup':
        // 创建新分组
        vscode.commands.executeCommand('mcpBookmarks.createGroup');
        break;

      case 'exportBookmarks':
        // 导出书签
        vscode.commands.executeCommand('mcpBookmarks.exportMarkdown');
        break;

      case 'updateBookmarkDescription':
        if (message.bookmarkId && message.description !== undefined) {
          try {
            this.bookmarkStore.updateBookmark(message.bookmarkId, {
              description: message.description
            });
            vscode.window.showInformationMessage('Bookmark description updated');
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to update bookmark: ${error}`);
          }
        }
        break;

      case 'updateBookmarkFull':
        if (message.bookmarkId && message.updates) {
          await this.handleUpdateBookmarkFull(message.bookmarkId, message.updates);
        }
        break;

      case 'requestCurrentLocation':
        this.handleRequestCurrentLocation();
        break;

      case 'addBookmark':
        if (message.payload) {
          await this.handleAddBookmark(message.payload);
        }
        break;

      case 'addChildBookmark':
        if (message.payload) {
          await this.handleAddChildBookmark(message.payload);
        }
        break;

      case 'openFile':
        if (message.path) {
          await this.openFileFromWebview(message.path, message.line);
        }
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

  /**
   * 从 webview 打开文件
   */
  private async openFileFromWebview(filePath: string, line?: number): Promise<void> {
    try {
      const jumpToDocument = async (uri: vscode.Uri) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);

        if (line !== undefined) {
          const targetLine = Math.max(0, line - 1);
          const position = new vscode.Position(targetLine, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        }
      };

      try {
        // 先尝试相对路径
        const relativePath = toAbsolutePath(filePath, this.workspaceRoot);
        const uri = vscode.Uri.file(relativePath);
        await jumpToDocument(uri);
      } catch (error) {
        try {
          // 如果相对路径失败, 尝试绝对路径
          const absoluteUri = vscode.Uri.file(filePath);
          await jumpToDocument(absoluteUri);
        } catch (error2) {
          vscode.window.showErrorMessage(
            `Failed to open file "${filePath}".\nError: ${error2}`
          );
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  /**
   * 处理获取当前光标位置的请求
   */
  private handleRequestCurrentLocation(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this._view?.webview.postMessage({
        type: 'currentLocation',
        location: null,
        error: 'No active editor'
      });
      return;
    }

    const document = editor.document;
    const position = editor.selection.active;

    // 获取相对路径
    const relativePath = path.relative(this.workspaceRoot, document.uri.fsPath);

    // 生成 location 字符串 (行号从 1 开始, VSCode API 是 0-based, 所以需要 +1)
    const location = `${relativePath}:${position.line + 1}`;

    this._view?.webview.postMessage({
      type: 'currentLocation',
      location: location
    });
  }

  /**
   * 处理添加书签 (在目标书签后添加同级书签)
   */
  private async handleAddBookmark(payload: {
    groupId: string;
    targetBookmarkId: string;
    parentId: string | null;
    bookmark: {
      title: string;
      location: string;
      description: string;
      category: string;
    };
  }): Promise<void> {
    try {
      // 1. 查找目标书签
      const targetResult = this.bookmarkStore.getBookmark(payload.targetBookmarkId);
      if (!targetResult) {
        vscode.window.showErrorMessage('Target bookmark not found');
        return;
      }

      const { bookmark: targetBookmark, group } = targetResult;

      // 2. 计算新书签的 order (在目标书签后面)
      const newOrder = targetBookmark.order + 1;

      // 3. 获取所有同级书签 (相同 parentId)
      const siblings = group.bookmarks.filter(
        b => b.parentId === targetBookmark.parentId
      );

      // 4. 调整后续书签的 order (+1)
      siblings.forEach(sibling => {
        if (sibling.order >= newOrder && sibling.id !== payload.targetBookmarkId) {
          sibling.order += 1;
        }
      });

      // 5. 添加新书签
      const newBookmarkId = this.bookmarkStore.addBookmark(
        payload.groupId,
        payload.bookmark.location,
        payload.bookmark.title,
        payload.bookmark.description,
        {
          parentId: payload.parentId || undefined,
          order: newOrder,
          category: payload.bookmark.category as any
        }
      );

      if (newBookmarkId) {
        vscode.window.showInformationMessage('Bookmark added successfully');
      } else {
        vscode.window.showErrorMessage('Failed to add bookmark');
      }

    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add bookmark: ${error}`);
    }
  }

  /**
   * 处理添加子书签 (在目标书签下添加子书签)
   */
  private async handleAddChildBookmark(payload: {
    targetBookmarkId: string;
    bookmark: {
      title: string;
      location: string;
      description: string;
      category: string;
    };
  }): Promise<void> {
    try {
      const newBookmarkId = this.bookmarkStore.addChildBookmark(
        payload.targetBookmarkId,
        payload.bookmark.location,
        payload.bookmark.title,
        payload.bookmark.description,
        {
          category: payload.bookmark.category as any
        }
      );

      if (newBookmarkId) {
        vscode.window.showInformationMessage('Child bookmark added successfully');
      } else {
        vscode.window.showErrorMessage('Failed to add child bookmark');
      }

    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add child bookmark: ${error}`);
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
   * 处理全字段书签更新 (带后端验证)
   */
  private async handleUpdateBookmarkFull(
    bookmarkId: string,
    updates: { title: string; location: string; description: string }
  ): Promise<void> {
    try {
      // 1. 解析 location 格式
      const parsed = parseLocation(updates.location);
      if (!parsed) {
        this.sendValidationError('location', 'Invalid format. Use "file:line" or "file:start-end"');
        return;
      }

      // 2. 转换为绝对路径
      const absolutePath = toAbsolutePath(parsed.filePath, this.workspaceRoot);

      // 3. 检查文件存在性
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolutePath));

        // 4. 验证是文件不是目录
        if (stat.type !== vscode.FileType.File) {
          this.sendValidationError('location', 'Path is a directory, not a file');
          return;
        }
      } catch {
        this.sendValidationError('location', 'File does not exist');
        return;
      }

      // 5. 检查行号范围
      const document = await vscode.workspace.openTextDocument(absolutePath);
      const lineCount = document.lineCount;

      if (parsed.startLine > lineCount) {
        this.sendValidationError('location', `Line ${parsed.startLine} exceeds file line count (${lineCount})`);
        return;
      }

      if (parsed.isRange && parsed.endLine > lineCount) {
        this.sendValidationError('location', `Line ${parsed.endLine} exceeds file line count (${lineCount})`);
        return;
      }

      // 6. 执行更新
      this.bookmarkStore.updateBookmark(bookmarkId, updates);
      vscode.window.showInformationMessage('Bookmark updated successfully');

    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update bookmark: ${error}`);
    }
  }

  /**
   * 发送验证错误消息到 Webview
   */
  private sendValidationError(field: string, error: string): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'validationError',
      field: `error-${field}`,
      error: error
    });
  }

  /**
   * 获取 HTML 内容
   */
  private getHtmlContent(webview: vscode.Webview): string {
    // 尝试打包后的路径 (dist/webview), 如果失败则使用开发路径 (src/webview)
    let htmlPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.html');
    let cssPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.css');
    let jsPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.js');

    // 如果打包路径不存在, 使用开发路径
    if (!fs.existsSync(htmlPath.fsPath)) {
      htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'sidebar.html');
      cssPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'sidebar.css');
      jsPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'sidebar.js');
    }

    const cssUri = webview.asWebviewUri(cssPath);
    const jsUri = webview.asWebviewUri(jsPath);
    const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

    // Cache busting
    const nonce = new Date().getTime() + '' + new Date().getMilliseconds();

    let htmlContent = '';
    try {
      htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
    } catch (error) {
      console.error('Failed to read sidebar HTML template:', error);
      htmlContent = this.getDefaultHtmlTemplate();
    }

    // 替换占位符
    htmlContent = htmlContent
      .replace(/\{\{cssUri\}\}/g, `${cssUri.toString()}?t=${nonce}`)
      .replace(/\{\{jsUri\}\}/g, `${jsUri.toString()}?t=${nonce}`)
      .replace(/\{\{codiconsUri\}\}/g, codiconsUri.toString())
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
  <title>MCP Bookmarks</title>
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
