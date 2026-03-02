import { v4 as uuidv4 } from 'uuid';
import {
  BookmarkStore,
  BookmarkGroup,
  Bookmark,
  BookmarkWithChildren,
  BookmarkCategory,
  UpdateBookmarkResult,
} from './types';
import { nowISO, parseLocation, normalizePath } from '../utils';

/**
 * BookmarkStore 的抽象基类.
 * 包含所有 CRUD 逻辑, 子类只需实现 I/O 和通知机制.
 */
export abstract class BookmarkStoreBase {
  protected store: BookmarkStore;
  protected workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.store = this.loadFromDisk();
  }

  // --- 子类必须实现的抽象方法 ---

  /** 从磁盘加载 store, 如果不存在则返回默认 store */
  protected abstract loadFromDisk(): BookmarkStore;

  /** 将当前 store 持久化到磁盘 */
  protected abstract saveToDisk(): void;

  /** 通知变更 (VSCode: EventEmitter.fire, Standalone: EventEmitter.emit) */
  protected abstract notifyChange(): void;

  // --- 数据迁移 ---

  protected migrateStore(store: BookmarkStore): { store: BookmarkStore; migrated: boolean } {
    let migrated = false;

    if (!Array.isArray(store.groups)) {
      store.groups = [];
      migrated = true;
    }

    for (const group of store.groups) {
      const legacyGroup = group as BookmarkGroup & { name?: string; title?: string };
      if (!legacyGroup.title || typeof legacyGroup.title !== 'string') {
        if (typeof legacyGroup.name === 'string' && legacyGroup.name.trim().length > 0) {
          legacyGroup.title = legacyGroup.name;
        } else {
          legacyGroup.title = 'Untitled group';
        }
        migrated = true;
      }
      if (legacyGroup.name !== undefined) {
        delete (legacyGroup as { name?: string }).name;
        migrated = true;
      }
    }

    return { store, migrated };
  }

  // --- Group 操作 ---

  createGroup(
    title: string,
    description?: string,
    createdBy: 'ai' | 'user' = 'ai'
  ): string {
    const id = uuidv4();
    const now = nowISO();

    const group: BookmarkGroup = {
      id,
      title,
      description,
      createdAt: now,
      updatedAt: now,
      createdBy,
      bookmarks: []
    };

    this.store.groups.push(group);
    this.saveToDisk();
    this.notifyChange();

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

  updateGroup(groupId: string, updates: { title?: string; description?: string }): boolean {
    const group = this.store.groups.find(g => g.id === groupId);
    if (!group) {
      return false;
    }

    if (updates.title !== undefined) {
      group.title = updates.title;
    }
    if (updates.description !== undefined) {
      group.description = updates.description;
    }
    group.updatedAt = nowISO();

    this.saveToDisk();
    this.notifyChange();

    return true;
  }

  removeGroup(groupId: string): boolean {
    const index = this.store.groups.findIndex(g => g.id === groupId);
    if (index === -1) {
      return false;
    }

    this.store.groups.splice(index, 1);
    this.saveToDisk();
    this.notifyChange();

    return true;
  }

  clearAll(): { groupsRemoved: number; bookmarksRemoved: number } {
    const groupsRemoved = this.store.groups.length;
    const bookmarksRemoved = this.store.groups.reduce(
      (total, group) => total + group.bookmarks.length,
      0
    );

    this.store.groups = [];
    this.saveToDisk();
    this.notifyChange();

    return { groupsRemoved, bookmarksRemoved };
  }

  // --- Bookmark 操作 ---

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
        return undefined;
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

    this.saveToDisk();
    this.notifyChange();

    return id;
  }

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
    parentId?: string;
    includeDescendants?: boolean;
    topLevelOnly?: boolean;
    filePath?: string;
    category?: BookmarkCategory;
  } = {}): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    const results: Array<{ bookmark: Bookmark; group: BookmarkGroup }> = [];

    const groups = filters.groupId
      ? this.store.groups.filter(g => g.id === filters.groupId)
      : this.store.groups;

    for (const group of groups) {
      let bookmarksToCheck = group.bookmarks;

      if (filters.parentId !== undefined) {
        if (filters.includeDescendants) {
          bookmarksToCheck = this.getDescendants(group, filters.parentId);
        } else {
          bookmarksToCheck = group.bookmarks.filter(b => b.parentId === filters.parentId);
        }
      } else if (filters.topLevelOnly) {
        bookmarksToCheck = group.bookmarks.filter(b => !b.parentId);
      }

      for (const bookmark of bookmarksToCheck) {
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

    results.sort((a, b) => a.bookmark.order - b.bookmark.order);

    return results;
  }

  protected getDescendants(group: BookmarkGroup, parentId: string): Bookmark[] {
    const descendants: Bookmark[] = [];
    const directChildren = group.bookmarks.filter(b => b.parentId === parentId);

    for (const child of directChildren) {
      descendants.push(child);
      descendants.push(...this.getDescendants(group, child.id));
    }

    return descendants;
  }

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

  hasChildren(bookmarkId: string): boolean {
    for (const group of this.store.groups) {
      if (group.bookmarks.some(b => b.parentId === bookmarkId)) {
        return true;
      }
    }
    return false;
  }

  getBookmarkTree(bookmarkId: string, maxDepth?: number): BookmarkWithChildren | undefined {
    const result = this.getBookmark(bookmarkId);
    if (!result) {
      return undefined;
    }

    return this.buildBookmarkTree(result.bookmark, result.group, maxDepth, 0);
  }

  protected buildBookmarkTree(
    bookmark: Bookmark,
    group: BookmarkGroup,
    maxDepth: number | undefined,
    currentDepth: number
  ): BookmarkWithChildren {
    const children: BookmarkWithChildren[] = [];

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
      parentId?: string | null;
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

      if (newParentId) {
        const parentBookmark = group.bookmarks.find(b => b.id === newParentId);
        if (!parentBookmark) {
          return 'parent_not_found';
        }

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

    this.saveToDisk();
    this.notifyChange();

    return true;
  }

  protected wouldCreateCircularReference(
    group: BookmarkGroup,
    bookmarkId: string,
    newParentId: string
  ): boolean {
    if (bookmarkId === newParentId) {
      return true;
    }

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

        this.saveToDisk();
        this.notifyChange();

        return { success: true, removedCount };
      }
    }
    return { success: false, removedCount: 0 };
  }

  getBookmarksByFile(filePath: string): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    const normalizedPath = normalizePath(filePath, this.workspaceRoot);
    return this.listBookmarks({ filePath: normalizedPath });
  }

  getAllBookmarks(): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    return this.listBookmarks();
  }

  exportToMarkdown(): string {
    const lines: string[] = [];
    lines.push(`# ${this.store.projectName} - MCP Bookmarks`);
    lines.push('');

    for (const group of this.store.groups) {
      lines.push(`## ${group.title}`);
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
}
