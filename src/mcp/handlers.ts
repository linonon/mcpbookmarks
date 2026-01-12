import { BookmarkStoreManager } from '../store/bookmarkStore';
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
  BatchRemoveBookmarksArgs,
  ClearAllBookmarksArgs,
  BookmarkCategory,
  BookmarkWithChildren
} from '../store/types';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class MCPHandlers {
  constructor(private store: BookmarkStoreManager) {}

  // create_group - 创建一个新的书签分组
  createGroup(args: CreateGroupArgs): ToolResult {
    try {
      const { title, description, name } = args;
      const groupTitle = title ?? name;

      if (!groupTitle || typeof groupTitle !== 'string') {
        return { success: false, error: 'title is required and must be a string' };
      }

      const groupId = this.store.createGroup(groupTitle, description, 'ai');

      return {
        success: true,
        data: {
          groupId,
          message: `Successfully created group "${groupTitle}"`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create group: ${error}`
      };
    }
  }

  // add_bookmark - 在指定分组中添加书签(支持parentId指定父书签)
  addBookmark(args: AddBookmarkArgs): ToolResult {
    try {
      const { groupId, parentId, location, title, description, order, category } = args;

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

      // Validate category if provided
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
        category
      });

      if (!bookmarkId) {
        // Could be group not found or parent not found
        const group = this.store.getGroup(groupId);
        if (!group) {
          return { success: false, error: `Group with id "${groupId}" not found` };
        }
        if (parentId) {
          return { success: false, error: `Parent bookmark with id "${parentId}" not found in group` };
        }
        return { success: false, error: 'Failed to add bookmark' };
      }

      const message = parentId
        ? `Successfully added child bookmark "${title}" under parent "${parentId}"`
        : `Successfully added bookmark "${title}" to group`;

      return {
        success: true,
        data: {
          bookmarkId,
          parentId: parentId || null,
          message
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add bookmark: ${error}`
      };
    }
  }

  // add_child_bookmark - 给现有书签添加子书签(语义化接口)
  addChildBookmark(args: AddChildBookmarkArgs): ToolResult {
    try {
      const { parentBookmarkId, location, title, description, order, category } = args;

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

      // Validate category if provided
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
        category
      });

      if (!bookmarkId) {
        return { success: false, error: `Parent bookmark with id "${parentBookmarkId}" not found` };
      }

      return {
        success: true,
        data: {
          bookmarkId,
          parentBookmarkId,
          message: `Successfully added child bookmark "${title}" under parent`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add child bookmark: ${error}`
      };
    }
  }

  // list_groups - 列出所有书签分组
  listGroups(args: ListGroupsArgs): ToolResult {
    try {
      const { createdBy } = args;

      // Validate createdBy if provided
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
            title: g.title,
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

  // list_bookmarks - 列出书签, 支持筛选(支持parentId过滤和includeDescendants)
  listBookmarks(args: ListBookmarksArgs): ToolResult {
    try {
      const { groupId, parentId, includeDescendants, filePath, category } = args;

      // Validate category if provided
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
        category
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
            collapsed: r.bookmark.collapsed,
            hasChildren: this.store.hasChildren(r.bookmark.id),
            groupId: r.group.id,
            groupTitle: r.group.title
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

  // update_group - 更新分组信息
  updateGroup(args: UpdateGroupArgs): ToolResult {
    try {
      const { groupId, title, description, name } = args;
      const groupTitle = title ?? name;

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      if (groupTitle === undefined && description === undefined) {
        return { success: false, error: 'At least one of title or description must be provided' };
      }

      const updates: { title?: string; description?: string } = {};
      if (groupTitle !== undefined) {
        updates.title = groupTitle;
      }
      if (description !== undefined) {
        updates.description = description;
      }

      const success = this.store.updateGroup(groupId, updates);

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

  // update_bookmark - 更新书签内容(支持parentId移动层级)
  updateBookmark(args: UpdateBookmarkArgs): ToolResult {
    try {
      const { bookmarkId, parentId, location, title, description, order, category } = args;

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      // Check if at least one update field is provided
      // parentId can be null (move to top level) or string (move under parent)
      if (location === undefined && title === undefined && description === undefined &&
          order === undefined && category === undefined &&
          parentId === undefined) {
        return { success: false, error: 'At least one update field must be provided' };
      }

      // Validate category if provided
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
        category
      });

      if (result === 'not_found') {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      if (result === 'circular_reference') {
        return { success: false, error: 'Cannot move bookmark: would create circular reference' };
      }

      if (result === 'parent_not_found') {
        return { success: false, error: `Parent bookmark with id "${parentId}" not found in the same group` };
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

  // remove_bookmark - 删除书签(级联删除所有子书签)
  removeBookmark(args: RemoveBookmarkArgs): ToolResult {
    try {
      const { bookmarkId } = args;

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const result = this.store.removeBookmark(bookmarkId);

      if (!result.success) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      const message = result.removedCount > 1
        ? `Successfully removed bookmark "${bookmarkId}" and ${result.removedCount - 1} child bookmark(s)`
        : `Successfully removed bookmark "${bookmarkId}"`;

      return {
        success: true,
        data: {
          message,
          removedCount: result.removedCount
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove bookmark: ${error}`
      };
    }
  }

  // remove_group - 删除整个分组(包含其中所有书签)
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
          message: `Successfully removed group "${group.title}" with ${bookmarkCount} bookmark(s)`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove group: ${error}`
      };
    }
  }

  // get_group - 获取单个分组的详细信息(包含所有书签,支持树形结构)
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

      // Helper to convert tree to response format
      const formatTree = (node: BookmarkWithChildren): object => ({
        id: node.id,
        parentId: node.parentId || null,
        order: node.order,
        location: node.location,
        title: node.title,
        description: node.description,
        category: node.category,
        collapsed: node.collapsed,
        children: node.children.map(formatTree)
      });

      return {
        success: true,
        data: {
          group: {
            id: group.id,
            title: group.title,
            description: group.description,
            query: group.query,
            createdAt: group.createdAt,
            updatedAt: group.updatedAt,
            createdBy: group.createdBy,
            // Flat list for backward compatibility
            bookmarks: group.bookmarks.map(b => ({
              id: b.id,
              parentId: b.parentId || null,
              order: b.order,
              location: b.location,
              title: b.title,
              description: b.description,
              category: b.category,
              collapsed: b.collapsed,
              hasChildren: this.store.hasChildren(b.id)
            })),
            // Tree structure
            bookmarkTrees: bookmarkTrees.map(formatTree)
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

      // Get children info
      const children = this.store.getChildBookmarks(bookmarkId);

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
            collapsed: bookmark.collapsed,
            codeSnapshot: bookmark.codeSnapshot,
            hasChildren: children.length > 0,
            childCount: children.length
          },
          group: {
            id: group.id,
            title: group.title
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

      // Get the group for this bookmark
      const bookmarkResult = this.store.getBookmark(bookmarkId);
      if (!bookmarkResult) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      // Helper to convert tree to response format with depth info
      const formatTree = (node: BookmarkWithChildren, depth: number = 0): object => ({
        id: node.id,
        parentId: node.parentId || null,
        order: node.order,
        location: node.location,
        title: node.title,
        description: node.description,
        category: node.category,
        collapsed: node.collapsed,
        depth,
        children: node.children.map(child => formatTree(child, depth + 1))
      });

      // Count total nodes in tree
      const countNodes = (node: BookmarkWithChildren): number => {
        return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
      };

      return {
        success: true,
        data: {
          tree: formatTree(tree),
          group: {
            id: bookmarkResult.group.id,
            title: bookmarkResult.group.title
          },
          totalNodes: countNodes(tree)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get bookmark tree: ${error}`
      };
    }
  }

  // batch_add_bookmarks - 批量添加书签到分组(支持parentId指定父书签)
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

      // Validate parent exists if specified
      if (parentId) {
        const parent = group.bookmarks.find(b => b.id === parentId);
        if (!parent) {
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
          parentId,  // Use the batch-level parentId
          order: b.order,
          category: b.category
        });

        if (bookmarkId) {
          results.push({ index: i, bookmarkId });
          successCount++;
        } else {
          results.push({ index: i, error: 'Failed to add bookmark' });
        }
      }

      const message = parentId
        ? `Added ${successCount}/${bookmarks.length} child bookmarks under parent "${parentId}"`
        : `Added ${successCount}/${bookmarks.length} bookmarks to group "${group.title}"`;

      return {
        success: successCount > 0,
        data: {
          message,
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

  // batch_remove_bookmarks - 批量删除书签
  batchRemoveBookmarks(args: BatchRemoveBookmarksArgs): ToolResult {
    try {
      const { bookmarkIds } = args;

      if (!bookmarkIds || !Array.isArray(bookmarkIds) || bookmarkIds.length === 0) {
        return { success: false, error: 'bookmarkIds array is required and must not be empty' };
      }

      const results: Array<{ bookmarkId: string; success: boolean; error?: string }> = [];
      let successCount = 0;

      for (const bookmarkId of bookmarkIds) {
        if (!bookmarkId || typeof bookmarkId !== 'string') {
          results.push({ bookmarkId: bookmarkId || '(invalid)', success: false, error: 'Invalid bookmark ID' });
          continue;
        }

        const removed = this.store.removeBookmark(bookmarkId);
        if (removed) {
          results.push({ bookmarkId, success: true });
          successCount++;
        } else {
          results.push({ bookmarkId, success: false, error: 'Bookmark not found or failed to remove' });
        }
      }

      return {
        success: successCount > 0,
        data: {
          message: `Removed ${successCount}/${bookmarkIds.length} bookmarks`,
          results
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch remove bookmarks: ${error}`
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
