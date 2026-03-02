import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BookmarkStoreBase } from './bookmarkStoreBase';
import {
  BookmarkStore,
  BookmarkGroup,
  Bookmark,
  createDefaultStore
} from './types';
import { nowISO, parseLocation, normalizePath, formatLocation, adjustLineNumbers, stringifyWithUnicode } from '../utils';

const STORE_FILE_NAME = 'mcp-bookmarks.json';
const STORE_DIR = '.vscode';

/**
 * VSCode 版 BookmarkStoreManager.
 * 继承 BookmarkStoreBase 获取所有 CRUD 逻辑,
 * 只实现 I/O, 通知, 以及 VSCode 特有功能.
 */
export class BookmarkStoreManager extends BookmarkStoreBase {
  private storePath: string;
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(workspaceRoot: string) {
    // 先计算 storePath, 因为 super() 会调用 loadFromDisk() 需要用到
    // 但 super() 必须在第一行, 所以 storePath 在 loadFromDisk() 内部自行计算
    super(workspaceRoot);
    this.storePath = path.join(workspaceRoot, STORE_DIR, STORE_FILE_NAME);
    this.setupFileWatcher();
  }

  // --- 抽象方法实现 ---

  protected loadFromDisk(): BookmarkStore {
    // storePath 可能还没被 constructor 赋值 (super() 调用时), 需要现场计算
    const storePath = path.join(this.workspaceRoot, STORE_DIR, STORE_FILE_NAME);

    try {
      // 数据迁移: 如果旧的 ai-bookmarks.json 存在且新文件不存在, 自动重命名
      const oldPath = path.join(this.workspaceRoot, STORE_DIR, 'ai-bookmarks.json');
      if (fs.existsSync(oldPath) && !fs.existsSync(storePath)) {
        fs.renameSync(oldPath, storePath);
      }

      if (fs.existsSync(storePath)) {
        const content = fs.readFileSync(storePath, 'utf-8');
        const parsed = JSON.parse(content) as BookmarkStore;
        const { store, migrated } = this.migrateStore(parsed);
        if (migrated) {
          this.writeStoreToFile(store, storePath);
        }
        return store;
      }
    } catch (error) {
      console.error('Failed to load bookmark store:', error);
    }

    return createDefaultStore(path.basename(this.workspaceRoot));
  }

  protected saveToDisk(): void {
    try {
      const storePath = this.storePath ?? path.join(this.workspaceRoot, STORE_DIR, STORE_FILE_NAME);
      this.writeStoreToFile(this.store, storePath);
    } catch (error) {
      console.error('Failed to save bookmark store:', error);
      vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
    }
  }

  protected notifyChange(): void {
    this._onDidChange.fire();
  }

  // --- 私有工具方法 ---

