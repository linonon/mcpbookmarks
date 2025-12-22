#!/usr/bin/env node
/**
 * MCP Bookmarks Launcher
 *
 * 动态查找并运行最新版本的 MCP server
 * 这个脚本会被复制到 ~/.vscode/mcp-bookmarks-launcher.js
 *
 * 工作原理:
 * 1. 扫描 VSCode 扩展目录
 * 2. 找到所有 mcp-bookmarks 扩展版本
 * 3. 使用语义化版本比较找到最新版本
 * 4. 运行该版本的 mcp-server.js
 *
 * 用户只需配置一次, 扩展更新后会自动使用新版本!
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 跨平台获取扩展目录
function getExtensionsDir() {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.vscode', 'extensions');
}

// 语义化版本比较
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;

    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
}

// 查找最新版本的扩展
function findLatestExtension() {
  const extensionsDir = getExtensionsDir();

  // 检查扩展目录是否存在
  if (!fs.existsSync(extensionsDir)) {
    console.error(`Extensions directory not found: ${extensionsDir}`);
    console.error('Please make sure VSCode is installed correctly.');
    process.exit(1);
  }

  // 读取所有扩展目录
  let files;
  try {
    files = fs.readdirSync(extensionsDir);
  } catch (error) {
    console.error(`Failed to read extensions directory: ${error.message}`);
    process.exit(1);
  }

  // 查找所有 mcp-bookmarks 扩展版本
  const versions = files
    .filter(f => f.startsWith('linonon.mcp-bookmarks-'))
    .map(f => {
      const match = f.match(/linonon\.mcp-bookmarks-(.+)/);
      return match ? { dir: f, version: match[1] } : null;
    })
    .filter(Boolean);

  // 检查是否找到扩展
  if (versions.length === 0) {
    console.error('Error: MCP Bookmarks extension not found!');
    console.error('Please install the MCP Bookmarks extension from VSCode Marketplace.');
    console.error(`Searched in: ${extensionsDir}`);
    process.exit(1);
  }

  // 按版本号排序, 找最新版本
  versions.sort((a, b) => compareVersions(b.version, a.version));

  return versions[0].dir;
}

// 主函数
function main() {
  const extensionsDir = getExtensionsDir();
  const latestDir = findLatestExtension();

  const serverPath = path.join(extensionsDir, latestDir, 'dist', 'mcp-server.js');

  // 检查 MCP server 文件是否存在
  if (!fs.existsSync(serverPath)) {
    console.error(`Error: MCP server file not found at ${serverPath}`);
    console.error('Please reinstall the MCP Bookmarks extension.');
    process.exit(1);
  }

  // 调试信息 (可选)
  if (process.env.DEBUG_MCP_LAUNCHER) {
    console.log(`Using MCP Bookmarks from: ${latestDir}`);
    console.log(`Server path: ${serverPath}`);
  }

  // 启动 MCP server, 转发所有参数
  const child = spawn('node', [serverPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
  });

  // 处理进程退出
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
    } else {
      process.exit(code || 0);
    }
  });

  // 处理错误
  child.on('error', (error) => {
    console.error(`Failed to start MCP server: ${error.message}`);
    process.exit(1);
  });
}

// 运行主函数
main();
