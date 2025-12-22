import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { MCPHandlers } from './handlers';

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'create_group',
    description: 'Create a new bookmark group. Groups are used to organize bookmarks by topic or query.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Group name, e.g., "Crash game core flow"'
        },
        description: {
          type: 'string',
          description: 'Group description'
        },
        query: {
          type: 'string',
          description: 'The user query that triggered this group creation (for AI-generated groups)'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'add_bookmark',
    description: `Add a bookmark to a group. Bookmarks mark important code locations with explanations. Supports hierarchical bookmarks via parentId.

**NEW: Markdown links in descriptions!**
- Link to files: [config](src/config.ts)
- Link to specific lines: [handler](src/handler.ts:45)
- Create cross-references between code locations

**CRITICAL - NEVER GUESS LINE NUMBERS!**
- You MUST use Grep tool to search and confirm the EXACT line number before adding a bookmark
- NEVER estimate or guess line numbers - always search with Grep first
- NEVER use file:1 - the first line is almost always an import statement, not meaningful code
- Example: \`Grep pattern="function handleRequest" path="src/handler.ts"\` to find exact line
- Guessing line numbers makes bookmarks useless - they will point to wrong code
- **LSP/Serena returns 0-indexed line numbers!** If using Serena MCP, add 1: bookmark_line = serena_line + 1

**CRITICAL - Location Guidelines (CALL SITE vs DEFINITION):**
- For call chain/flow analysis: Mark the CALL SITE (where function is called), NOT the function definition
- This creates a clear traceable path through the code

**WRONG - Marking function definitions (no clear flow):**
\`\`\`
1. main.go:10      (main definition)
2. handler.go:50   (handleRequest definition)
3. validator.go:20 (validate definition)
\`\`\`

**CORRECT - Marking call sites (clear execution flow):**
\`\`\`
1. main.go:15         (where main calls handleRequest)
  1.1 handler.go:55   (where handleRequest calls validate)
  1.2 handler.go:60   (where handleRequest calls process)
\`\`\`

**IMPORTANT - Title Guidelines (DESCRIBE THE ACTION, NOT THE FUNCTION NAME):**
- title: Describe WHAT THIS LINE DOES, not just the function name
- Function names alone are meaningless! Explain the PURPOSE/ACTION

**WRONG titles (just function names, meaningless):**
- "validateBet" ❌
- "processPayment" ❌
- "handleRequest" ❌

**CORRECT titles (describe what happens at this line):**
- "验证下注金额和用户余额" ✓
- "从用户钱包扣除下注金额" ✓
- "检查游戏状态是否允许下注" ✓

**Example bookmark:**
- location: handler.go:55
- title: "调用验证逻辑检查下注合法性"
- description: "在处理下注前先验证: 1) 用户余额是否足够 2) 下注金额是否在限额内 3) 游戏是否在下注阶段"

**HIERARCHY GUIDELINES - When to create child bookmarks (use parentId or add_child_bookmark):**
- Function A calls Function B → B should be CHILD of A, marked at the CALL LINE in A
- Entry point with multiple steps → steps are CHILDREN, each marked at call site
- Caller → Callee = Parent → Child, location = call site in parent

**DO NOT flatten call chains into siblings with order 1, 2, 3!**
WRONG: 1. handleRequest, 2. validateInput, 3. processData (all siblings)
CORRECT: 1. handleRequest (parent) → 1.1 validateInput (child at call site) → 1.2 processData (child at call site)`,
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'The ID of the group to add the bookmark to'
        },
        parentId: {
          type: 'string',
          description: 'Parent bookmark ID. If not specified, creates a top-level bookmark'
        },
        location: {
          type: 'string',
          description: `Location in format "path/to/file:line" or "path/to/file:start-end" for ranges

**PATH FORMAT - CRITICAL:**
- **Relative path** (recommended): Use path relative to the project root (e.g., "src/game/crash.go:45")
- **Absolute path**: Use absolute path if you are analyzing a different project (e.g., "/Users/name/project/src/main.go:100")
- The extension will try relative path first, then fall back to absolute path if the file is not found
- When using Serena MCP or analyzing files with absolute paths, use the absolute path in the location
- When analyzing the current project, use relative paths for better portability`
        },
        title: {
          type: 'string',
          description: 'Describe the ACTION/PURPOSE of this line (e.g., "验证用户余额"), NOT just function name!'
        },
        description: {
          type: 'string',
          description: `Explanation of what this code does.

**CROSS-REFERENCE TIP:**
When describing related code, use Markdown links for easy navigation:
- Same file: [other function](src/file.ts:100)
- Different file: [config setup](src/config/init.ts:25)
- Entry point: [see main flow](src/main.ts:15)

**DESCRIPTION FORMAT:**
- **First line**: Brief summary of what this line/block does (one sentence, plain text)
- **Following lines** (optional): If more details needed, add blank line then use Markdown for rich formatting

**Markdown features** (use ONLY after first line):
- Use **bold**, *italic*, \`code\`, ~~strikethrough~~ for emphasis
- **Use file links**: [text](path/to/file) or [text](path/to/file:123) for clickable navigation
- Use numbered lists (1. 2. 3.) or bullet lists (- item)
- Use code blocks with \`\`\`language\\n...\\n\`\`\` for multi-line code
- Use > for blockquotes and important notes

**Example description with cross-references:**
\`\`\`
验证用户下注是否合法, 包括余额、限额和游戏状态检查

检查细节:
1. **余额检查**: 用户钱包余额 >= 下注金额 (参见 [wallet.Balance](src/wallet/balance.go:78))
2. **限额检查**: 下注金额在 \`minBet\` - \`maxBet\` 范围内 (配置见 [game config](src/config/game.toml:12-15))
3. **状态检查**: 游戏当前状态为 \`BETTING_PHASE\` (状态机见 [state machine](src/game/state.go:45-120))

> 注意: 验证失败会抛出 \`InvalidBetError\` 异常, 错误处理见 [error handler](src/errors/handler.go:33)
\`\`\``
        },
        order: {
          type: 'number',
          description: 'Order within siblings (optional, appends to end if not specified)'
        },
        category: {
          type: 'string',
          enum: ['entry-point', 'core-logic', 'issue', 'note'],
          description: 'Bookmark category'
        }
      },
      required: ['groupId', 'location', 'title', 'description']
    }
  },
  {
    name: 'add_child_bookmark',
    description: `Add a child bookmark under an existing bookmark. Creates hierarchical structure.

**NEW: Markdown links in descriptions!**
- Link to files: [config](src/config.ts)
- Link to specific lines: [handler](src/handler.ts:45)
- Create cross-references between code locations

**CRITICAL - NEVER GUESS LINE NUMBERS!**
- You MUST use Grep tool to search and confirm the EXACT line number before adding a bookmark
- NEVER estimate or guess line numbers - always search with Grep first
- NEVER use file:1 - the first line is almost always an import statement, not meaningful code

**CRITICAL - Location = CALL SITE in parent function:**
- The location should be WHERE the child function is CALLED (inside the parent)
- NOT the definition of the child function

**Example - Correct call site marking:**
\`\`\`
Parent bookmark: "handleRequest" at handler.go:50 (function definition or entry call)
  Child: "validateInput" at handler.go:55  <- line where validateInput() is called
  Child: "processData" at handler.go:60    <- line where processData() is called
\`\`\`

**USE THIS TOOL when the new bookmark represents:**
- A function/method CALLED BY the parent bookmark's function (mark the call line)
- Implementation details of the parent concept
- A step that belongs under a parent flow

**Title Guidelines:** Same as add_bookmark - describe WHAT THIS LINE DOES, not just function name!`,
    inputSchema: {
      type: 'object',
      properties: {
        parentBookmarkId: {
          type: 'string',
          description: 'The ID of the parent bookmark'
        },
        location: {
          type: 'string',
          description: `Location in format "path/to/file:line" or "path/to/file:start-end" for ranges

**PATH FORMAT - CRITICAL:**
- **Relative path** (recommended): Use path relative to the project root (e.g., "src/game/crash.go:45")
- **Absolute path**: Use absolute path if you are analyzing a different project (e.g., "/Users/name/project/src/main.go:100")
- The extension will try relative path first, then fall back to absolute path if the file is not found
- When using Serena MCP or analyzing files with absolute paths, use the absolute path in the location
- When analyzing the current project, use relative paths for better portability`
        },
        title: {
          type: 'string',
          description: 'Describe the ACTION/PURPOSE of this line (e.g., "验证用户余额"), NOT just function name!'
        },
        description: {
          type: 'string',
          description: `Explanation of what this code does. DO NOT include title.

**CROSS-REFERENCE TIP:**
When describing related code, use Markdown links for easy navigation:
- Same file: [other function](src/file.ts:100)
- Different file: [config setup](src/config/init.ts:25)
- Entry point: [see main flow](src/main.ts:15)

**DESCRIPTION FORMAT:**
- **First line**: Brief summary of what this line/block does (one sentence, plain text)
- **Following lines** (optional): If more details needed, add blank line then use Markdown for rich formatting

**Markdown features** (use ONLY after first line):
- Use **bold**, *italic*, \`code\`, ~~strikethrough~~ for emphasis
- **Use file links**: [text](path/to/file) or [text](path/to/file:123) for clickable navigation
- Use numbered lists (1. 2. 3.) or bullet lists (- item)
- Use code blocks with \`\`\`language\\n...\\n\`\`\` for multi-line code
- Use > for blockquotes and important notes

**Example description with cross-references:**
\`\`\`
验证用户下注是否合法, 包括余额、限额和游戏状态检查

检查细节:
1. **余额检查**: 用户钱包余额 >= 下注金额 (参见 [wallet.Balance](src/wallet/balance.go:78))
2. **限额检查**: 下注金额在 \`minBet\` - \`maxBet\` 范围内 (配置见 [game config](src/config/game.toml:12-15))
3. **状态检查**: 游戏当前状态为 \`BETTING_PHASE\` (状态机见 [state machine](src/game/state.go:45-120))

> 注意: 验证失败会抛出 \`InvalidBetError\` 异常, 错误处理见 [error handler](src/errors/handler.go:33)
\`\`\``
        },
        order: {
          type: 'number',
          description: 'Order within siblings (optional, appends to end if not specified)'
        },
        category: {
          type: 'string',
          enum: ['entry-point', 'core-logic', 'issue', 'note'],
          description: 'Bookmark category'
        }
      },
      required: ['parentBookmarkId', 'location', 'title', 'description']
    }
  },
  {
    name: 'list_groups',
    description: 'List all bookmark groups with their metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        createdBy: {
          type: 'string',
          enum: ['ai', 'user'],
          description: 'Filter by creator type'
        }
      }
    }
  },
  {
    name: 'list_bookmarks',
    description: 'List bookmarks with optional filters. Supports hierarchical filtering via parentId.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'Filter by group ID'
        },
        parentId: {
          type: 'string',
          description: 'Filter to only show children of the specified parent bookmark'
        },
        includeDescendants: {
          type: 'boolean',
          description: 'If true and parentId is specified, include all descendants (not just direct children)'
        },
        filePath: {
          type: 'string',
          description: 'Filter by file path (partial match)'
        },
        category: {
          type: 'string',
          enum: ['entry-point', 'core-logic', 'issue', 'note'],
          description: 'Filter by category'
        }
      }
    }
  },
  {
    name: 'update_group',
    description: 'Update a bookmark group\'s name or description.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'The ID of the group to update'
        },
        name: {
          type: 'string',
          description: 'New group name'
        },
        description: {
          type: 'string',
          description: 'New group description'
        }
      },
      required: ['groupId']
    }
  },
  {
    name: 'update_bookmark',
    description: `Update a bookmark's properties. Supports moving bookmark in hierarchy via parentId.

**NEW: Markdown links in descriptions!**
- Link to files: [config](src/config.ts)
- Link to specific lines: [handler](src/handler.ts:45)
- Create cross-references between code locations

**PREFER THIS OVER DELETE+RECREATE!**
- To fix a title: update_bookmark({ bookmarkId, title: "new title" })
- To fix description: update_bookmark({ bookmarkId, description: "new desc" })
- To move to different parent: update_bookmark({ bookmarkId, parentId: "newParentId" })
- To change location: update_bookmark({ bookmarkId, location: "file:line" })

All fields except bookmarkId are optional - only specify what you want to change.
Circular references are automatically prevented when moving in hierarchy.`,
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: {
          type: 'string',
          description: 'The ID of the bookmark to update'
        },
        parentId: {
          type: ['string', 'null'],
          description: 'New parent bookmark ID. Set to null to move to top level. Circular references are prevented.'
        },
        location: {
          type: 'string',
          description: 'New location'
        },
        title: {
          type: 'string',
          description: 'New title'
        },
        description: {
          type: 'string',
          description: `New description

**CROSS-REFERENCE TIP:**
When describing related code, use Markdown links for easy navigation:
- Same file: [other function](src/file.ts:100)
- Different file: [config setup](src/config/init.ts:25)
- Entry point: [see main flow](src/main.ts:15)

**DESCRIPTION FORMAT:**
- **First line**: Brief summary of what this line/block does (one sentence, plain text)
- **Following lines** (optional): If more details needed, add blank line then use Markdown for rich formatting

**Markdown features** (use ONLY after first line):
- Use **bold**, *italic*, \`code\`, ~~strikethrough~~ for emphasis
- **Use file links**: [text](path/to/file) or [text](path/to/file:123) for clickable navigation
- Use numbered lists (1. 2. 3.) or bullet lists (- item)
- Use code blocks with \`\`\`language\\n...\\n\`\`\` for multi-line code
- Use > for blockquotes and important notes

**Example description with cross-references:**
\`\`\`
验证用户下注是否合法, 包括余额、限额和游戏状态检查

检查细节:
1. **余额检查**: 用户钱包余额 >= 下注金额 (参见 [wallet.Balance](src/wallet/balance.go:78))
2. **限额检查**: 下注金额在 \`minBet\` - \`maxBet\` 范围内 (配置见 [game config](src/config/game.toml:12-15))
3. **状态检查**: 游戏当前状态为 \`BETTING_PHASE\` (状态机见 [state machine](src/game/state.go:45-120))

> 注意: 验证失败会抛出 \`InvalidBetError\` 异常, 错误处理见 [error handler](src/errors/handler.go:33)
\`\`\``
        },
        order: {
          type: 'number',
          description: 'New order within siblings'
        },
        category: {
          type: 'string',
          enum: ['entry-point', 'core-logic', 'issue', 'note'],
          description: 'New category'
        }
      },
      required: ['bookmarkId']
    }
  },
  {
    name: 'remove_bookmark',
    description: `Remove a bookmark by its ID. CASCADE DELETES all child bookmarks.

**STOP! Before removing, ask yourself:**
1. Can I UPDATE this bookmark instead? (update_bookmark)
2. Did I verify the bookmark content first? (get_bookmark)
3. Am I aware this will delete ALL child bookmarks?

Only remove a bookmark when it is truly no longer needed.
For bulk removal, use batch_remove_bookmarks.`,
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: {
          type: 'string',
          description: 'The ID of the bookmark to remove'
        }
      },
      required: ['bookmarkId']
    }
  },
  {
    name: 'get_group',
    description: 'Get a single bookmark group with all its bookmarks. Returns both flat list and tree structure.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'The ID of the group to retrieve'
        }
      },
      required: ['groupId']
    }
  },
  {
    name: 'get_bookmark',
    description: 'Get a single bookmark by its ID with its group info and child count.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: {
          type: 'string',
          description: 'The ID of the bookmark to retrieve'
        }
      },
      required: ['bookmarkId']
    }
  },
  {
    name: 'get_bookmark_tree',
    description: 'Get a bookmark and all its children as a tree structure.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: {
          type: 'string',
          description: 'The ID of the bookmark to get tree for'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse (optional, unlimited by default)'
        }
      },
      required: ['bookmarkId']
    }
  },
  {
    name: 'batch_add_bookmarks',
    description: `Add multiple bookmarks to a group in a single operation. More efficient than adding one by one.

**NEW: Markdown links in descriptions!**
- Link to files: [config](src/config.ts)
- Link to specific lines: [handler](src/handler.ts:45)
- Create cross-references between code locations

**CRITICAL - NEVER GUESS LINE NUMBERS!**
- You MUST use Grep tool to search and confirm EXACT line numbers before adding bookmarks
- NEVER estimate or guess line numbers - always search with Grep first
- NEVER use file:1 - the first line is almost always an import statement

**CRITICAL - This tool is for adding SIBLING bookmarks at the SAME LEVEL!**
- All bookmarks in one batch share the same parent (or all are top-level if no parentId)
- For HIERARCHICAL structures (parent-child relationships), you MUST:
  1. First create the parent bookmark with add_bookmark
  2. Then use batch_add_bookmarks with parentId to add children under that parent
  3. Repeat for deeper levels

**WRONG - Flattening a call chain into one batch (loses hierarchy):**
\`\`\`
batch_add_bookmarks([
  { title: "handleRequest" },      // Should be parent
  { title: "validateInput" },      // Should be child of handleRequest
  { title: "processData" }         // Should be child of handleRequest
])
// Result: All at same level, no hierarchy!
\`\`\`

**CORRECT - Building hierarchy step by step:**
\`\`\`
// Step 1: Create parent
add_bookmark({ title: "handleRequest", ... }) → returns parentId

// Step 2: Add children under parent
batch_add_bookmarks({
  parentId: parentId,
  bookmarks: [
    { title: "validateInput", location: "handler.go:55" },  // call site
    { title: "processData", location: "handler.go:60" }     // call site
  ]
})
// Result: Proper hierarchy with handleRequest as parent!
\`\`\`

**Location Guidelines:** Same as add_bookmark - mark CALL SITES, not function definitions!
**Title Guidelines:** Describe WHAT THIS LINE DOES, not just function name!`,
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'The ID of the group to add bookmarks to'
        },
        parentId: {
          type: 'string',
          description: 'Parent bookmark ID. All bookmarks in this batch will be added as children of this parent.'
        },
        bookmarks: {
          type: 'array',
          description: 'Array of bookmarks to add',
          items: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'Location in format "path/to/file:line" or "path/to/file:start-end"'
              },
              title: {
                type: 'string',
                description: 'Short title (5-30 chars). DO NOT repeat in description.'
              },
              description: {
                type: 'string',
                description: `Explanation of what this code does. DO NOT include title.

**CROSS-REFERENCE TIP:**
When describing related code, use Markdown links for easy navigation:
- Same file: [other function](src/file.ts:100)
- Different file: [config setup](src/config/init.ts:25)
- Entry point: [see main flow](src/main.ts:15)

**DESCRIPTION FORMAT:**
- **First line**: Brief summary of what this line/block does (one sentence, plain text)
- **Following lines** (optional): If more details needed, add blank line then use Markdown for rich formatting

**Markdown features** (use ONLY after first line):
- Use **bold**, *italic*, \`code\`, ~~strikethrough~~ for emphasis
- **Use file links**: [text](path/to/file) or [text](path/to/file:123) for clickable navigation
- Use numbered lists (1. 2. 3.) or bullet lists (- item)
- Use code blocks with \`\`\`language\\n...\\n\`\`\` for multi-line code
- Use > for blockquotes and important notes

**Example description with cross-references:**
\`\`\`
验证用户下注是否合法, 包括余额、限额和游戏状态检查

检查细节:
1. **余额检查**: 用户钱包余额 >= 下注金额 (参见 [wallet.Balance](src/wallet/balance.go:78))
2. **限额检查**: 下注金额在 \`minBet\` - \`maxBet\` 范围内 (配置见 [game config](src/config/game.toml:12-15))
3. **状态检查**: 游戏当前状态为 \`BETTING_PHASE\` (状态机见 [state machine](src/game/state.go:45-120))

> 注意: 验证失败会抛出 \`InvalidBetError\` 异常, 错误处理见 [error handler](src/errors/handler.go:33)
\`\`\``
              },
              order: {
                type: 'number',
                description: 'Order within siblings (optional)'
              },
              category: {
                type: 'string',
                enum: ['entry-point', 'core-logic', 'issue', 'note'],
                description: 'Bookmark category'
              }
            },
            required: ['location', 'title', 'description']
          }
        }
      },
      required: ['groupId', 'bookmarks']
    }
  },
  {
    name: 'batch_remove_bookmarks',
    description: `Remove multiple bookmarks by their IDs in a single operation.

**IMPORTANT - Before removing, consider:**
1. Can you UPDATE the bookmark instead? Use update_bookmark to modify content
2. Are you sure these bookmarks are no longer needed?
3. Child bookmarks will be CASCADE DELETED

This tool removes ONLY the specified bookmarks. To remove an entire group's bookmarks,
you must list all bookmarks in that group first and remove them individually.`,
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of bookmark IDs to remove. Each bookmark and its children will be deleted.'
        }
      },
      required: ['bookmarkIds']
    }
  }
];

