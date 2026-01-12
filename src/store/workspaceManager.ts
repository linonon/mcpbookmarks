/**
 * WorkspaceManager - 管理多个工作区的 BookmarkStore
 *
 * 用于 standalone MCP server, 支持在工具调用时动态切换工作区
 */

import * as fs from 'fs';
import * as path from 'path';
import { BookmarkStoreManagerStandalone } from './bookmarkStoreStandalone';

export class WorkspaceManager {
  private stores: Map<string, BookmarkStoreManagerStandalone> = new Map();
  private defaultWorkspace: string;

  constructor(defaultWorkspace?: string) {
    // 默认使用环境变量或当前目录
    this.defaultWorkspace = defaultWorkspace || process.env.WORKSPACE_ROOT || process.cwd();
  }

  /**
   * 获取指定工作区的 store, 如果不存在则创建
   */
  getStore(projectRoot?: string): BookmarkStoreManagerStandalone {
    const workspace = this.resolveWorkspace(projectRoot);

    if (!this.stores.has(workspace)) {
      // 验证工作区存在
      if (!fs.existsSync(workspace)) {
        throw new Error(`Workspace does not exist: ${workspace}`);
      }

      // 创建新的 store
      const store = new BookmarkStoreManagerStandalone(workspace);
      this.stores.set(workspace, store);
    }

    return this.stores.get(workspace)!;
  }

  /**
   * 解析工作区路径
   */
  private resolveWorkspace(projectRoot?: string): string {
    if (!projectRoot) {
      return this.normalizePath(this.defaultWorkspace);
    }

    // 处理相对路径
    const resolved = path.isAbsolute(projectRoot)
      ? projectRoot
      : path.resolve(this.defaultWorkspace, projectRoot);

    return this.normalizePath(resolved);
  }

  /**
   * 标准化路径 (去除末尾斜杠, 统一分隔符)
   */
  private normalizePath(p: string): string {
    return path.normalize(p).replace(/[/\\]+$/, '');
  }

  /**
   * 获取默认工作区
   */
  getDefaultWorkspace(): string {
    return this.defaultWorkspace;
  }

  /**
   * 设置默认工作区
   */
  setDefaultWorkspace(workspace: string): void {
    this.defaultWorkspace = this.normalizePath(workspace);
  }

  /**
   * 列出所有活跃的工作区
   */
  listActiveWorkspaces(): string[] {
    return Array.from(this.stores.keys());
  }

  /**
   * 释放指定工作区的 store
   */
  disposeWorkspace(workspace: string): void {
    const normalized = this.normalizePath(workspace);
    const store = this.stores.get(normalized);
    if (store) {
      store.dispose();
      this.stores.delete(normalized);
    }
  }

  /**
   * 释放所有 store
   */
  dispose(): void {
    for (const store of this.stores.values()) {
      store.dispose();
    }
    this.stores.clear();
  }
}
