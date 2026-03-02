import { BookmarkStoreBase } from '../store/bookmarkStoreBase';
import {
  BookmarkCategory,
  BookmarkWithChildren
} from '../store/types';

// --- 公共类型 ---

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export const VALID_CATEGORIES: BookmarkCategory[] = [
  'entry-point', 'core-logic', 'issue', 'note'
];

// --- 辅助函数 ---

function validateRequired(value: unknown, name: string): string | null {
  if (!value || typeof value !== 'string') {
    return `${name} is required and must be a string`;
  }
  return null;
}

function validateCategory(category: BookmarkCategory | undefined): string | null {
  if (category && !VALID_CATEGORIES.includes(category)) {
    return `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`;
  }
  return null;
}

/** 将 BookmarkWithChildren 转换为响应格式 (包含 collapsed 字段) */
function formatTree(node: BookmarkWithChildren): object {
  return {
    id: node.id,
    parentId: node.parentId || null,
    order: node.order,
    location: node.location,
    title: node.title,
    description: node.description,
    category: node.category,
    collapsed: node.collapsed,
    children: node.children.map(formatTree)
  };
}

/** 将 BookmarkWithChildren 转换为带 depth 的响应格式 */
function formatTreeWithDepth(node: BookmarkWithChildren, depth: number = 0): object {
  return {
    id: node.id,
    parentId: node.parentId || null,
    order: node.order,
    location: node.location,
    title: node.title,
    description: node.description,
    category: node.category,
    collapsed: node.collapsed,
    depth,
    children: node.children.map(child => formatTreeWithDepth(child, depth + 1))
  };
}

/** 递归计算树中节点总数 */
function countNodes(node: BookmarkWithChildren): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

