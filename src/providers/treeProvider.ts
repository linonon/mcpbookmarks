import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { BookmarkGroup, Bookmark, BookmarkCategory, BookmarkWithChildren } from '../store/types';
import { parseLocation, getCategoryDisplayName } from '../utils';

// Category icon and color mapping (simplified to 4 categories)
const CATEGORY_STYLES: Record<string, { icon: string; color: string }> = {
  'entry-point': { icon: 'debug-start', color: 'charts.green' },
  'core-logic': { icon: 'symbol-method', color: 'charts.blue' },
  'issue': { icon: 'warning', color: 'editorWarning.foreground' },
  'note': { icon: 'comment-discussion', color: 'charts.purple' }
};

function getCategoryThemeIcon(category?: BookmarkCategory): vscode.ThemeIcon {
  const style = CATEGORY_STYLES[category || ''];
  if (style) {
    return new vscode.ThemeIcon(style.icon, new vscode.ThemeColor(style.color));
  }
  return new vscode.ThemeIcon('bookmark');
}

// View mode type
export type ViewMode = 'group' | 'file';

// Tree item types
interface GroupTreeItem {
  type: 'group';
  group: BookmarkGroup;
}

interface BookmarkTreeItem {
  type: 'bookmark';
  bookmark: Bookmark;
  group: BookmarkGroup;
}

interface FileTreeItem {
  type: 'file';
  filePath: string;
  bookmarks: Array<{ bookmark: Bookmark; group: BookmarkGroup }>;
}

type BookmarkTreeData = GroupTreeItem | BookmarkTreeItem | FileTreeItem;

