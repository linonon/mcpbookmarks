import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStoreManager } from './store/bookmarkStore';
import { BookmarkSidebarProvider } from './providers/sidebarProvider';
import { DecorationProvider } from './providers/decorationProvider';
import { BookmarkHoverProvider } from './providers/hoverProvider';
import { BookmarkCodeLensProvider } from './providers/codeLensProvider';
import { BookmarkDetailProvider } from './providers/webviewProvider';
import { parseLocation } from './utils';
import { registerAllCommands } from './commands';

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

  // Register all commands (delegated to command modules)
  registerAllCommands(context, {
    store: bookmarkStore,
    sidebarProvider,
    decorationProvider,
    detailProvider,
    workspaceRoot
  });

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
