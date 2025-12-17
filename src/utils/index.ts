import * as path from 'path';
import { ParsedLocation } from '../store/types';

/**
 * Parse location string to structured format
 * Location format:
 *   Single line: path/to/file:45
 *   Range: path/to/file:78-92
 */
export function parseLocation(location: string): ParsedLocation {
  // 找最后一个 : 分割
  const lastColonIndex = location.lastIndexOf(':');
  if (lastColonIndex === -1) {
    throw new Error(`Invalid location format: ${location}`);
  }

  const filePath = location.substring(0, lastColonIndex);
  const lineSpec = location.substring(lastColonIndex + 1);

  // 检查是否是范围
  if (lineSpec.includes('-')) {
    const [startStr, endStr] = lineSpec.split('-');
    const startLine = parseInt(startStr, 10);
    const endLine = parseInt(endStr, 10);

    if (isNaN(startLine) || isNaN(endLine)) {
      throw new Error(`Invalid line range: ${lineSpec}`);
    }

    return {
      filePath,
      startLine,
      endLine,
      isRange: true
    };
  }

  // 单行
  const line = parseInt(lineSpec, 10);
  if (isNaN(line)) {
    throw new Error(`Invalid line number: ${lineSpec}`);
  }

  return {
    filePath,
    startLine: line,
    endLine: line,
    isRange: false
  };
}

/**
 * Format location from parsed structure
 */
export function formatLocation(parsed: ParsedLocation): string {
  if (parsed.isRange && parsed.startLine !== parsed.endLine) {
    return `${parsed.filePath}:${parsed.startLine}-${parsed.endLine}`;
  }
  return `${parsed.filePath}:${parsed.startLine}`;
}

/**
 * Normalize file path for consistent comparison
 */
export function normalizePath(filePath: string, workspaceRoot?: string): string {
  let normalized = filePath.replace(/\\/g, '/');

  // 如果提供了 workspace root, 转换为相对路径
  if (workspaceRoot) {
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    if (normalized.startsWith(normalizedRoot)) {
      normalized = normalized.substring(normalizedRoot.length);
      if (normalized.startsWith('/')) {
        normalized = normalized.substring(1);
      }
    }
  }

  return normalized;
}

/**
 * Convert relative path to absolute path
 */
export function toAbsolutePath(relativePath: string, workspaceRoot: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(workspaceRoot, relativePath);
}

/**
 * Get file name from path
 */
export function getFileName(filePath: string): string {
  return path.basename(filePath);
}

/**
 * Get directory name from path
 */
export function getDirName(filePath: string): string {
  return path.dirname(filePath);
}

/**
 * Check if two locations overlap
 */
export function locationsOverlap(loc1: ParsedLocation, loc2: ParsedLocation): boolean {
  if (loc1.filePath !== loc2.filePath) {
    return false;
  }

  // 检查行号是否重叠
  return !(loc1.endLine < loc2.startLine || loc2.endLine < loc1.startLine);
}

/**
 * Adjust line numbers based on document edit
 */
export function adjustLineNumbers(
  location: ParsedLocation,
  editStartLine: number,
  lineDelta: number
): ParsedLocation {
  // 如果编辑在书签之后, 不需要调整
  if (editStartLine > location.endLine) {
    return location;
  }

  // 如果编辑在书签之前, 整体移动
  if (editStartLine <= location.startLine) {
    return {
      ...location,
      startLine: Math.max(1, location.startLine + lineDelta),
      endLine: Math.max(1, location.endLine + lineDelta)
    };
  }

  // 编辑在书签范围内, 只调整结束行
  return {
    ...location,
    endLine: Math.max(location.startLine, location.endLine + lineDelta)
  };
}

/**
 * Generate ISO timestamp
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | undefined;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: string): string {
  const names: Record<string, string> = {
    'entry-point': 'Entry Point',
    'core-logic': 'Core Logic',
    'issue': 'Issue',
    'note': 'Note'
  };
  return names[category] || category;
}

/**
 * Get category icon
 */
export function getCategoryIcon(category?: string): string {
  const icons: Record<string, string> = {
    'entry-point': 'entry-point',
    'core-logic': 'core-logic',
    'issue': 'issue',
    'note': 'note'
  };
  return icons[category || ''] || 'bookmark';
}
