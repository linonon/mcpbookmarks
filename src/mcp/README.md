# MCP Bookmarks MCP Server

本目录包含 MCP Bookmarks 的 MCP Server 实现。

## 双版本架构

| 版本 | 用途 | 文件 |
|------|------|------|
| **Embedded** | VSCode 扩展内嵌运行 | `server.ts`, `handlers.ts` |
| **Standalone** | Claude Code 独立运行 (npx) | `serverStandalone.ts`, `handlersStandalone.ts` |

### 为什么有两个版本?

- **Embedded**: 在 VSCode 进程内运行, 可以直接访问 VSCode API (如 `vscode.workspace`)
- **Standalone**: 通过 `npx` 独立运行, 不依赖 VSCode, Claude Code 使用这个版本

### 修改功能时的注意事项

**任何 MCP 工具的修改都需要同时修改两套文件!**

## 重要: Serena MCP 行号偏移问题

在使用 Serena MCP 获取代码符号位置时, 需要注意:

**Serena 返回的是 0-indexed 行号 (LSP 标准), 而书签系统使用 1-indexed 行号 (人类可读)**

```
书签行号 = Serena 返回的行号 + 1
```

### 示例

如果 Serena 的 `find_symbol` 返回某个类在第 505 行:
- Serena 返回: `line: 505` (0-indexed)
- 实际文件位置: 第 506 行 (1-indexed)
- 书签应设置为: `file.ts:506`

### 原因

这是 LSP (Language Server Protocol) 标准的设计, 所有基于 LSP 的工具都使用 0-indexed 行号。在创建书签时需要进行转换。

## 工具列表

### Embedded 版本 (13 个工具)
- create_group, add_bookmark, list_groups, list_bookmarks
- update_group, update_bookmark, remove_bookmark, remove_group
- get_group, get_bookmark, add_child_bookmark, get_bookmark_tree
- batch_add_bookmarks

### Standalone 版本 (15 个工具)
在 Embedded 基础上增加:
- set_workspace: 设置当前工作区路径
- get_workspace: 获取当前工作区信息