  private writeStoreToFile(store: BookmarkStore, storePath: string): void {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, stringifyWithUnicode(store, 2), 'utf-8');
  }

  // --- FileWatcher ---

  private setupFileWatcher(): void {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(this.storePath), STORE_FILE_NAME)
    );

    this.fileWatcher.onDidChange(() => {
      this.reload();
    });

    this.fileWatcher.onDidCreate(() => {
      this.reload();
    });

    this.fileWatcher.onDidDelete(() => {
      this.store = createDefaultStore(path.basename(this.workspaceRoot));
      this.notifyChange();
    });
  }

  private reload(): void {
    this.store = this.loadFromDisk();
    this.notifyChange();
  }

  // --- VSCode 特有功能 ---

  // 检查书签的代码是否发生了显著变化
  async checkBookmarkValidity(
    bookmarkId: string,
    getFileContent: (filePath: string) => Promise<string | undefined>
  ): Promise<{ valid: boolean; reason?: string }> {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return { valid: false, reason: 'Bookmark not found' };
    }

    const { bookmark } = result;

    if (!bookmark.codeSnapshot) {
      return { valid: true, reason: 'No snapshot to compare' };
    }

    try {
      const parsed = parseLocation(bookmark.location);
      const absolutePath = path.join(this.workspaceRoot, parsed.filePath);
      const content = await getFileContent(absolutePath);

      if (!content) {
        return { valid: false, reason: 'File not found' };
      }

      const lines = content.split('\n');
      const startIdx = parsed.startLine - 1;
      const endIdx = parsed.endLine;

      if (startIdx < 0 || endIdx > lines.length) {
        return { valid: false, reason: 'Line range out of bounds' };
      }

      const currentCode = lines.slice(startIdx, endIdx).join('\n');

      if (currentCode === bookmark.codeSnapshot) {
        return { valid: true };
      }

      const similarity = this.calculateSimilarity(bookmark.codeSnapshot, currentCode);
      if (similarity < 0.5) {
        return { valid: false, reason: `Code changed significantly (${Math.round(similarity * 100)}% similar)` };
      }

      return { valid: true, reason: `Code slightly changed (${Math.round(similarity * 100)}% similar)` };
    } catch (error) {
      return { valid: false, reason: `Error checking validity: ${error}` };
    }
  }

  // 简单相似度计算 (Jaccard-like)
  private calculateSimilarity(str1: string, str2: string): number {
    const set1 = new Set(str1.split(/\s+/));
    const set2 = new Set(str2.split(/\s+/));

    let intersection = 0;
    for (const word of set1) {
      if (set2.has(word)) {
        intersection++;
      }
    }

    const union = set1.size + set2.size - intersection;
    return union === 0 ? 1 : intersection / union;
  }

  // 更新书签的代码快照
  updateBookmarkSnapshot(bookmarkId: string, codeSnapshot: string): boolean {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return false;
    }

    result.bookmark.codeSnapshot = codeSnapshot;
    result.group.updatedAt = nowISO();

    this.saveToDisk();
    this.notifyChange();

    return true;
  }

  // 在同级书签中重新排序
  reorderBookmark(bookmarkId: string, direction: 'up' | 'down'): boolean {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return false;
    }

    const { bookmark, group } = result;

    const siblings = group.bookmarks
      .filter(b => b.parentId === bookmark.parentId)
      .sort((a, b) => a.order - b.order);

    const currentIndex = siblings.findIndex(b => b.id === bookmarkId);

    if (currentIndex === -1) {
      return false;
    }

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= siblings.length) {
      return false;
    }

    // 交换 order
    const otherBookmark = siblings[newIndex];
    const tempOrder = bookmark.order;
    bookmark.order = otherBookmark.order;
    otherBookmark.order = tempOrder;

    group.updatedAt = nowISO();

    this.saveToDisk();
    this.notifyChange();

    return true;
  }

  // 移动书签(及其子书签)到另一个分组
  moveBookmarkToGroup(bookmarkId: string, targetGroupId: string): { success: boolean; movedCount: number } {
    let sourceGroup: BookmarkGroup | undefined;
    let bookmark: Bookmark | undefined;

    for (const group of this.store.groups) {
      const found = group.bookmarks.find(b => b.id === bookmarkId);
      if (found) {
        sourceGroup = group;
        bookmark = found;
        break;
      }
    }

    if (!sourceGroup || !bookmark) {
      return { success: false, movedCount: 0 };
    }

    const targetGroup = this.store.groups.find(g => g.id === targetGroupId);
    if (!targetGroup) {
      return { success: false, movedCount: 0 };
    }

    if (sourceGroup.id === targetGroup.id) {
      return { success: false, movedCount: 0 };
    }

    // 获取书签及其所有后代 (使用基类的 protected 方法)
    const descendants = this.getDescendants(sourceGroup, bookmarkId);
    const idsToMove = new Set([bookmarkId, ...descendants.map(d => d.id)]);

    // 从源分组中移除
    const bookmarksToMove = sourceGroup.bookmarks.filter(b => idsToMove.has(b.id));
    sourceGroup.bookmarks = sourceGroup.bookmarks.filter(b => !idsToMove.has(b.id));
    sourceGroup.updatedAt = nowISO();

    // 移动的书签变为顶层
    bookmark.parentId = undefined;

    // 计算在目标分组中的 order
    const topLevelInTarget = targetGroup.bookmarks.filter(b => !b.parentId);
    bookmark.order = topLevelInTarget.length > 0
      ? Math.max(...topLevelInTarget.map(b => b.order)) + 1
      : 1;

    // 添加到目标分组
    for (const b of bookmarksToMove) {
      targetGroup.bookmarks.push(b);
    }
    targetGroup.updatedAt = nowISO();

    this.saveToDisk();
    this.notifyChange();

    return { success: true, movedCount: bookmarksToMove.length };
  }

  // 文档变更时调整书签行号 (行号漂移处理)
  adjustBookmarksForFileChange(
    filePath: string,
    editStartLine: number,
    lineDelta: number
  ): void {
    const normalizedPath = normalizePath(filePath, this.workspaceRoot);
    let hasChanges = false;

    for (const group of this.store.groups) {
      for (const bookmark of group.bookmarks) {
        try {
          const parsed = parseLocation(bookmark.location);

          if (parsed.filePath !== normalizedPath) {
            continue;
          }

          const adjusted = adjustLineNumbers(parsed, editStartLine, lineDelta);

          if (adjusted.startLine !== parsed.startLine || adjusted.endLine !== parsed.endLine) {
            bookmark.location = formatLocation(adjusted);
            hasChanges = true;
          }
        } catch (error) {
          console.error(`Failed to parse bookmark location: ${bookmark.location}`, error);
        }
      }

      if (hasChanges) {
        group.updatedAt = nowISO();
      }
    }

    if (hasChanges) {
      this.saveToDisk();
      this.notifyChange();
    }
  }

  // 清理资源
  dispose(): void {
    this.fileWatcher?.dispose();
    this._onDidChange.dispose();
  }
}
