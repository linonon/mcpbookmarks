import { BookmarkStoreManagerStandalone } from '../store/bookmarkStoreStandalone';
import {
  CreateGroupArgs,
  AddBookmarkArgs,
  AddChildBookmarkArgs,
  ListGroupsArgs,
  ListBookmarksArgs,
  UpdateGroupArgs,
  UpdateBookmarkArgs,
  RemoveBookmarkArgs,
  RemoveGroupArgs,
  GetGroupArgs,
  GetBookmarkArgs,
  GetBookmarkTreeArgs,
  BatchAddBookmarksArgs,
  ClearAllBookmarksArgs,
  BookmarkCategory
} from '../store/types';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class MCPHandlersStandalone {
  constructor(private store: BookmarkStoreManagerStandalone) {}

  // create_group
  createGroup(args: CreateGroupArgs): ToolResult {
    try {
      const { name, description, query } = args;

      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name is required and must be a string' };
      }

      const groupId = this.store.createGroup(name, description, query, 'ai');

      return {
        success: true,
        data: {
          groupId,
          message: `Successfully created group "${name}"`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create group: ${error}`
      };
    }
  }

  // add_bookmark
  addBookmark(args: AddBookmarkArgs): ToolResult {
    try {
      const { groupId, parentId, location, title, description, order, category, tags } = args;

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }
      if (!location || typeof location !== 'string') {
        return { success: false, error: 'location is required and must be a string' };
      }
      if (!title || typeof title !== 'string') {
        return { success: false, error: 'title is required and must be a string' };
      }
      if (!description || typeof description !== 'string') {
        return { success: false, error: 'description is required and must be a string' };
      }

      const validCategories: BookmarkCategory[] = [
        'entry-point', 'core-logic', 'issue', 'note'
      ];
      if (category && !validCategories.includes(category)) {
        return {
          success: false,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        };
      }

      const bookmarkId = this.store.addBookmark(groupId, location, title, description, {
        parentId,
        order,
        category,
        tags
      });

      if (!bookmarkId) {
        // Could be group not found or parent bookmark not found
        const group = this.store.getGroup(groupId);
        if (!group) {
          return { success: false, error: `Group with id "${groupId}" not found` };
        }
        if (parentId) {
          return { success: false, error: `Parent bookmark with id "${parentId}" not found in group` };
        }
        return { success: false, error: `Failed to add bookmark` };
      }

      return {
        success: true,
        data: {
          bookmarkId,
          parentId: parentId || null,
          message: `Successfully added bookmark "${title}"${parentId ? ' as child bookmark' : ' to group'}`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add bookmark: ${error}`
      };
    }
  }

  // add_child_bookmark
  addChildBookmark(args: AddChildBookmarkArgs): ToolResult {
    try {
      const { parentBookmarkId, location, title, description, order, category, tags } = args;

      if (!parentBookmarkId || typeof parentBookmarkId !== 'string') {
        return { success: false, error: 'parentBookmarkId is required and must be a string' };
      }
      if (!location || typeof location !== 'string') {
        return { success: false, error: 'location is required and must be a string' };
      }
      if (!title || typeof title !== 'string') {
        return { success: false, error: 'title is required and must be a string' };
      }
      if (!description || typeof description !== 'string') {
        return { success: false, error: 'description is required and must be a string' };
      }

      const validCategories: BookmarkCategory[] = [
        'entry-point', 'core-logic', 'issue', 'note'
      ];
      if (category && !validCategories.includes(category)) {
        return {
          success: false,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        };
      }

      const bookmarkId = this.store.addChildBookmark(parentBookmarkId, location, title, description, {
        order,
        category,
        tags
      });

      if (!bookmarkId) {
        return { success: false, error: `Parent bookmark with id "${parentBookmarkId}" not found` };
      }

      return {
        success: true,
        data: {
          bookmarkId,
          parentBookmarkId,
          message: `Successfully added child bookmark "${title}"`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add child bookmark: ${error}`
      };
    }
  }

  // list_groups
  listGroups(args: ListGroupsArgs): ToolResult {
    try {
      const { createdBy } = args;

      if (createdBy && !['ai', 'user'].includes(createdBy)) {
        return {
          success: false,
          error: 'createdBy must be either "ai" or "user"'
        };
      }

      const groups = this.store.listGroups(createdBy as 'ai' | 'user' | undefined);

      return {
        success: true,
        data: {
          groups: groups.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            query: g.query,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
            createdBy: g.createdBy,
            bookmarkCount: g.bookmarks.length
          })),
          total: groups.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list groups: ${error}`
      };
    }
  }

  // list_bookmarks
  listBookmarks(args: ListBookmarksArgs): ToolResult {
    try {
      const { groupId, parentId, includeDescendants, filePath, category, tags } = args;

      const validCategories: BookmarkCategory[] = [
        'entry-point', 'core-logic', 'issue', 'note'
      ];
      if (category && !validCategories.includes(category)) {
        return {
          success: false,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        };
      }

      const results = this.store.listBookmarks({
        groupId,
        parentId,
        includeDescendants,
        filePath,
        category,
        tags
      });

      return {
        success: true,
        data: {
          bookmarks: results.map(r => ({
            id: r.bookmark.id,
            parentId: r.bookmark.parentId || null,
            order: r.bookmark.order,
            location: r.bookmark.location,
            title: r.bookmark.title,
            description: r.bookmark.description,
            category: r.bookmark.category,
            tags: r.bookmark.tags,
            groupId: r.group.id,
            groupName: r.group.name,
            hasChildren: this.store.hasChildren(r.bookmark.id)
          })),
          total: results.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list bookmarks: ${error}`
      };
    }
  }

  // update_group
  updateGroup(args: UpdateGroupArgs): ToolResult {
    try {
      const { groupId, name, description } = args;

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      if (name === undefined && description === undefined) {
        return { success: false, error: 'At least one of name or description must be provided' };
      }

      const success = this.store.updateGroup(groupId, { name, description });

      if (!success) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      return {
        success: true,
        data: {
          message: `Successfully updated group "${groupId}"`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update group: ${error}`
      };
    }
  }

  // update_bookmark
  updateBookmark(args: UpdateBookmarkArgs): ToolResult {
    try {
      const { bookmarkId, parentId, location, title, description, order, category, tags } = args;

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      if (parentId === undefined && location === undefined && title === undefined &&
          description === undefined && order === undefined && category === undefined &&
          tags === undefined) {
        return { success: false, error: 'At least one update field must be provided' };
      }

      const validCategories: BookmarkCategory[] = [
        'entry-point', 'core-logic', 'issue', 'note'
      ];
      if (category && !validCategories.includes(category)) {
        return {
          success: false,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        };
      }

      const result = this.store.updateBookmark(bookmarkId, {
        parentId,
        location,
        title,
        description,
        order,
        category,
        tags
      });

      if (result === 'circular_reference') {
        return {
          success: false,
          error: 'Cannot move bookmark: would create circular reference (bookmark cannot be its own ancestor)'
        };
      }

      if (result === 'parent_not_found') {
        return {
          success: false,
          error: `Parent bookmark with id "${parentId}" not found in the same group`
        };
      }

      if (!result) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      return {
        success: true,
        data: {
          message: `Successfully updated bookmark "${bookmarkId}"`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update bookmark: ${error}`
      };
    }
  }

  // remove_bookmark
  removeBookmark(args: RemoveBookmarkArgs): ToolResult {
    try {
      const { bookmarkId } = args;

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const success = this.store.removeBookmark(bookmarkId);

      if (!success) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      return {
        success: true,
        data: {
          message: `Successfully removed bookmark "${bookmarkId}"`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove bookmark: ${error}`
      };
    }
  }

  // remove_group
  removeGroup(args: RemoveGroupArgs): ToolResult {
    try {
      const { groupId } = args;

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      const group = this.store.getGroup(groupId);
      if (!group) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      const bookmarkCount = group.bookmarks.length;
      const success = this.store.removeGroup(groupId);

      if (!success) {
        return { success: false, error: `Failed to remove group "${groupId}"` };
      }

      return {
        success: true,
        data: {
          message: `Successfully removed group "${group.name}" with ${bookmarkCount} bookmark(s)`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove group: ${error}`
      };
    }
  }

  // get_group - 获取单个分组的详细信息(包含所有书签)
  getGroup(args: GetGroupArgs): ToolResult {
    try {
      const { groupId } = args;

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      const group = this.store.getGroup(groupId);
      if (!group) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      // Get tree structure for the group
      const bookmarkTrees = this.store.getGroupBookmarkTrees(groupId);

      return {
        success: true,
        data: {
          group: {
            id: group.id,
            name: group.name,
            description: group.description,
            query: group.query,
            createdAt: group.createdAt,
            updatedAt: group.updatedAt,
            createdBy: group.createdBy,
            // Flat list with parentId for compatibility
            bookmarks: group.bookmarks.map(b => ({
              id: b.id,
              parentId: b.parentId || null,
              order: b.order,
              location: b.location,
              title: b.title,
              description: b.description,
              category: b.category,
              tags: b.tags,
              hasChildren: this.store.hasChildren(b.id)
            })),
            // Tree structure for hierarchical display
            bookmarkTrees
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get group: ${error}`
      };
    }
  }

  // get_bookmark - 获取单个书签的详细信息
  getBookmark(args: GetBookmarkArgs): ToolResult {
    try {
      const { bookmarkId } = args;

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const result = this.store.getBookmark(bookmarkId);
      if (!result) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      const { bookmark, group } = result;
      const childCount = this.store.getChildBookmarks(bookmarkId).length;

      return {
        success: true,
        data: {
          bookmark: {
            id: bookmark.id,
            parentId: bookmark.parentId || null,
            order: bookmark.order,
            location: bookmark.location,
            title: bookmark.title,
            description: bookmark.description,
            category: bookmark.category,
            tags: bookmark.tags,
            codeSnapshot: bookmark.codeSnapshot,
            hasChildren: childCount > 0,
            childCount
          },
          group: {
            id: group.id,
            name: group.name
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get bookmark: ${error}`
      };
    }
  }

  // get_bookmark_tree - 获取书签及其所有子书签的树形结构
  getBookmarkTree(args: GetBookmarkTreeArgs): ToolResult {
    try {
      const { bookmarkId, maxDepth } = args;

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const tree = this.store.getBookmarkTree(bookmarkId, maxDepth);
      if (!tree) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      const result = this.store.getBookmark(bookmarkId);

      return {
        success: true,
        data: {
          tree,
          group: result ? {
            id: result.group.id,
            name: result.group.name
          } : null
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get bookmark tree: ${error}`
      };
    }
  }

  // batch_add_bookmarks - 批量添加书签到分组
  batchAddBookmarks(args: BatchAddBookmarksArgs): ToolResult {
    try {
      const { groupId, parentId, bookmarks } = args;

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      if (!bookmarks || !Array.isArray(bookmarks) || bookmarks.length === 0) {
        return { success: false, error: 'bookmarks array is required and must not be empty' };
      }

      const group = this.store.getGroup(groupId);
      if (!group) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      // Validate parentId if provided
      if (parentId) {
        const parentBookmark = group.bookmarks.find(b => b.id === parentId);
        if (!parentBookmark) {
          return { success: false, error: `Parent bookmark with id "${parentId}" not found in group` };
        }
      }

      const validCategories: BookmarkCategory[] = [
        'entry-point', 'core-logic', 'issue', 'note'
      ];

      const results: Array<{ index: number; bookmarkId?: string; error?: string }> = [];
      let successCount = 0;

      for (let i = 0; i < bookmarks.length; i++) {
        const b = bookmarks[i];

        // Validate required fields
        if (!b.location || typeof b.location !== 'string') {
          results.push({ index: i, error: 'location is required' });
          continue;
        }
        if (!b.title || typeof b.title !== 'string') {
          results.push({ index: i, error: 'title is required' });
          continue;
        }
        if (!b.description || typeof b.description !== 'string') {
          results.push({ index: i, error: 'description is required' });
          continue;
        }
        if (b.category && !validCategories.includes(b.category)) {
          results.push({ index: i, error: `Invalid category: ${b.category}` });
          continue;
        }

        const bookmarkId = this.store.addBookmark(groupId, b.location, b.title, b.description, {
          parentId,
          order: b.order,
          category: b.category,
          tags: b.tags
        });

        if (bookmarkId) {
          results.push({ index: i, bookmarkId });
          successCount++;
        } else {
          results.push({ index: i, error: 'Failed to add bookmark' });
        }
      }

      return {
        success: successCount > 0,
        data: {
          message: `Added ${successCount}/${bookmarks.length} bookmarks${parentId ? ' as children' : ''} to group "${group.name}"`,
          parentId: parentId || null,
          results
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch add bookmarks: ${error}`
      };
    }
  }

  // clear_all_bookmarks - 清除所有书签和分组
  clearAllBookmarks(args: ClearAllBookmarksArgs): ToolResult {
    try {
      const { confirm } = args;

      // 安全检查: 需要显式确认
      if (confirm !== true) {
        return {
          success: false,
          error: 'This operation will remove ALL bookmarks and groups. Set confirm=true to proceed.'
        };
      }

      const { groupsRemoved, bookmarksRemoved } = this.store.clearAll();

      return {
        success: true,
        data: {
          message: `Successfully cleared all bookmarks`,
          groupsRemoved,
          bookmarksRemoved
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear all bookmarks: ${error}`
      };
    }
  }
}
