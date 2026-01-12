import * as vscode from 'vscode';
import { BookmarkStoreManager } from '../store/bookmarkStore';
import { Bookmark, BookmarkGroup } from '../store/types';
import { parseLocation, normalizePath, getCategoryDisplayName } from '../utils';

export class BookmarkHoverProvider implements vscode.HoverProvider {
  constructor(
    private store: BookmarkStoreManager,
    private workspaceRoot: string
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const filePath = normalizePath(document.uri.fsPath, this.workspaceRoot);
    const line = position.line + 1; // Convert to 1-indexed

    // Get all bookmarks for this file
    const bookmarks = this.store.getBookmarksByFile(filePath);

    // Find bookmarks that include this line
    const matchingBookmarks: Array<{ bookmark: Bookmark; group: BookmarkGroup }> = [];

    for (const { bookmark, group } of bookmarks) {
      try {
        const parsed = parseLocation(bookmark.location);

        // Check if the cursor line is within the bookmark's range
        if (line >= parsed.startLine && line <= parsed.endLine) {
          matchingBookmarks.push({ bookmark, group });
        }
      } catch (error) {
        console.error(`Failed to parse bookmark location: ${bookmark.location}`, error);
      }
    }

    if (matchingBookmarks.length === 0) {
      return null;
    }

    // Create hover content
    const hoverContent = this.createHoverContent(matchingBookmarks);

    return new vscode.Hover(hoverContent);
  }

  private createHoverContent(
    bookmarks: Array<{ bookmark: Bookmark; group: BookmarkGroup }>
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    // Simple header
    md.appendMarkdown(`#### MCP Bookmarks\n\n`);

    for (let i = 0; i < bookmarks.length; i++) {
      const { bookmark, group } = bookmarks[i];

      if (i > 0) {
        md.appendMarkdown(`\n---\n\n`);
      }

      // Title line: order + title
      md.appendMarkdown(`**${bookmark.order}. ${bookmark.title}**\n\n`);

      // Group as subtle info
      md.appendMarkdown(`*Group: ${group.title}*\n\n`);

      // Description with clickable links
      if (bookmark.description) {
        const enrichedDescription = this.enrichMarkdownLinks(bookmark.description);
        md.appendMarkdown(`${enrichedDescription}\n\n`);
      }

      // Metadata on separate lines for clarity
      if (bookmark.category) {
        md.appendMarkdown(`**Category:** ${getCategoryDisplayName(bookmark.category)}\n\n`);
      }

    }

    return md;
  }

  /**
   * Convert markdown links [name](path) or [name](path:line) to VSCode command links
   */
  private enrichMarkdownLinks(text: string): string {
    // Match [text](path) or [text](path:line) or [text](path:line-endLine)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    
    return text.replace(linkRegex, (match, linkText, linkTarget) => {
      try {
        // Parse the link target
        let filePath: string;
        let line: number | undefined;
        
        // Check if it contains line number: path:line or path:line-endLine
        const colonIndex = linkTarget.lastIndexOf(':');
        if (colonIndex > 0) {
          filePath = linkTarget.substring(0, colonIndex);
          const linePartRaw = linkTarget.substring(colonIndex + 1);
          // Extract first number (ignore range for now)
          const lineMatch = linePartRaw.match(/^(\d+)/);
          if (lineMatch) {
            line = parseInt(lineMatch[1], 10);
          }
        } else {
          filePath = linkTarget;
        }

        // Create VSCode command link
        // VSCode expects arguments as a JSON array
        const args = encodeURIComponent(JSON.stringify([{ path: filePath, line }]));
        const commandUri = `command:mcpBookmarks.openFile?${args}`;
        
        return `[${linkText}](${commandUri})`;
      } catch (error) {
        // If parsing fails, return original link
        console.error('Failed to parse markdown link:', match, error);
        return match;
      }
    });
  }
}
