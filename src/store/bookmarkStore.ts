import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  BookmarkStore,
  BookmarkGroup,
  Bookmark,
  BookmarkWithChildren,
  BookmarkCategory,
  UpdateBookmarkResult,
  createDefaultStore
} from './types';
import { nowISO, parseLocation, normalizePath, formatLocation, adjustLineNumbers } from '../utils';

const STORE_FILE_NAME = 'mcp-bookmarks.json';
const STORE_DIR = '.vscode';

export class BookmarkStoreManager {
  private store: BookmarkStore;
  private storePath: string;
  private workspaceRoot: string;
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.storePath = path.join(workspaceRoot, STORE_DIR, STORE_FILE_NAME);
    this.store = this.load();
    this.setupFileWatcher();
  }

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
      this._onDidChange.fire();
    });
  }

  private load(): BookmarkStore {
    try {
      // 数据迁移: 如果旧的 ai-bookmarks.json 存在且新文件不存在, 自动重命名
      const oldPath = path.join(this.workspaceRoot, STORE_DIR, 'ai-bookmarks.json');
      if (fs.existsSync(oldPath) && !fs.existsSync(this.storePath)) {
        fs.renameSync(oldPath, this.storePath);
        console.log('Migrated ai-bookmarks.json to mcp-bookmarks.json');
      }

      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        return JSON.parse(content) as BookmarkStore;
      }
    } catch (error) {
      console.error('Failed to load bookmark store:', error);
    }

    return createDefaultStore(path.basename(this.workspaceRoot));
  }

  private reload(): void {
    this.store = this.load();
    this._onDidChange.fire();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save bookmark store:', error);
      vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
    }
  }

  // Group operations

  createGroup(
    name: string,
    description?: string,
    query?: string,
    createdBy: 'ai' | 'user' = 'ai'
  ): string {
    const id = uuidv4();
    const now = nowISO();

    const group: BookmarkGroup = {
      id,
      name,
      description,
      query,
      createdAt: now,
      updatedAt: now,
      createdBy,
      bookmarks: []
    };

    this.store.groups.push(group);
    this.save();
    this._onDidChange.fire();

    return id;
  }

  getGroup(groupId: string): BookmarkGroup | undefined {
    return this.store.groups.find(g => g.id === groupId);
  }

  listGroups(createdBy?: 'ai' | 'user'): BookmarkGroup[] {
    if (createdBy) {
      return this.store.groups.filter(g => g.createdBy === createdBy);
    }
    return [...this.store.groups];
  }

  updateGroup(groupId: string, updates: { name?: string; description?: string }): boolean {
    const group = this.store.groups.find(g => g.id === groupId);
    if (!group) {
      return false;
    }

    if (updates.name !== undefined) {
      group.name = updates.name;
    }
    if (updates.description !== undefined) {
      group.description = updates.description;
    }
    group.updatedAt = nowISO();

    this.save();
    this._onDidChange.fire();

    return true;
  }

  removeGroup(groupId: string): boolean {
    const index = this.store.groups.findIndex(g => g.id === groupId);
    if (index === -1) {
      return false;
    }

    this.store.groups.splice(index, 1);
    this.save();
    this._onDidChange.fire();

    return true;
  }

  // 清除所有书签和分组
  clearAll(): { groupsRemoved: number; bookmarksRemoved: number } {
    const groupsRemoved = this.store.groups.length;
    const bookmarksRemoved = this.store.groups.reduce(
      (total, group) => total + group.bookmarks.length,
      0
    );

    this.store.groups = [];
    this.save();
    this._onDidChange.fire();

    return { groupsRemoved, bookmarksRemoved };
  }

  // Bookmark operations

  addBookmark(
    groupId: string,
    location: string,
    title: string,
    description: string,
    options: {
      parentId?: string;
      order?: number;
      category?: BookmarkCategory;
      codeSnapshot?: string;
    } = {}
  ): string | undefined {
    const group = this.store.groups.find(g => g.id === groupId);
    if (!group) {
      return undefined;
    }

    // 验证 parentId 是否有效
    if (options.parentId) {
      const parentBookmark = group.bookmarks.find(b => b.id === options.parentId);
      if (!parentBookmark) {
        return undefined; // 父书签不存在
      }
    }

    const id = uuidv4();

    // 确定 order (在同级书签中的顺序)
    let order = options.order;
    if (order === undefined) {
      const siblings = group.bookmarks.filter(b => b.parentId === options.parentId);
      order = siblings.length > 0
        ? Math.max(...siblings.map(b => b.order)) + 1
        : 1;
    }

    const bookmark: Bookmark = {
      id,
      parentId: options.parentId,
      order,
      location: normalizePath(location, this.workspaceRoot),
      title,
      description,
      category: options.category,
      codeSnapshot: options.codeSnapshot
    };

    group.bookmarks.push(bookmark);
    group.updatedAt = nowISO();

    this.save();
    this._onDidChange.fire();

    return id;
  }

  // 添加子书签 (语义化接口)
  addChildBookmark(
    parentBookmarkId: string,
    location: string,
    title: string,
    description: string,
    options: {
      order?: number;
      category?: BookmarkCategory;
      codeSnapshot?: string;
    } = {}
  ): string | undefined {
    // 找到父书签所在的分组
    const parentResult = this.getBookmark(parentBookmarkId);
    if (!parentResult) {
      return undefined;
    }

    return this.addBookmark(
      parentResult.group.id,
      location,
      title,
      description,
      { ...options, parentId: parentBookmarkId }
    );
  }

  getBookmark(bookmarkId: string): { bookmark: Bookmark; group: BookmarkGroup } | undefined {
    for (const group of this.store.groups) {
      const bookmark = group.bookmarks.find(b => b.id === bookmarkId);
      if (bookmark) {
        return { bookmark, group };
      }
    }
    return undefined;
  }

  listBookmarks(filters: {
    groupId?: string;
    parentId?: string;           // 只列出指定父书签的子书签
    includeDescendants?: boolean; // 是否包含所有后代
    topLevelOnly?: boolean;       // 只返回顶层书签
    filePath?: string;
    category?: BookmarkCategory;
  } = {}): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    const results: Array<{ bookmark: Bookmark; group: BookmarkGroup }> = [];

    const groups = filters.groupId
      ? this.store.groups.filter(g => g.id === filters.groupId)
      : this.store.groups;

    for (const group of groups) {
      let bookmarksToCheck = group.bookmarks;

      // 如果指定了 parentId, 先过滤子书签
      if (filters.parentId !== undefined) {
        if (filters.includeDescendants) {
          // 获取所有后代
          bookmarksToCheck = this.getDescendants(group, filters.parentId);
        } else {
          // 只获取直接子书签
          bookmarksToCheck = group.bookmarks.filter(b => b.parentId === filters.parentId);
        }
      } else if (filters.topLevelOnly) {
        // 只返回顶层书签
        bookmarksToCheck = group.bookmarks.filter(b => !b.parentId);
      }

      for (const bookmark of bookmarksToCheck) {
        // Apply other filters
        if (filters.filePath) {
          const parsed = parseLocation(bookmark.location);
          const normalizedFilter = normalizePath(filters.filePath, this.workspaceRoot);
          if (!parsed.filePath.includes(normalizedFilter) &&
              !normalizedFilter.includes(parsed.filePath)) {
            continue;
          }
        }

        if (filters.category && bookmark.category !== filters.category) {
          continue;
        }

        results.push({ bookmark, group });
      }
    }

    // 按 order 排序
    results.sort((a, b) => a.bookmark.order - b.bookmark.order);

    return results;
  }

  // 获取书签的所有后代
  private getDescendants(group: BookmarkGroup, parentId: string): Bookmark[] {
    const descendants: Bookmark[] = [];
    const directChildren = group.bookmarks.filter(b => b.parentId === parentId);

    for (const child of directChildren) {
      descendants.push(child);
      descendants.push(...this.getDescendants(group, child.id));
    }

    return descendants;
  }

  // 获取书签的直接子书签
  getChildBookmarks(bookmarkId: string): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return [];
    }

    return this.listBookmarks({
      groupId: result.group.id,
      parentId: bookmarkId
    });
  }

  // 检查书签是否有子书签
  hasChildren(bookmarkId: string): boolean {
    for (const group of this.store.groups) {
      if (group.bookmarks.some(b => b.parentId === bookmarkId)) {
        return true;
      }
    }
    return false;
  }

  // 获取书签树 (递归结构)
  getBookmarkTree(bookmarkId: string, maxDepth?: number): BookmarkWithChildren | undefined {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return undefined;
    }

    return this.buildBookmarkTree(result.bookmark, result.group, maxDepth, 0);
  }

  private buildBookmarkTree(
    bookmark: Bookmark,
    group: BookmarkGroup,
    maxDepth: number | undefined,
    currentDepth: number
  ): BookmarkWithChildren {
    const children: BookmarkWithChildren[] = [];

    // 如果没有达到最大深度, 继续构建子树
    if (maxDepth === undefined || currentDepth < maxDepth) {
      const directChildren = group.bookmarks
        .filter(b => b.parentId === bookmark.id)
        .sort((a, b) => a.order - b.order);

      for (const child of directChildren) {
        children.push(this.buildBookmarkTree(child, group, maxDepth, currentDepth + 1));
      }
    }

    return {
      ...bookmark,
      children
    };
  }

  // 获取分组的顶层书签树
  getGroupBookmarkTrees(groupId: string): BookmarkWithChildren[] {
    const group = this.getGroup(groupId);
    if (!group) {
      return [];
    }

    const topLevelBookmarks = group.bookmarks
      .filter(b => !b.parentId)
      .sort((a, b) => a.order - b.order);

    return topLevelBookmarks.map(b => this.buildBookmarkTree(b, group, undefined, 0));
  }

  updateBookmark(
    bookmarkId: string,
    updates: {
      parentId?: string | null;   // null 表示移到顶层
      location?: string;
      title?: string;
      description?: string;
      order?: number;
      category?: BookmarkCategory;
    }
  ): UpdateBookmarkResult {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return 'not_found';
    }

    const { bookmark, group } = result;

    // 处理 parentId 变更
    if (updates.parentId !== undefined) {
      const newParentId = updates.parentId === null ? undefined : updates.parentId;

      // 验证新父书签
      if (newParentId) {
        // 检查父书签是否存在
        const parentBookmark = group.bookmarks.find(b => b.id === newParentId);
        if (!parentBookmark) {
          return 'parent_not_found';
        }

        // 检查是否会形成循环引用
        if (this.wouldCreateCircularReference(group, bookmarkId, newParentId)) {
          return 'circular_reference';
        }
      }

      bookmark.parentId = newParentId;

      // 重新计算 order
      const siblings = group.bookmarks.filter(
        b => b.parentId === newParentId && b.id !== bookmarkId
      );
      bookmark.order = siblings.length > 0
        ? Math.max(...siblings.map(b => b.order)) + 1
        : 1;
    }

    if (updates.location !== undefined) {
      bookmark.location = normalizePath(updates.location, this.workspaceRoot);
    }
    if (updates.title !== undefined) {
      bookmark.title = updates.title;
    }
    if (updates.description !== undefined) {
      bookmark.description = updates.description;
    }
    if (updates.order !== undefined) {
      bookmark.order = updates.order;
    }
    if (updates.category !== undefined) {
      bookmark.category = updates.category;
    }

    group.updatedAt = nowISO();

    this.save();
    this._onDidChange.fire();

    return true;
  }

  // 检查是否会形成循环引用
  private wouldCreateCircularReference(
    group: BookmarkGroup,
    bookmarkId: string,
    newParentId: string
  ): boolean {
    // 如果新父节点就是自己, 形成循环
    if (bookmarkId === newParentId) {
      return true;
    }

    // 检查新父节点是否是当前节点的后代
    const descendants = this.getDescendants(group, bookmarkId);
    return descendants.some(d => d.id === newParentId);
  }

  removeBookmark(bookmarkId: string): { success: boolean; removedCount: number } {
    for (const group of this.store.groups) {
      const bookmark = group.bookmarks.find(b => b.id === bookmarkId);
      if (bookmark) {
        // 获取所有后代书签
        const descendants = this.getDescendants(group, bookmarkId);
        const idsToRemove = new Set([bookmarkId, ...descendants.map(d => d.id)]);

        // 删除书签及其所有后代
        const originalCount = group.bookmarks.length;
        group.bookmarks = group.bookmarks.filter(b => !idsToRemove.has(b.id));
        const removedCount = originalCount - group.bookmarks.length;

        group.updatedAt = nowISO();

        this.save();
        this._onDidChange.fire();

        return { success: true, removedCount };
      }
    }
    return { success: false, removedCount: 0 };
  }

  // Get bookmarks by file
  getBookmarksByFile(filePath: string): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    const normalizedPath = normalizePath(filePath, this.workspaceRoot);
    return this.listBookmarks({ filePath: normalizedPath });
  }

  // Get all bookmarks flat
  getAllBookmarks(): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    return this.listBookmarks();
  }

  // Export to markdown
  exportToMarkdown(): string {
    const lines: string[] = [];
    lines.push(`# ${this.store.projectName} - MCP Bookmarks`);
    lines.push('');

    for (const group of this.store.groups) {
      lines.push(`## ${group.name}`);
      if (group.description) {
        lines.push('');
        lines.push(group.description);
      }
      if (group.query) {
        lines.push('');
        lines.push(`> Query: ${group.query}`);
      }
      lines.push('');

      for (const bookmark of group.bookmarks) {
        lines.push(`### ${bookmark.order}. ${bookmark.title}`);
        lines.push('');
        lines.push(`**Location:** \`${bookmark.location}\``);
        if (bookmark.category) {
          lines.push(`**Category:** ${bookmark.category}`);
        }
        lines.push('');
        lines.push(bookmark.description);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // Check if a bookmark's code has changed significantly
  async checkBookmarkValidity(
    bookmarkId: string,
    getFileContent: (filePath: string) => Promise<string | undefined>
  ): Promise<{ valid: boolean; reason?: string }> {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return { valid: false, reason: 'Bookmark not found' };
    }

    const { bookmark } = result;

    // 如果没有 codeSnapshot, 无法检测
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

      // 简单比较: 如果完全匹配则有效
      if (currentCode === bookmark.codeSnapshot) {
        return { valid: true };
      }

      // 计算相似度 (简单的字符级别比较)
      const similarity = this.calculateSimilarity(bookmark.codeSnapshot, currentCode);
      if (similarity < 0.5) {
        return { valid: false, reason: `Code changed significantly (${Math.round(similarity * 100)}% similar)` };
      }

      return { valid: true, reason: `Code slightly changed (${Math.round(similarity * 100)}% similar)` };
    } catch (error) {
      return { valid: false, reason: `Error checking validity: ${error}` };
    }
  }

  // Simple similarity calculation (Jaccard-like)
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

  // Update bookmark with code snapshot
  updateBookmarkSnapshot(bookmarkId: string, codeSnapshot: string): boolean {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return false;
    }

    result.bookmark.codeSnapshot = codeSnapshot;
    result.group.updatedAt = nowISO();

    this.save();
    this._onDidChange.fire();

    return true;
  }

  // Reorder bookmark within siblings (same parent level)
  reorderBookmark(bookmarkId: string, direction: 'up' | 'down'): boolean {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return false;
    }

    const { bookmark, group } = result;

    // 获取同级书签 (相同 parentId)
    const siblings = group.bookmarks
      .filter(b => b.parentId === bookmark.parentId)
      .sort((a, b) => a.order - b.order);

    const currentIndex = siblings.findIndex(b => b.id === bookmarkId);

    if (currentIndex === -1) {
      return false;
    }

    // Calculate new index within siblings
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    // Check bounds
    if (newIndex < 0 || newIndex >= siblings.length) {
      return false;
    }

    // Swap orders with sibling
    const otherBookmark = siblings[newIndex];
    const tempOrder = bookmark.order;
    bookmark.order = otherBookmark.order;
    otherBookmark.order = tempOrder;

    group.updatedAt = nowISO();

    this.save();
    this._onDidChange.fire();

    return true;
  }

  // Move bookmark (and its children) to another group
  moveBookmarkToGroup(bookmarkId: string, targetGroupId: string): { success: boolean; movedCount: number } {
    // Find the bookmark and its current group
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

    // Find target group
    const targetGroup = this.store.groups.find(g => g.id === targetGroupId);
    if (!targetGroup) {
      return { success: false, movedCount: 0 };
    }

    // Don't move to same group
    if (sourceGroup.id === targetGroup.id) {
      return { success: false, movedCount: 0 };
    }

    // 获取书签及其所有后代
    const descendants = this.getDescendants(sourceGroup, bookmarkId);
    const idsToMove = new Set([bookmarkId, ...descendants.map(d => d.id)]);

    // 从源分组中移除
    const bookmarksToMove = sourceGroup.bookmarks.filter(b => idsToMove.has(b.id));
    sourceGroup.bookmarks = sourceGroup.bookmarks.filter(b => !idsToMove.has(b.id));
    sourceGroup.updatedAt = nowISO();

    // 移动的书签变为顶层 (清除 parentId)
    bookmark.parentId = undefined;

    // Calculate new order for target group (顶层)
    const topLevelInTarget = targetGroup.bookmarks.filter(b => !b.parentId);
    bookmark.order = topLevelInTarget.length > 0
      ? Math.max(...topLevelInTarget.map(b => b.order)) + 1
      : 1;

    // Add all bookmarks to target group
    for (const b of bookmarksToMove) {
      targetGroup.bookmarks.push(b);
    }
    targetGroup.updatedAt = nowISO();

    this.save();
    this._onDidChange.fire();

    return { success: true, movedCount: bookmarksToMove.length };
  }

  // Adjust bookmarks when document changes (line drift handling)
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

          // 只处理同一文件的书签
          if (parsed.filePath !== normalizedPath) {
            continue;
          }

          // 调整行号
          const adjusted = adjustLineNumbers(parsed, editStartLine, lineDelta);

          // 如果行号有变化, 更新书签
          if (adjusted.startLine !== parsed.startLine || adjusted.endLine !== parsed.endLine) {
            bookmark.location = formatLocation(adjusted);
            hasChanges = true;
          }
        } catch (error) {
          // 忽略无法解析的书签
          console.error(`Failed to parse bookmark location: ${bookmark.location}`, error);
        }
      }

      if (hasChanges) {
        group.updatedAt = nowISO();
      }
    }

    if (hasChanges) {
      this.save();
      this._onDidChange.fire();
    }
  }

  // Cleanup
  dispose(): void {
    this.fileWatcher?.dispose();
    this._onDidChange.dispose();
  }
}
