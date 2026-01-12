import * as vscode from 'vscode';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { Bookmark } from '../store/types';
import { parseLocation, normalizePath } from '../utils';

// Category colors (simplified to 4 categories)
const CATEGORY_COLORS: Record<string, string> = {
  'entry-point': '#4CAF50',   // Green
  'core-logic': '#2196F3',    // Blue
  'issue': '#FFC107',         // Amber (warning/bug/todo)
  'note': '#607D8B'           // Gray (explanation/reference)
};

const DEFAULT_COLOR = '#888888';

export class DecorationProvider implements vscode.Disposable {
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private store: BookmarkStoreManager,
    private workspaceRoot: string
  ) {
    // Create decoration types for each category
    this.createDecorationTypes();

    // Listen for store changes
    this.disposables.push(
      store.onDidChange(() => {
        this.updateAllEditors();
      })
    );

    // Listen for active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.updateDecorations(editor);
        }
      })
    );

    // Listen for visible editors changes
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        editors.forEach(editor => this.updateDecorations(editor));
      })
    );

    // Initial update
    this.updateAllEditors();
  }

  private createDecorationTypes(): void {
    // Create decoration type for each category (gutter icon on first line only)
    for (const [category, color] of Object.entries(CATEGORY_COLORS)) {
      const decorationType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: this.createGutterIcon(color),
        gutterIconSize: 'contain'
      });
      this.decorationTypes.set(category, decorationType);
    }

    // Default decoration type
    const defaultDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon(DEFAULT_COLOR),
      gutterIconSize: 'contain'
    });
    this.decorationTypes.set('default', defaultDecorationType);
  }

  private createGutterIcon(color: string): vscode.Uri {
    // Small dot icon for gutter
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="4" fill="${color}"/>
    </svg>`;
    return vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  }

  private updateAllEditors(): void {
    vscode.window.visibleTextEditors.forEach(editor => {
      this.updateDecorations(editor);
    });
  }

  private updateDecorations(editor: vscode.TextEditor): void {
    // Check if decorations are enabled
    const config = vscode.workspace.getConfiguration('mcpBookmarks');
    if (!config.get<boolean>('showInlineDecorations', true)) {
      this.clearDecorations(editor);
      return;
    }

    const filePath = normalizePath(editor.document.uri.fsPath, this.workspaceRoot);

    // Get bookmarks for this file
    const bookmarks = this.store.getBookmarksByFile(filePath);

    // Group bookmarks by category
    const bookmarksByCategory: Map<string, Array<{ bookmark: Bookmark; range: vscode.Range }>> = new Map();

    for (const { bookmark } of bookmarks) {
      try {
        const parsed = parseLocation(bookmark.location);

        // Create range (VSCode is 0-indexed, our format is 1-indexed)
        const startLine = Math.max(0, parsed.startLine - 1);
        const endLine = Math.max(0, parsed.endLine - 1);

        // 获取行末位置, 避免使用 MAX_SAFE_INTEGER
        const endLineLength = editor.document.lineAt(Math.min(endLine, editor.document.lineCount - 1)).text.length;
        const range = new vscode.Range(
          new vscode.Position(startLine, 0),
          new vscode.Position(endLine, endLineLength)
        );

        const category = bookmark.category || 'default';
        if (!bookmarksByCategory.has(category)) {
          bookmarksByCategory.set(category, []);
        }
        bookmarksByCategory.get(category)!.push({ bookmark, range });
      } catch (error) {
        console.error(`Failed to parse bookmark location: ${bookmark.location}`, error);
      }
    }

    // Clear all decorations first
    this.clearDecorations(editor);

    // Apply decorations by category
    // Note: hover content is provided by hoverProvider.ts, not here
    for (const [category, items] of bookmarksByCategory) {
      const decorationType = this.decorationTypes.get(category) || this.decorationTypes.get('default')!;

      // Only show gutter icon on the first line of each bookmark
      const decorations: vscode.DecorationOptions[] = items.map(({ range }) => ({
        range: new vscode.Range(range.start, range.start)
      }));

      editor.setDecorations(decorationType, decorations);
    }
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    for (const decorationType of this.decorationTypes.values()) {
      editor.setDecorations(decorationType, []);
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.decorationTypes.forEach(d => d.dispose());
    this.decorationTypes.clear();
  }
}