export class MCPServer {
  private server: Server;
  private handlers: MCPHandlers;

  constructor(store: BookmarkStoreManager) {
    this.handlers = new MCPHandlers(store);
    this.server = new Server(
      {
        name: 'mcp-bookmarks',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      let result;
      switch (name) {
        case 'create_group':
          result = this.handlers.createGroup(args as unknown as Parameters<MCPHandlers['createGroup']>[0]);
          break;
        case 'add_bookmark':
          result = this.handlers.addBookmark(args as unknown as Parameters<MCPHandlers['addBookmark']>[0]);
          break;
        case 'add_child_bookmark':
          result = this.handlers.addChildBookmark(args as unknown as Parameters<MCPHandlers['addChildBookmark']>[0]);
          break;
        case 'list_groups':
          result = this.handlers.listGroups(args as unknown as Parameters<MCPHandlers['listGroups']>[0]);
          break;
        case 'list_bookmarks':
          result = this.handlers.listBookmarks(args as unknown as Parameters<MCPHandlers['listBookmarks']>[0]);
          break;
        case 'update_group':
          result = this.handlers.updateGroup(args as unknown as Parameters<MCPHandlers['updateGroup']>[0]);
          break;
        case 'update_bookmark':
          result = this.handlers.updateBookmark(args as unknown as Parameters<MCPHandlers['updateBookmark']>[0]);
          break;
        case 'remove_bookmark':
          result = this.handlers.removeBookmark(args as unknown as Parameters<MCPHandlers['removeBookmark']>[0]);
          break;
        case 'get_group':
          result = this.handlers.getGroup(args as unknown as Parameters<MCPHandlers['getGroup']>[0]);
          break;
        case 'get_bookmark':
          result = this.handlers.getBookmark(args as unknown as Parameters<MCPHandlers['getBookmark']>[0]);
          break;
        case 'get_bookmark_tree':
          result = this.handlers.getBookmarkTree(args as unknown as Parameters<MCPHandlers['getBookmarkTree']>[0]);
          break;
        case 'batch_add_bookmarks':
          result = this.handlers.batchAddBookmarks(args as unknown as Parameters<MCPHandlers['batchAddBookmarks']>[0]);
          break;
        case 'batch_remove_bookmarks':
          result = this.handlers.batchRemoveBookmarks(args as unknown as Parameters<MCPHandlers['batchRemoveBookmarks']>[0]);
          break;
        default:
          result = { success: false, error: `Unknown tool: ${name}` };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: !result.success
      };
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Bookmarks MCP server started');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
