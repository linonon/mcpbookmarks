import { Bookmark, BookmarkGroup } from '../store/types';

// 从 TreeView item 中提取 Bookmark, 失败返回 null
export function extractBookmark(item: unknown): Bookmark | null {
  const bookmarkItem = item as { type: string; bookmark?: Bookmark };
  if (bookmarkItem?.type === 'bookmark' && bookmarkItem.bookmark) {
    return bookmarkItem.bookmark;
  }
  return null;
}

// 从 TreeView item 中提取 Group, 失败返回 null
export function extractGroup(item: unknown): BookmarkGroup | null {
  const groupItem = item as { type: string; group?: BookmarkGroup };
  if (groupItem?.type === 'group' && groupItem.group) {
    return groupItem.group;
  }
  return null;
}