export class BookmarkTreeProvider implements vscode.TreeDataProvider<BookmarkTreeData> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BookmarkTreeData | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _viewMode: ViewMode;

  constructor(private store: BookmarkStoreManager) {
    // Initialize view mode from configuration
    this._viewMode = vscode.workspace.getConfiguration('aiBookmarks').get<ViewMode>('viewMode') || 'group';

    // Listen for store changes
    store.onDidChange(() => {
      this.refresh();
    });

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiBookmarks.viewMode')) {
        this._viewMode = vscode.workspace.getConfiguration('aiBookmarks').get<ViewMode>('viewMode') || 'group';
        this.refresh();
      }
    });
  }

  get viewMode(): ViewMode {
    return this._viewMode;
  }

  toggleViewMode(): void {
    this._viewMode = this._viewMode === 'group' ? 'file' : 'group';
    // Update configuration
    vscode.workspace.getConfiguration('aiBookmarks').update('viewMode', this._viewMode, vscode.ConfigurationTarget.Workspace);
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BookmarkTreeData): vscode.TreeItem {
    if (element.type === 'group') {
      return this.createGroupTreeItem(element.group);
    } else if (element.type === 'file') {
      return this.createFileTreeItem(element);
    } else {
      return this.createBookmarkTreeItem(element.bookmark, element.group);
    }
  }

  getChildren(element?: BookmarkTreeData): Thenable<BookmarkTreeData[]> {
    if (!element) {
      // Root level: depends on view mode
      if (this._viewMode === 'group') {
        return this.getGroupViewChildren();
      } else {
        return this.getFileViewChildren();
      }
    }

    if (element.type === 'group') {
      // Group level: return only top-level bookmarks (those without parentId)
      const topLevelBookmarks = element.group.bookmarks
        .filter(bookmark => !bookmark.parentId)
        .sort((a, b) => a.order - b.order)
        .map(bookmark => ({
          type: 'bookmark' as const,
          bookmark,
          group: element.group
        }));
      return Promise.resolve(topLevelBookmarks);
    }

    if (element.type === 'file') {
      // File level: return bookmarks in this file
      const bookmarks = element.bookmarks.map(({ bookmark, group }) => ({
        type: 'bookmark' as const,
        bookmark,
        group
      }));
      return Promise.resolve(bookmarks);
    }

    if (element.type === 'bookmark') {
      // Bookmark level: return child bookmarks
      const children = this.store.getChildBookmarks(element.bookmark.id);
      if (children.length > 0) {
        const childItems = children
          .sort((a, b) => a.bookmark.order - b.bookmark.order)
          .map(({ bookmark, group }) => ({
            type: 'bookmark' as const,
            bookmark,
            group
          }));
        return Promise.resolve(childItems);
      }
    }

    return Promise.resolve([]);
  }

  private getGroupViewChildren(): Thenable<BookmarkTreeData[]> {
    const groups = this.store.listGroups();
    return Promise.resolve(
      groups.map(group => ({ type: 'group' as const, group }))
    );
  }

  private getFileViewChildren(): Thenable<BookmarkTreeData[]> {
    // Group all bookmarks by file path
    const allBookmarks = this.store.getAllBookmarks();
    const fileMap = new Map<string, Array<{ bookmark: Bookmark; group: BookmarkGroup }>>();

    for (const { bookmark, group } of allBookmarks) {
      try {
        const parsed = parseLocation(bookmark.location);
        const filePath = parsed.filePath;
        if (!fileMap.has(filePath)) {
          fileMap.set(filePath, []);
        }
        fileMap.get(filePath)!.push({ bookmark, group });
      } catch {
        // Skip invalid locations
      }
    }

    // Sort files alphabetically and bookmarks by line number
    const fileItems: FileTreeItem[] = Array.from(fileMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, bookmarks]) => {
        // Sort bookmarks by line number within each file
        bookmarks.sort((a, b) => {
          try {
            const parsedA = parseLocation(a.bookmark.location);
            const parsedB = parseLocation(b.bookmark.location);
            return parsedA.startLine - parsedB.startLine;
          } catch {
            return 0;
          }
        });
        return {
          type: 'file' as const,
          filePath,
          bookmarks
        };
      });

    return Promise.resolve(fileItems);
  }

  getParent(element: BookmarkTreeData): BookmarkTreeData | undefined {
    if (element.type === 'bookmark') {
      if (this._viewMode === 'group') {
        // Check if this bookmark has a parent bookmark
        if (element.bookmark.parentId) {
          const parentBookmark = element.group.bookmarks.find(b => b.id === element.bookmark.parentId);
          if (parentBookmark) {
            return { type: 'bookmark', bookmark: parentBookmark, group: element.group };
          }
        }
        // Top-level bookmark - parent is the group
        return { type: 'group', group: element.group };
      }
      // In file view mode, we don't track parent (would need to find the file)
      return undefined;
    }
    return undefined;
  }

  private createGroupTreeItem(group: BookmarkGroup): vscode.TreeItem {
    const item = new vscode.TreeItem(
      group.name,
      group.bookmarks.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    item.id = group.id;
    item.contextValue = 'group';

    // Description: show count and optional query preview
    if (group.query) {
      item.description = `(${group.bookmarks.length}) Q: ${group.query.substring(0, 30)}${group.query.length > 30 ? '...' : ''}`;
    } else {
      item.description = `(${group.bookmarks.length})`;
    }

    // Rich tooltip with all group info
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`### ${group.name}\n\n`);
    if (group.description) {
      tooltip.appendMarkdown(`${group.description}\n\n`);
    }
    if (group.query) {
      tooltip.appendMarkdown(`---\n\n**Query:** *${group.query}*\n\n`);
    }
    tooltip.appendMarkdown(`**Bookmarks:** ${group.bookmarks.length}\n\n`);
    tooltip.appendMarkdown(`**Created by:** ${group.createdBy === 'ai' ? '🤖 AI' : '👤 User'}\n\n`);
    tooltip.appendMarkdown(`**Created:** ${new Date(group.createdAt).toLocaleString()}`);
    item.tooltip = tooltip;

    // Icon based on creator - AI gets sparkle, user gets folder
    item.iconPath = group.createdBy === 'ai'
      ? new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('charts.blue'))
      : new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));

    return item;
  }

  private createFileTreeItem(fileItem: FileTreeItem): vscode.TreeItem {
    const fileName = path.basename(fileItem.filePath);
    const dirPath = path.dirname(fileItem.filePath);

    const item = new vscode.TreeItem(
      fileName,
      fileItem.bookmarks.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    item.id = `file:${fileItem.filePath}`;
    item.contextValue = 'file';
    item.description = dirPath !== '.' ? dirPath : '';

    // Tooltip with file info
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${fileItem.filePath}**\n\n`);
    tooltip.appendMarkdown(`${fileItem.bookmarks.length} bookmark(s)\n\n`);

    // List groups that have bookmarks in this file
    const groupNames = [...new Set(fileItem.bookmarks.map(b => b.group.name))];
    if (groupNames.length > 0) {
      tooltip.appendMarkdown(`**Groups:** ${groupNames.join(', ')}`);
    }
    item.tooltip = tooltip;

    // File icon
    item.iconPath = new vscode.ThemeIcon('file-code');

    return item;
  }

  private createBookmarkTreeItem(bookmark: Bookmark, group: BookmarkGroup): vscode.TreeItem {
    // Determine if this bookmark has children
    const hasChildren = this.store.hasChildren(bookmark.id);

    // Format: "1. Title" with step number prominent
    const item = new vscode.TreeItem(
      `${bookmark.order}. ${bookmark.title}`,
      hasChildren
        ? (bookmark.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded)
        : vscode.TreeItemCollapsibleState.None
    );

    item.id = bookmark.id;
    item.contextValue = hasChildren ? 'bookmarkWithChildren' : 'bookmark';

    // Description: show line number (matching prototype :45 or :78-92 format)
    try {
      const parsed = parseLocation(bookmark.location);
      const lineInfo = parsed.isRange
        ? `:${parsed.startLine}-${parsed.endLine}`
        : `:${parsed.startLine}`;
      item.description = lineInfo;
    } catch {
      item.description = '';
    }

    // Rich tooltip with full bookmark information
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`### ${bookmark.title}\n\n`);
    tooltip.appendMarkdown(`${bookmark.description}\n\n`);
    tooltip.appendMarkdown(`---\n\n`);
    tooltip.appendMarkdown(`**Location:** \`${bookmark.location}\`\n\n`);
    if (bookmark.category) {
      tooltip.appendMarkdown(`**Category:** ${getCategoryDisplayName(bookmark.category)}\n\n`);
    }
    tooltip.appendMarkdown(`**Group:** ${group.name}\n\n`);
    if (bookmark.parentId) {
      tooltip.appendMarkdown(`**Parent:** Has parent bookmark\n\n`);
    }
    if (hasChildren) {
      const childCount = this.store.getChildBookmarks(bookmark.id).length;
      tooltip.appendMarkdown(`**Children:** ${childCount} sub-bookmark(s)\n\n`);
    }
    tooltip.appendMarkdown(`**Order:** ${bookmark.order}`);
    item.tooltip = tooltip;

    // Icon with category color (matching prototype design)
    item.iconPath = getCategoryThemeIcon(bookmark.category);

    // Command to jump to location
    item.command = {
      command: 'aiBookmarks.jumpTo',
      title: 'Jump to Bookmark',
      arguments: [bookmark]
    };

    return item;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
