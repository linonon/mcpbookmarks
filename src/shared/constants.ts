import { BookmarkCategory } from '../store/types';

// 书签分类定义, 用于 QuickPick 等 UI 组件
export const BOOKMARK_CATEGORIES: Array<{ label: BookmarkCategory; description: string }> = [
  { label: 'entry-point', description: 'Entry point to a feature or module' },
  { label: 'core-logic', description: 'Core business logic' },
  { label: 'issue', description: 'Problem, bug, or todo item' },
  { label: 'note', description: 'Explanation or reference' }
];
