import * as fs from 'fs';
import * as path from 'path';
import { BookmarkStoreBase } from './bookmarkStoreBase';
import { BookmarkStore, createDefaultStore } from './types';
import { stringifyWithUnicode } from '../utils';

const STORE_FILE_NAME = 'mcp-bookmarks.json';
const STORE_DIR = '.vscode';

/**
 * Standalone 版 BookmarkStoreManager.
 * 继承 BookmarkStoreBase 获取所有 CRUD 逻辑,
 * 只实现 I/O 和通知, 不依赖 VSCode API.
 */
export class BookmarkStoreManagerStandalone extends BookmarkStoreBase {
  private storePath: string;
  private changeCallbacks: Array<() => void> = [];

  constructor(workspaceRoot: string) {
    super(workspaceRoot);
    this.storePath = path.join(workspaceRoot, STORE_DIR, STORE_FILE_NAME);
  }

  // --- 抽象方法实现 ---

  protected loadFromDisk(): BookmarkStore {
    // storePath 可能还没被 constructor 赋值 (super() 调用时), 需要现场计算
    const storePath = path.join(this.workspaceRoot, STORE_DIR, STORE_FILE_NAME);

    try {
      if (fs.existsSync(storePath)) {
        const content = fs.readFileSync(storePath, 'utf-8');
        const parsed = JSON.parse(content) as BookmarkStore;
        const { store, migrated } = this.migrateStore(parsed);
        if (migrated) {
          this.writeStoreToFile(store, storePath);
        }
        return store;
      }
    } catch (error) {
      console.error('Failed to load bookmark store:', error);
    }

    return createDefaultStore(path.basename(this.workspaceRoot));
  }

  protected saveToDisk(): void {
    try {
      const storePath = this.storePath ?? path.join(this.workspaceRoot, STORE_DIR, STORE_FILE_NAME);
      this.writeStoreToFile(this.store, storePath);
    } catch (error) {
      console.error('Failed to save bookmark store:', error);
    }
  }

  protected notifyChange(): void {
    for (const cb of this.changeCallbacks) {
      cb();
    }
  }

  // --- 事件订阅 ---

  onDidChange(callback: () => void): void {
    this.changeCallbacks.push(callback);
  }

  // --- 私有工具方法 ---

  private writeStoreToFile(store: BookmarkStore, storePath: string): void {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, stringifyWithUnicode(store, 2), 'utf-8');
  }

  // --- 清理 ---

  dispose(): void {
    this.changeCallbacks = [];
  }
}
