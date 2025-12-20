import * as vscode from 'vscode';

// 字体配置接口
export interface FontSizeConfig {
  title: number;
  description: number;
  groupName: number;
  location: number;
  scale: number;
}

// 配置管理器
export class ConfigManager {
  private static readonly SECTION = 'aiBookmarks';

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
   * 监听字体配置变化
   *
   * @param callback 配置变化时的回调函数
   * @returns Disposable 对象, 用于取消监听
   */
  static onConfigChanged(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(`${this.SECTION}.fontSize`)) {
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
