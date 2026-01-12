// Bookmark category types (精简为4个)
export type BookmarkCategory =
  | 'entry-point'    // 入口点
  | 'core-logic'     // 核心逻辑
  | 'issue'          // 问题/待办 (合并 todo, bug, warning)
  | 'note';          // 备注/说明 (合并 explanation, reference, optimization)

// Single bookmark
export interface Bookmark {
  id: string;                    // UUID
  parentId?: string;             // 父书签ID, undefined表示顶层书签
  order: number;                 // 同级排序 (1, 2, 3...)
  location: string;              // 位置，格式: path/to/file:line 或 path/to/file:start-end

  // AI 生成的内容
  title: string;                 // 简短标题
  description: string;           // 详细说明
  category?: BookmarkCategory;   // 分类

  // 漂移检测(可选)
  codeSnapshot?: string;         // 创建时的代码快照

  // UI状态
  collapsed?: boolean;           // 折叠状态
}

// 带子书签的书签(用于树形渲染)
export interface BookmarkWithChildren extends Bookmark {
  children: BookmarkWithChildren[];
}

// Bookmark group
export interface BookmarkGroup {
  id: string;                    // UUID
  title: string;                 // 分组标题，如 "Crash 游戏核心流程"
  description?: string;          // 分组说明
  query?: string;                // 创建时的查询/上下文
  createdAt: string;             // ISO timestamp
  updatedAt: string;
  createdBy: 'ai' | 'user';
  bookmarks: Bookmark[];         // 有序的书签列表
}

// Complete store structure
export interface BookmarkStore {
  version: number;
  projectName: string;
  groups: BookmarkGroup[];       // 所有分组
}

// Parsed location
export interface ParsedLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  isRange: boolean;
}

// MCP tool arguments
export interface CreateGroupArgs {
  title: string;
  description?: string;
  name?: string; // Deprecated: legacy clients may still send name.
}

export interface AddBookmarkArgs {
  groupId: string;
  parentId?: string;             // 父书签ID, 不填则为顶层书签
  location: string;
  title: string;
  description: string;
  order?: number;
  category?: BookmarkCategory;
}

export interface AddChildBookmarkArgs {
  parentBookmarkId: string;      // 父书签ID
  location: string;
  title: string;
  description: string;
  order?: number;
  category?: BookmarkCategory;
}

export interface ListGroupsArgs {
  createdBy?: 'ai' | 'user';
}

export interface ListBookmarksArgs {
  groupId?: string;
  parentId?: string;             // 只列出指定父书签的子书签
  includeDescendants?: boolean;  // 是否包含所有后代
  filePath?: string;
  category?: BookmarkCategory;
}

export interface GetBookmarkTreeArgs {
  bookmarkId: string;
  maxDepth?: number;             // 最大深度, 默认无限
}

export interface UpdateGroupArgs {
  groupId: string;
  title?: string;
  description?: string;
  name?: string; // Deprecated: legacy clients may still send name.
}

export interface UpdateBookmarkArgs {
  bookmarkId: string;
  parentId?: string | null;      // 父书签ID, null表示移到顶层
  location?: string;
  title?: string;
  description?: string;
  order?: number;
  category?: BookmarkCategory;
}

// updateBookmark 返回类型
export type UpdateBookmarkResult = true | 'not_found' | 'circular_reference' | 'parent_not_found';

export interface RemoveBookmarkArgs {
  bookmarkId: string;
}

export interface RemoveGroupArgs {
  groupId: string;
}

export interface GetGroupArgs {
  groupId: string;
}

export interface GetBookmarkArgs {
  bookmarkId: string;
}

export interface BatchAddBookmarksArgs {
  groupId: string;
  parentId?: string;             // 父书签ID, 不填则为顶层书签
  bookmarks: Array<{
    location: string;
    title: string;
    description: string;
    order?: number;
    category?: BookmarkCategory;
  }>;
}

export interface ClearAllBookmarksArgs {
  confirm?: boolean;  // 确认清除, 防止误操作
}

export interface BatchRemoveBookmarksArgs {
  bookmarkIds: string[];  // 要删除的书签ID列表
}

// Default store factory
export function createDefaultStore(projectName: string): BookmarkStore {
  return {
    version: 1,
    projectName,
    groups: []
  };
}
