import { WorkspaceManager } from '../store/workspaceManager';
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
  Bookmark,
  BookmarkGroup
} from '../store/types';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// 扩展参数类型，添加可选的 projectRoot
type WithProjectRoot<T> = T & { projectRoot?: string };

export class MCPHandlersStandalone {
  constructor(private workspaceManager: WorkspaceManager) {}

  /**
   * 获取指定工作区的 store
   */
  private getStore(projectRoot?: string) {
    return this.workspaceManager.getStore(projectRoot);
  }

  // set_workspace - 设置当前活动工作区
  setWorkspace(args: { path: string }): ToolResult {
    try {
      const { path } = args;

      if (!path || typeof path !== 'string') {
        return { success: false, error: 'path is required and must be a string' };
      }

      // 验证路径存在
      const fs = require('fs');
      if (!fs.existsSync(path)) {
        return { success: false, error: `Workspace path does not exist: ${path}` };
      }

      // 设置默认工作区
      this.workspaceManager.setDefaultWorkspace(path);

      // 预先获取 store 以验证并初始化
      this.workspaceManager.getStore(path);

      return {
        success: true,
        data: {
          workspace: path,
          message: `Workspace set to: ${path}`,
          bookmarkFile: `${path}/.vscode/mcp-bookmarks.json`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to set workspace: ${error}`
      };
    }
  }

  // get_workspace - 获取当前工作区信息
  getWorkspace(): ToolResult {
    try {
      const defaultWorkspace = this.workspaceManager.getDefaultWorkspace();
      const activeWorkspaces = this.workspaceManager.listActiveWorkspaces();

      return {
        success: true,
        data: {
          currentWorkspace: defaultWorkspace,
          activeWorkspaces: activeWorkspaces,
          bookmarkFile: `${defaultWorkspace}/.vscode/mcp-bookmarks.json`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get workspace: ${error}`
      };
    }
  }

  // create_group
  createGroup(args: WithProjectRoot<CreateGroupArgs>): ToolResult {
    try {
      const { name, description, query, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name is required and must be a string' };
      }

      const groupId = store.createGroup(name, description, query, 'ai');

      return {
        success: true,
        data: {
          groupId,
          message: `Successfully created group "${name}"`,
          projectRoot: projectRoot || this.workspaceManager.getDefaultWorkspace()
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
  addBookmark(args: WithProjectRoot<AddBookmarkArgs>): ToolResult {
    try {
      const { groupId, parentId, location, title, description, order, category, projectRoot } = args;
      const store = this.getStore(projectRoot);

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

      const bookmarkId = store.addBookmark(groupId, location, title, description, {
        parentId,
        order,
        category
      });

      if (!bookmarkId) {
        const group = store.getGroup(groupId);
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
  addChildBookmark(args: WithProjectRoot<AddChildBookmarkArgs>): ToolResult {
    try {
      const { parentBookmarkId, location, title, description, order, category, projectRoot } = args;
      const store = this.getStore(projectRoot);

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

      const bookmarkId = store.addChildBookmark(parentBookmarkId, location, title, description, {
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
  listGroups(args: WithProjectRoot<ListGroupsArgs>): ToolResult {
    try {
      const { createdBy, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (createdBy && !['ai', 'user'].includes(createdBy)) {
        return {
          success: false,
          error: 'createdBy must be either "ai" or "user"'
        };
      }

      const groups = store.listGroups(createdBy as 'ai' | 'user' | undefined);

      return {
        success: true,
        data: {
          groups: groups.map((g: BookmarkGroup) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            query: g.query,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
            createdBy: g.createdBy,
            bookmarkCount: g.bookmarks.length
          })),
          total: groups.length,
          projectRoot: projectRoot || this.workspaceManager.getDefaultWorkspace()
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
  listBookmarks(args: WithProjectRoot<ListBookmarksArgs>): ToolResult {
    try {
      const { groupId, parentId, includeDescendants, filePath, category, projectRoot } = args;
      const store = this.getStore(projectRoot);

      const validCategories: BookmarkCategory[] = [
        'entry-point', 'core-logic', 'issue', 'note'
      ];
      if (category && !validCategories.includes(category)) {
        return {
          success: false,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        };
      }

      const results = store.listBookmarks({
        groupId,
        parentId,
        includeDescendants,
        filePath,
        category
      });

      return {
        success: true,
        data: {
          bookmarks: results.map((r: { bookmark: Bookmark; group: BookmarkGroup }) => ({
            id: r.bookmark.id,
            parentId: r.bookmark.parentId || null,
            order: r.bookmark.order,
            location: r.bookmark.location,
            title: r.bookmark.title,
            description: r.bookmark.description,
            category: r.bookmark.category,
            groupId: r.group.id,
            groupName: r.group.name,
            hasChildren: store.hasChildren(r.bookmark.id)
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
  updateGroup(args: WithProjectRoot<UpdateGroupArgs>): ToolResult {
    try {
      const { groupId, name, description, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      if (name === undefined && description === undefined) {
        return { success: false, error: 'At least one of name or description must be provided' };
      }

      const success = store.updateGroup(groupId, { name, description });

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
  updateBookmark(args: WithProjectRoot<UpdateBookmarkArgs>): ToolResult {
    try {
      const { bookmarkId, parentId, location, title, description, order, category, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      if (parentId === undefined && location === undefined && title === undefined &&
          description === undefined && order === undefined && category === undefined) {
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

      const result = store.updateBookmark(bookmarkId, {
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
  removeBookmark(args: WithProjectRoot<RemoveBookmarkArgs>): ToolResult {
    try {
      const { bookmarkId, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const success = store.removeBookmark(bookmarkId);

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
  removeGroup(args: WithProjectRoot<RemoveGroupArgs>): ToolResult {
    try {
      const { groupId, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      const group = store.getGroup(groupId);
      if (!group) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      const bookmarkCount = group.bookmarks.length;
      const success = store.removeGroup(groupId);

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

  // get_group
  getGroup(args: WithProjectRoot<GetGroupArgs>): ToolResult {
    try {
      const { groupId, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      const group = store.getGroup(groupId);
      if (!group) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      const bookmarkTrees = store.getGroupBookmarkTrees(groupId);

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
            bookmarks: group.bookmarks.map((b: Bookmark) => ({
              id: b.id,
              parentId: b.parentId || null,
              order: b.order,
              location: b.location,
              title: b.title,
              description: b.description,
              category: b.category,
              hasChildren: store.hasChildren(b.id)
            })),
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

  // get_bookmark
  getBookmark(args: WithProjectRoot<GetBookmarkArgs>): ToolResult {
    try {
      const { bookmarkId, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const result = store.getBookmark(bookmarkId);
      if (!result) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      const { bookmark, group } = result;
      const childCount = store.getChildBookmarks(bookmarkId).length;

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

  // get_bookmark_tree
  getBookmarkTree(args: WithProjectRoot<GetBookmarkTreeArgs>): ToolResult {
    try {
      const { bookmarkId, maxDepth, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!bookmarkId || typeof bookmarkId !== 'string') {
        return { success: false, error: 'bookmarkId is required and must be a string' };
      }

      const tree = store.getBookmarkTree(bookmarkId, maxDepth);
      if (!tree) {
        return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
      }

      const result = store.getBookmark(bookmarkId);

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

  // batch_add_bookmarks
  batchAddBookmarks(args: WithProjectRoot<BatchAddBookmarksArgs>): ToolResult {
    try {
      const { groupId, parentId, bookmarks, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (!groupId || typeof groupId !== 'string') {
        return { success: false, error: 'groupId is required and must be a string' };
      }

      if (!bookmarks || !Array.isArray(bookmarks) || bookmarks.length === 0) {
        return { success: false, error: 'bookmarks array is required and must not be empty' };
      }

      const group = store.getGroup(groupId);
      if (!group) {
        return { success: false, error: `Group with id "${groupId}" not found` };
      }

      if (parentId) {
        const parentBookmark = group.bookmarks.find((b: Bookmark) => b.id === parentId);
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

        const bookmarkId = store.addBookmark(groupId, b.location, b.title, b.description, {
          parentId,
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

  // batch_remove_bookmarks
  batchRemoveBookmarks(args: WithProjectRoot<BatchRemoveBookmarksArgs>): ToolResult {
    try {
      const { bookmarkIds, projectRoot } = args;
      const store = this.getStore(projectRoot);

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

        const removed = store.removeBookmark(bookmarkId);
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

  // clear_all_bookmarks
  clearAllBookmarks(args: WithProjectRoot<ClearAllBookmarksArgs>): ToolResult {
    try {
      const { confirm, projectRoot } = args;
      const store = this.getStore(projectRoot);

      if (confirm !== true) {
        return {
          success: false,
          error: 'This operation will remove ALL bookmarks and groups. Set confirm=true to proceed.'
        };
      }

      const { groupsRemoved, bookmarksRemoved } = store.clearAll();

      return {
        success: true,
        data: {
          message: `Successfully cleared all bookmarks`,
          groupsRemoved,
          bookmarksRemoved,
          projectRoot: projectRoot || this.workspaceManager.getDefaultWorkspace()
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
