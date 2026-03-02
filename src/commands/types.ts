import { BookmarkStoreManager } from '../store/bookmarkStore';
import { BookmarkSidebarProvider } from '../providers/sidebarProvider';
import { DecorationProvider } from '../providers/decorationProvider';
import { BookmarkDetailProvider } from '../providers/webviewProvider';

export interface CommandDependencies {
  store: BookmarkStoreManager;
  sidebarProvider: BookmarkSidebarProvider;
  decorationProvider: DecorationProvider;
  detailProvider: BookmarkDetailProvider;
  workspaceRoot: string;
}
