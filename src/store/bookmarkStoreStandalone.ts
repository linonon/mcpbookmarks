import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
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
import { nowISO, parseLocation, normalizePath } from '../utils';

const STORE_FILE_NAME = 'mcp-bookmarks.json';
const STORE_DIR = '.vscode';

/**
 * Standalone BookmarkStoreManager without VSCode dependencies.
 * Used by the MCP server running outside of VSCode.
 */
export class BookmarkStoreManagerStandalone extends EventEmitter {
  private store: BookmarkStore;
  private storePath: string;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.storePath = path.join(workspaceRoot, STORE_DIR, STORE_FILE_NAME);
    this.store = this.load();
  }

  private load(): BookmarkStore {
    try {
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
    this.emit('change');
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
    this.emit('change');

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
    this.emit('change');

    return true;
  }

  removeGroup(groupId: string): boolean {
    const index = this.store.groups.findIndex(g => g.id === groupId);
    if (index === -1) {
      return false;
    }

    this.store.groups.splice(index, 1);
    this.save();
    this.emit('change');

    return true;
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

    // Validate parentId if provided
    if (options.parentId) {
      const parentBookmark = group.bookmarks.find(b => b.id === options.parentId);
      if (!parentBookmark) {
        return undefined; // Parent bookmark not found
      }
    }

    const id = uuidv4();

    // Determine order (within siblings - same parentId)
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
    this.emit('change');

    return id;
  }

  // Add child bookmark (semantic interface)
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
    // Find parent bookmark's group
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
    parentId?: string;           // Only list children of specified parent
    includeDescendants?: boolean; // Include all descendants
    topLevelOnly?: boolean;       // Only return top-level bookmarks
    filePath?: string;
    category?: BookmarkCategory;
  } = {}): Array<{ bookmark: Bookmark; group: BookmarkGroup }> {
    const results: Array<{ bookmark: Bookmark; group: BookmarkGroup }> = [];

    const groups = filters.groupId
      ? this.store.groups.filter(g => g.id === filters.groupId)
      : this.store.groups;

    for (const group of groups) {
      let bookmarksToCheck = group.bookmarks;

      // Filter by parentId
      if (filters.parentId !== undefined) {
        if (filters.includeDescendants) {
          // Get all descendants
          bookmarksToCheck = this.getDescendants(group, filters.parentId);
        } else {
          // Only direct children
          bookmarksToCheck = group.bookmarks.filter(b => b.parentId === filters.parentId);
        }
      } else if (filters.topLevelOnly) {
        // Only top-level bookmarks
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

    // Sort by order
    results.sort((a, b) => a.bookmark.order - b.bookmark.order);

    return results;
  }

  // Get all descendants of a bookmark
  private getDescendants(group: BookmarkGroup, parentId: string): Bookmark[] {
    const descendants: Bookmark[] = [];
    const directChildren = group.bookmarks.filter(b => b.parentId === parentId);

    for (const child of directChildren) {
      descendants.push(child);
      descendants.push(...this.getDescendants(group, child.id));
    }

    return descendants;
  }

  // Get direct children of a bookmark
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

  // Check if bookmark has children
  hasChildren(bookmarkId: string): boolean {
    for (const group of this.store.groups) {
      if (group.bookmarks.some(b => b.parentId === bookmarkId)) {
        return true;
      }
    }
    return false;
  }

  // Get bookmark tree (recursive structure)
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

    // Build subtree if not at max depth
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

  // Get top-level bookmark trees for a group
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
      parentId?: string | null;   // null means move to top level
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

    // Handle parentId change
    if (updates.parentId !== undefined) {
      const newParentId = updates.parentId === null ? undefined : updates.parentId;

      // Validate new parent
      if (newParentId) {
        // Check parent exists
        const parentBookmark = group.bookmarks.find(b => b.id === newParentId);
        if (!parentBookmark) {
          return 'parent_not_found';
        }

        // Check for circular reference
        if (this.wouldCreateCircularReference(group, bookmarkId, newParentId)) {
          return 'circular_reference';
        }
      }

      bookmark.parentId = newParentId;

      // Recalculate order within new siblings
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
    this.emit('change');

    return true;
  }

  // Check if moving would create circular reference
  private wouldCreateCircularReference(
    group: BookmarkGroup,
    bookmarkId: string,
    newParentId: string
  ): boolean {
    // Self-reference
    if (bookmarkId === newParentId) {
      return true;
    }

    // Check if new parent is a descendant of this bookmark
    const descendants = this.getDescendants(group, bookmarkId);
    return descendants.some(d => d.id === newParentId);
  }

  removeBookmark(bookmarkId: string): boolean {
    for (const group of this.store.groups) {
      const bookmark = group.bookmarks.find(b => b.id === bookmarkId);
      if (bookmark) {
        // Get all descendants (cascade delete)
        const descendants = this.getDescendants(group, bookmarkId);
        const idsToRemove = new Set([bookmarkId, ...descendants.map(d => d.id)]);

        // Remove all bookmarks in the set
        group.bookmarks = group.bookmarks.filter(b => !idsToRemove.has(b.id));
        group.updatedAt = nowISO();

        this.save();
        this.emit('change');

        return true;
      }
    }
    return false;
  }

  // Clear all bookmarks and groups
  clearAll(): { groupsRemoved: number; bookmarksRemoved: number } {
    const groupsRemoved = this.store.groups.length;
    const bookmarksRemoved = this.store.groups.reduce(
      (total, group) => total + group.bookmarks.length,
      0
    );

    this.store.groups = [];
    this.save();
    this.emit('change');

    return { groupsRemoved, bookmarksRemoved };
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

  // Cleanup
  dispose(): void {
    this.removeAllListeners();
  }
}