// --- Handler 函数 ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleCreateGroup(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { title, description, name } = args;
    const groupTitle = title ?? name;

    const err = validateRequired(groupTitle, 'title');
    if (err) {
      return { success: false, error: err };
    }

    const groupId = store.createGroup(groupTitle, description, 'ai');

    return {
      success: true,
      data: {
        groupId,
        message: `Successfully created group "${groupTitle}"`
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to create group: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleAddBookmark(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { groupId, parentId, location, title, description, order, category } = args;

    for (const [val, name] of [[groupId, 'groupId'], [location, 'location'], [title, 'title'], [description, 'description']] as const) {
      const err = validateRequired(val, name);
      if (err) {
        return { success: false, error: err };
      }
    }

    const catErr = validateCategory(category);
    if (catErr) {
      return { success: false, error: catErr };
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
    return { success: false, error: `Failed to add bookmark: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleAddChildBookmark(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { parentBookmarkId, location, title, description, order, category } = args;

    for (const [val, name] of [[parentBookmarkId, 'parentBookmarkId'], [location, 'location'], [title, 'title'], [description, 'description']] as const) {
      const err = validateRequired(val, name);
      if (err) {
        return { success: false, error: err };
      }
    }

    const catErr = validateCategory(category);
    if (catErr) {
      return { success: false, error: catErr };
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
        message: `Successfully added child bookmark "${title}" under parent`
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to add child bookmark: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleListGroups(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { createdBy } = args;

    if (createdBy && !['ai', 'user'].includes(createdBy)) {
      return { success: false, error: 'createdBy must be either "ai" or "user"' };
    }

    const groups = store.listGroups(createdBy as 'ai' | 'user' | undefined);

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
    return { success: false, error: `Failed to list groups: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleListBookmarks(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { groupId, parentId, includeDescendants, filePath, category } = args;

    const catErr = validateCategory(category);
    if (catErr) {
      return { success: false, error: catErr };
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
        bookmarks: results.map(r => ({
          id: r.bookmark.id,
          parentId: r.bookmark.parentId || null,
          order: r.bookmark.order,
          location: r.bookmark.location,
          title: r.bookmark.title,
          description: r.bookmark.description,
          category: r.bookmark.category,
          collapsed: r.bookmark.collapsed,
          hasChildren: store.hasChildren(r.bookmark.id),
          groupId: r.group.id,
          groupTitle: r.group.title
        })),
        total: results.length
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to list bookmarks: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleUpdateGroup(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { groupId, title, description, name } = args;
    const groupTitle = title ?? name;

    const err = validateRequired(groupId, 'groupId');
    if (err) {
      return { success: false, error: err };
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

    const success = store.updateGroup(groupId, updates);
    if (!success) {
      return { success: false, error: `Group with id "${groupId}" not found` };
    }

    return {
      success: true,
      data: { message: `Successfully updated group "${groupId}"` }
    };
  } catch (error) {
    return { success: false, error: `Failed to update group: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleUpdateBookmark(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { bookmarkId, parentId, location, title, description, order, category } = args;

    const err = validateRequired(bookmarkId, 'bookmarkId');
    if (err) {
      return { success: false, error: err };
    }

    if (location === undefined && title === undefined && description === undefined &&
        order === undefined && category === undefined && parentId === undefined) {
      return { success: false, error: 'At least one update field must be provided' };
    }

    const catErr = validateCategory(category);
    if (catErr) {
      return { success: false, error: catErr };
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
      return { success: false, error: 'Cannot move bookmark: would create circular reference' };
    }
    if (result === 'parent_not_found') {
      return { success: false, error: `Parent bookmark with id "${parentId}" not found in the same group` };
    }

    return {
      success: true,
      data: { message: `Successfully updated bookmark "${bookmarkId}"` }
    };
  } catch (error) {
    return { success: false, error: `Failed to update bookmark: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleRemoveBookmark(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { bookmarkId } = args;

    const err = validateRequired(bookmarkId, 'bookmarkId');
    if (err) {
      return { success: false, error: err };
    }

    const result = store.removeBookmark(bookmarkId);

    // FIX: removeBookmark 返回 { success: boolean; removedCount: number },
    // 必须检查 result.success 而不是直接对 result 做 truthy 判断 (对象永远为 truthy)
    if (!result.success) {
      return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
    }

    const message = result.removedCount > 1
      ? `Successfully removed bookmark "${bookmarkId}" and ${result.removedCount - 1} child bookmark(s)`
      : `Successfully removed bookmark "${bookmarkId}"`;

    return {
      success: true,
      data: { message, removedCount: result.removedCount }
    };
  } catch (error) {
    return { success: false, error: `Failed to remove bookmark: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleRemoveGroup(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { groupId } = args;

    const err = validateRequired(groupId, 'groupId');
    if (err) {
      return { success: false, error: err };
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
        message: `Successfully removed group "${group.title}" with ${bookmarkCount} bookmark(s)`
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to remove group: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleGetGroup(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { groupId } = args;

    const err = validateRequired(groupId, 'groupId');
    if (err) {
      return { success: false, error: err };
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
          title: group.title,
          description: group.description,
          query: group.query,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
          createdBy: group.createdBy,
          // 扁平列表 (向后兼容)
          bookmarks: group.bookmarks.map(b => ({
            id: b.id,
            parentId: b.parentId || null,
            order: b.order,
            location: b.location,
            title: b.title,
            description: b.description,
            category: b.category,
            collapsed: b.collapsed,
            hasChildren: store.hasChildren(b.id)
          })),
          // 树形结构
          bookmarkTrees: bookmarkTrees.map(formatTree)
        }
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to get group: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleGetBookmark(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { bookmarkId } = args;

    const err = validateRequired(bookmarkId, 'bookmarkId');
    if (err) {
      return { success: false, error: err };
    }

    const result = store.getBookmark(bookmarkId);
    if (!result) {
      return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
    }

    const { bookmark, group } = result;
    const children = store.getChildBookmarks(bookmarkId);

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
    return { success: false, error: `Failed to get bookmark: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleGetBookmarkTree(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { bookmarkId, maxDepth } = args;

    const err = validateRequired(bookmarkId, 'bookmarkId');
    if (err) {
      return { success: false, error: err };
    }

    const tree = store.getBookmarkTree(bookmarkId, maxDepth);
    if (!tree) {
      return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
    }

    const bookmarkResult = store.getBookmark(bookmarkId);
    if (!bookmarkResult) {
      return { success: false, error: `Bookmark with id "${bookmarkId}" not found` };
    }

    return {
      success: true,
      data: {
        tree: formatTreeWithDepth(tree),
        group: {
          id: bookmarkResult.group.id,
          title: bookmarkResult.group.title
        },
        totalNodes: countNodes(tree)
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to get bookmark tree: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleBatchAddBookmarks(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { groupId, parentId, bookmarks } = args;

    const err = validateRequired(groupId, 'groupId');
    if (err) {
      return { success: false, error: err };
    }

    if (!bookmarks || !Array.isArray(bookmarks) || bookmarks.length === 0) {
      return { success: false, error: 'bookmarks array is required and must not be empty' };
    }

    const group = store.getGroup(groupId);
    if (!group) {
      return { success: false, error: `Group with id "${groupId}" not found` };
    }

    // 验证 parent 存在
    if (parentId) {
      const parent = group.bookmarks.find(b => b.id === parentId);
      if (!parent) {
        return { success: false, error: `Parent bookmark with id "${parentId}" not found in group` };
      }
    }

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
      if (b.category && !VALID_CATEGORIES.includes(b.category)) {
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
    return { success: false, error: `Failed to batch add bookmarks: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleBatchRemoveBookmarks(store: BookmarkStoreBase, args: any): ToolResult {
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

      // FIX: removeBookmark 返回 { success: boolean; removedCount: number },
      // 必须检查 result.success 而不是直接对 result 做 truthy 判断
      const result = store.removeBookmark(bookmarkId);
      if (result.success) {
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
    return { success: false, error: `Failed to batch remove bookmarks: ${error}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleClearAllBookmarks(store: BookmarkStoreBase, args: any): ToolResult {
  try {
    const { confirm } = args;

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
        message: 'Successfully cleared all bookmarks',
        groupsRemoved,
        bookmarksRemoved
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to clear all bookmarks: ${error}` };
  }
}

// --- Dispatch map ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HANDLER_MAP: Record<string, (store: BookmarkStoreBase, args: any) => ToolResult> = {
  'create_group': handleCreateGroup,
  'add_bookmark': handleAddBookmark,
  'add_child_bookmark': handleAddChildBookmark,
  'list_groups': handleListGroups,
  'list_bookmarks': handleListBookmarks,
  'update_group': handleUpdateGroup,
  'update_bookmark': handleUpdateBookmark,
  'remove_bookmark': handleRemoveBookmark,
  'remove_group': handleRemoveGroup,
  'get_group': handleGetGroup,
  'get_bookmark': handleGetBookmark,
  'get_bookmark_tree': handleGetBookmarkTree,
  'batch_add_bookmarks': handleBatchAddBookmarks,
  'batch_remove_bookmarks': handleBatchRemoveBookmarks,
  'clear_all_bookmarks': handleClearAllBookmarks,
};
