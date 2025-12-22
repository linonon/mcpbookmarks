import * as vscode from 'vscode';

// 字体配置接口
export interface FontSizeConfig {
  title: number;
  description: number;
  groupName: number;
  location: number;
  scale: number;
}

// 层级颜色配置接口
export interface HierarchyColorConfig {
  depth0: string;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  depth5: string;
  depth6: string;
  depth7: string;
  [key: string]: string;
}

// 配置管理器
export class ConfigManager {
  private static readonly SECTION = 'mcpBookmarks';

  /**
   * 读取层级颜色配置
   */
  static getHierarchyColorConfig(): HierarchyColorConfig {
    const config = vscode.workspace.getConfiguration(this.SECTION);
    return {
      depth0: config.get<string>('hierarchyColors.depth0', '#3b82f6'),
      depth1: config.get<string>('hierarchyColors.depth1', '#8b5cf6'),
      depth2: config.get<string>('hierarchyColors.depth2', '#06b6d4'),
      depth3: config.get<string>('hierarchyColors.depth3', '#22c55e'),
      depth4: config.get<string>('hierarchyColors.depth4', '#eab308'),
      depth5: config.get<string>('hierarchyColors.depth5', '#fb923c'),
      depth6: config.get<string>('hierarchyColors.depth6', '#ef4444'),
      depth7: config.get<string>('hierarchyColors.depth7', '#ec4899'),
    };
  }

  /**
   * 读取字体配置
   *
   * 配置优先级逻辑:
   * 1. 如果 scale != 1.0, 使用缩放后的默认值
   * 2. 如果 scale == 1.0, 使用独立配置的值
   */
  static getFontSizeConfig(): FontSizeConfig {
    const config = vscode.workspace.getConfiguration(this.SECTION);
    const scale = config.get<number>('fontSize.scale', 1.0);

    // 如果 scale 不为 1.0, 使用缩放后的默认值
    if (scale !== 1.0) {
      return {
        title: 13 * scale,
        description: 11 * scale,
        groupName: 14 * scale,
        location: 10 * scale,
        scale
      };
    }

    // 否则使用独立配置的值
    return {
      title: config.get<number>('fontSize.title', 13),
      description: config.get<number>('fontSize.description', 11),
      groupName: config.get<number>('fontSize.groupName', 14),
      location: config.get<number>('fontSize.location', 10),
      scale: 1.0
    };
  }

  /**
   * 监听字体或颜色配置变化
   *
   * @param callback 配置变化时的回调函数
   * @returns Disposable 对象, 用于取消监听
   */
  static onConfigChanged(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration(`${this.SECTION}.fontSize`) ||
        e.affectsConfiguration(`${this.SECTION}.hierarchyColors`)
      ) {
        callback();
      }
    });
  }

  /**
   * 获取单个配置项的值
   *
   * @param key 配置项键名
   * @param defaultValue 默认值
   * @returns 配置值
   */
  static get<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(this.SECTION).get<T>(key, defaultValue);
  }

  /**
   * 设置配置项的值
   *
   * @param key 配置项键名
   * @param value 配置值
   * @param target 配置目标 (Global, Workspace, WorkspaceFolder)
   */
  static async set<T>(key: string, value: T, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
    await vscode.workspace.getConfiguration(this.SECTION).update(key, value, target);
  }
}
