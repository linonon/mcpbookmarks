// @ts-check

/**
 * AI Bookmarks Sidebar Webview Script
 * 处理侧边栏的渲染和交互逻辑
 */

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // DOM Elements
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search');
  const bookmarksContainer = document.getElementById('bookmarks-container');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  const noResultsState = document.getElementById('no-results-state');
  const groupsList = document.getElementById('groups-list');
  const searchResults = document.getElementById('search-results');
  const contextMenu = document.getElementById('context-menu');

  // Header buttons
  const btnNewGroup = document.getElementById('btn-new-group');
  const btnToggleAll = document.getElementById('btn-toggle-all');
  const btnExport = document.getElementById('btn-export');

  // State
  let currentData = { groups: [], viewMode: 'group' };
  let collapsedGroups = new Set();
  let collapsedBookmarks = new Set();
  let contextMenuTarget = null;

  // 初始化
  function init() {
    setupEventListeners();
    // 通知 Extension 已准备好
    vscode.postMessage({ type: 'ready' });
  }

  // 设置事件监听
  function setupEventListeners() {
    // 搜索输入
    searchInput.addEventListener('input', debounce(handleSearch, 300));
    clearSearchBtn.addEventListener('click', clearSearch);

    // Header buttons
    if (btnNewGroup) {
      btnNewGroup.addEventListener('click', () => {
        vscode.postMessage({ type: 'createGroup' });
      });
    }

    if (btnToggleAll) {
      btnToggleAll.addEventListener('click', handleToggleAll);
    }

    if (btnExport) {
      btnExport.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportBookmarks' });
      });
    }

    // 全局点击 (关闭 context menu)
    document.addEventListener('click', () => {
      hideContextMenu();
    });

    // 阻止 context menu 内部点击传播
    contextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 键盘事件
    document.addEventListener('keydown', handleKeyDown);
  }

  // 处理来自 Extension 的消息
  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'refresh':
        handleRefresh(message.data);
        break;
      case 'searchResults':
        handleSearchResults(message.data);
        break;
      case 'expandAll':
        expandAllGroups();
        break;
      case 'collapseAll':
        collapseAllGroups();
        break;
      case 'revealBookmark':
        if (message.bookmarkId) {
          revealBookmark(message.bookmarkId);
        }
        break;
    }
  });

  // 处理刷新数据
  function handleRefresh(data) {
    currentData = data;
    renderGroups(data.groups);
  }

  // 渲染分组列表
  function renderGroups(groups) {
    // 隐藏其他状态
    loadingState.style.display = 'none';
    emptyState.style.display = 'none';
    noResultsState.style.display = 'none';
    searchResults.style.display = 'none';

    if (!groups || groups.length === 0) {
      emptyState.style.display = 'flex';
      groupsList.style.display = 'none';
      return;
    }

    groupsList.style.display = 'block';
    groupsList.innerHTML = groups.map(group => renderGroup(group)).join('');

    // 绑定事件
    bindGroupEvents();
    bindBookmarkEvents();
  }

  // 渲染单个分组
  function renderGroup(group) {
    const isCollapsed = collapsedGroups.has(group.id);
    const creatorClass = group.createdBy === 'ai' ? 'ai-created' : 'user-created';
    const bookmarkCount = countAllBookmarks(group.bookmarks || []);

    // 构建书签树
    const bookmarksHtml = renderBookmarkTree(group.bookmarks || [], group.id, null, 0);

    return `
      <div class="group-item" data-group-id="${escapeHtml(group.id)}">
        <div class="group-header ${creatorClass} ${isCollapsed ? 'collapsed' : ''}"
             data-group-id="${escapeHtml(group.id)}">
          <span class="group-chevron">
            <span class="codicon codicon-chevron-down"></span>
          </span>
          <span class="group-icon">
            <span class="codicon ${group.createdBy === 'ai' ? 'codicon-sparkle' : 'codicon-bookmark'}"></span>
          </span>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-count">${bookmarkCount}</span>
        </div>
        ${group.query ? `<div class="group-query">Q: ${escapeHtml(group.query)}</div>` : ''}
        <div class="bookmarks-list ${isCollapsed ? 'collapsed' : ''}" data-group-id="${escapeHtml(group.id)}">
          ${bookmarksHtml}
        </div>
      </div>
    `;
  }

  // 递归统计书签数量
  function countAllBookmarks(bookmarks) {
    let count = 0;
    for (const bookmark of bookmarks) {
      count++;
      if (bookmark.children && bookmark.children.length > 0) {
        count += countAllBookmarks(bookmark.children);
      }
    }
    return count;
  }

  // 渲染书签树 (支持层级)
  function renderBookmarkTree(bookmarks, groupId, parentId, depth) {
    if (!bookmarks || bookmarks.length === 0) return '';

    // 过滤出当前层级的书签
    const currentLevelBookmarks = bookmarks.filter(b =>
      parentId ? b.parentId === parentId : !b.parentId
    );

    // 按 order 排序
    currentLevelBookmarks.sort((a, b) => (a.order || 0) - (b.order || 0));

    return currentLevelBookmarks.map((bookmark, index) => {
      const isLast = index === currentLevelBookmarks.length - 1;
      const hasChildren = bookmarks.some(b => b.parentId === bookmark.id);
      const isCollapsed = collapsedBookmarks.has(bookmark.id);

      // 获取子书签
      const childrenHtml = hasChildren
        ? renderBookmarkTree(bookmarks, groupId, bookmark.id, depth + 1)
        : '';

      return renderBookmark(bookmark, groupId, depth, isLast, hasChildren, isCollapsed, childrenHtml);
    }).join('');
  }

  // 渲染单个书签
  function renderBookmark(bookmark, groupId, depth, isLast, hasChildren, isCollapsed, childrenHtml) {
    const category = bookmark.category || 'note';
    const orderDisplay = getOrderDisplay(bookmark.order, depth);

    return `
      <div class="bookmark-item ${hasChildren ? 'has-children' : ''} ${isCollapsed ? 'collapsed' : ''} ${isLast ? 'last-sibling' : ''}"
           data-bookmark-id="${escapeHtml(bookmark.id)}"
           data-group-id="${escapeHtml(groupId)}"
           data-category="${escapeHtml(category)}"
           data-depth="${depth}">
        <div class="flow-line"></div>
        <div class="order-circle ${depth > 0 ? 'sub-order' : ''}">${orderDisplay}</div>
        ${hasChildren ? `
          <span class="bookmark-chevron">
            <span class="codicon codicon-chevron-down"></span>
          </span>
        ` : ''}
        <div class="bookmark-content">
          <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
          <div class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</div>
          ${bookmark.description ? `<div class="bookmark-description">${escapeHtml(truncate(bookmark.description, 60))}</div>` : ''}
        </div>
      </div>
      ${hasChildren ? `
        <div class="children-list ${isCollapsed ? 'collapsed' : ''}" data-parent-id="${escapeHtml(bookmark.id)}">
          ${childrenHtml}
        </div>
      ` : ''}
    `;
  }

  // 获取序号显示
  function getOrderDisplay(order, depth) {
    if (depth === 0) {
      return order || '?';
    }
    // 子书签显示为 1.1, 1.2 等 (简化版, 实际可能需要更复杂逻辑)
    return order || '?';
  }

  // 格式化位置显示
  function formatLocation(location) {
    if (!location) return '';
    // 只显示文件名和行号
    const parts = location.split('/');
    return parts[parts.length - 1];
  }

  // 绑定分组事件
  function bindGroupEvents() {
    document.querySelectorAll('.group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu(); // 关闭可能打开的右键菜单
        const groupId = header.getAttribute('data-group-id');
        toggleGroup(groupId);
      });

      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const groupId = header.getAttribute('data-group-id');
        showGroupContextMenu(e, groupId);
      });
    });
  }

  // 绑定书签事件
  function bindBookmarkEvents() {
    document.querySelectorAll('.bookmark-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu(); // 关闭可能打开的右键菜单
        const bookmarkId = item.getAttribute('data-bookmark-id');
        const hasChildren = item.classList.contains('has-children');

        // 检查是否点击了展开箭头
        if (e.target.closest('.bookmark-chevron')) {
          toggleBookmark(bookmarkId);
          return;
        }

        // 单击 - 跳转到代码
        vscode.postMessage({ type: 'jumpToBookmark', bookmarkId });
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const bookmarkId = item.getAttribute('data-bookmark-id');
        const groupId = item.getAttribute('data-group-id');
        showBookmarkContextMenu(e, bookmarkId, groupId);
      });
    });
  }

  // 切换分组展开/折叠
  function toggleGroup(groupId) {
    const header = document.querySelector(`.group-header[data-group-id="${groupId}"]`);
    const list = document.querySelector(`.bookmarks-list[data-group-id="${groupId}"]`);

    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
      header.classList.remove('collapsed');
      list.classList.remove('collapsed');
    } else {
      collapsedGroups.add(groupId);
      header.classList.add('collapsed');
      list.classList.add('collapsed');
    }

    vscode.postMessage({ type: 'toggleGroup', groupId, expanded: !collapsedGroups.has(groupId) });
  }

  // 切换书签展开/折叠
  function toggleBookmark(bookmarkId) {
    const item = document.querySelector(`.bookmark-item[data-bookmark-id="${bookmarkId}"]`);
    const childrenList = document.querySelector(`.children-list[data-parent-id="${bookmarkId}"]`);

    if (!childrenList) return;

    if (collapsedBookmarks.has(bookmarkId)) {
      collapsedBookmarks.delete(bookmarkId);
      item.classList.remove('collapsed');
      childrenList.classList.remove('collapsed');
    } else {
      collapsedBookmarks.add(bookmarkId);
      item.classList.add('collapsed');
      childrenList.classList.add('collapsed');
    }

    vscode.postMessage({ type: 'toggleBookmark', bookmarkId, expanded: !collapsedBookmarks.has(bookmarkId) });
  }

  // 显示分组右键菜单
  function showGroupContextMenu(e, groupId) {
    contextMenuTarget = { type: 'group', id: groupId };
    contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="editGroup">
        <span class="codicon codicon-edit"></span>
        <span>Edit Group</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item danger" data-action="deleteGroup">
        <span class="codicon codicon-trash"></span>
        <span>Delete Group</span>
      </div>
    `;
    showContextMenu(e.clientX, e.clientY);
    bindContextMenuActions();
  }

  // 显示书签右键菜单
  function showBookmarkContextMenu(e, bookmarkId, groupId) {
    contextMenuTarget = { type: 'bookmark', id: bookmarkId, groupId };
    contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="jumpToBookmark">
        <span class="codicon codicon-go-to-file"></span>
        <span>Go to Location</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="editBookmark">
        <span class="codicon codicon-edit"></span>
        <span>Edit Bookmark</span>
      </div>
      <div class="context-menu-item" data-action="copyBookmarkInfo">
        <span class="codicon codicon-copy"></span>
        <span>Copy Info</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item danger" data-action="deleteBookmark">
        <span class="codicon codicon-trash"></span>
        <span>Delete Bookmark</span>
      </div>
    `;
    showContextMenu(e.clientX, e.clientY);
    bindContextMenuActions();
  }

  // 显示 context menu
  function showContextMenu(x, y) {
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;

    // 确保不超出视口
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = `${y - rect.height}px`;
    }
  }

  // 隐藏 context menu
  function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextMenuTarget = null;
  }

  // 查找书签 (递归搜索包括子书签)
  function findBookmarkById(bookmarkId, bookmarks) {
    for (const bookmark of bookmarks) {
      if (bookmark.id === bookmarkId) {
        return bookmark;
      }
      if (bookmark.children && bookmark.children.length > 0) {
        const found = findBookmarkById(bookmarkId, bookmark.children);
        if (found) return found;
      }
    }
    return null;
  }

  // 复制书签信息到剪贴板
  function copyBookmarkInfo(bookmarkId) {
    // 在所有分组中查找书签
    for (const group of currentData.groups) {
      const bookmark = findBookmarkById(bookmarkId, group.bookmarks || []);
      if (bookmark) {
        const info = `${bookmark.title}\n${bookmark.location}`;
        navigator.clipboard.writeText(info).then(() => {
          // 复制成功 - 可以通过 postMessage 通知 extension 显示提示
          vscode.postMessage({ type: 'showInfo', message: 'Bookmark info copied to clipboard' });
        }).catch(err => {
          console.error('Failed to copy:', err);
        });
        return;
      }
    }
  }

  // 绑定 context menu 动作
  function bindContextMenuActions() {
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        handleContextMenuAction(action);
        hideContextMenu();
      });
    });
  }

  // 处理 context menu 动作
  function handleContextMenuAction(action) {
    if (!contextMenuTarget) return;

    switch (action) {
      case 'jumpToBookmark':
        vscode.postMessage({ type: 'jumpToBookmark', bookmarkId: contextMenuTarget.id });
        break;
      case 'editBookmark':
        vscode.postMessage({ type: 'editBookmark', bookmarkId: contextMenuTarget.id });
        break;
      case 'deleteBookmark':
        vscode.postMessage({ type: 'deleteBookmark', bookmarkId: contextMenuTarget.id });
        break;
      case 'copyBookmarkInfo':
        copyBookmarkInfo(contextMenuTarget.id);
        break;
      case 'editGroup':
        vscode.postMessage({ type: 'editGroup', groupId: contextMenuTarget.id });
        break;
      case 'deleteGroup':
        vscode.postMessage({ type: 'deleteGroup', groupId: contextMenuTarget.id });
        break;
    }
  }

  // 处理搜索
  function handleSearch() {
    const query = searchInput.value.trim();
    if (query) {
      clearSearchBtn.style.display = 'block';
      vscode.postMessage({ type: 'search', query });
    } else {
      clearSearch();
    }
  }

  // 清除搜索
  function clearSearch() {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    renderGroups(currentData.groups);
  }

  // 处理搜索结果
  function handleSearchResults(data) {
    loadingState.style.display = 'none';
    emptyState.style.display = 'none';
    groupsList.style.display = 'none';

    if (!data.results || data.results.length === 0) {
      noResultsState.style.display = 'flex';
      searchResults.style.display = 'none';
      return;
    }

    noResultsState.style.display = 'none';
    searchResults.style.display = 'block';
    searchResults.innerHTML = data.results.map(result => renderSearchResult(result)).join('');

    // 绑定搜索结果点击事件
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const bookmarkId = item.getAttribute('data-bookmark-id');
        vscode.postMessage({ type: 'jumpToBookmark', bookmarkId });
      });
    });
  }

  // 渲染搜索结果项
  function renderSearchResult(result) {
    const { bookmark, group } = result;
    const category = bookmark.category || 'note';

    return `
      <div class="search-result-item"
           data-bookmark-id="${escapeHtml(bookmark.id)}"
           data-category="${escapeHtml(category)}">
        <div class="search-result-title">${escapeHtml(bookmark.title)}</div>
        <div class="search-result-group">${escapeHtml(group.name)}</div>
        <div class="search-result-location">${escapeHtml(formatLocation(bookmark.location))}</div>
      </div>
    `;
  }

  // 处理键盘事件
  function handleKeyDown(e) {
    // Escape 关闭 context menu
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  }

  // 工具函数: 防抖
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // 工具函数: HTML 转义
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 工具函数: 截断文本
  function truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  // 展开全部/折叠全部切换
  function handleToggleAll() {
    const allCollapsed = Array.from(collapsedGroups).length === currentData.groups.length;

    if (allCollapsed) {
      expandAllGroups();
      if (btnToggleAll) {
        btnToggleAll.querySelector('.codicon').className = 'codicon codicon-fold';
      }
    } else {
      collapseAllGroups();
      if (btnToggleAll) {
        btnToggleAll.querySelector('.codicon').className = 'codicon codicon-unfold';
      }
    }
  }

  // 展开所有分组
  function expandAllGroups() {
    collapsedGroups.clear();
    document.querySelectorAll('.group-header').forEach(header => {
      header.classList.remove('collapsed');
    });
    document.querySelectorAll('.bookmarks-list').forEach(list => {
      list.classList.remove('collapsed');
    });

    // 同时展开所有书签子项
    collapsedBookmarks.clear();
    document.querySelectorAll('.bookmark-item').forEach(item => {
      item.classList.remove('collapsed');
    });
    document.querySelectorAll('.children-list').forEach(list => {
      list.classList.remove('collapsed');
    });
  }

  // 折叠所有分组
  function collapseAllGroups() {
    currentData.groups.forEach(group => {
      collapsedGroups.add(group.id);
    });
    document.querySelectorAll('.group-header').forEach(header => {
      header.classList.add('collapsed');
    });
    document.querySelectorAll('.bookmarks-list').forEach(list => {
      list.classList.add('collapsed');
    });
  }

  // 聚焦到指定书签 (CodeLens 点击时调用)
  /**
   * @param {string} bookmarkId - 书签 ID
   */
  function revealBookmark(bookmarkId) {
    // 1. 找到 bookmark 元素
    const bookmarkElement = document.querySelector(`[data-bookmark-id="${bookmarkId}"]`);
    if (!bookmarkElement) {
      return;
    }

    // 2. 获取所属的 groupId
    const groupId = bookmarkElement.getAttribute('data-group-id');
    if (!groupId) {
      return;
    }

    // 3. 展开所属的 group
    collapsedGroups.delete(groupId);
    const groupHeader = document.querySelector(`[data-group-id="${groupId}"].group-header`);
    if (groupHeader && groupHeader.parentElement) {
      groupHeader.classList.remove('collapsed');
      const bookmarksList = groupHeader.parentElement.querySelector('.bookmarks-list');
      if (bookmarksList) {
        bookmarksList.classList.remove('collapsed');
      }
    }

    // 4. 如果是子书签, 展开所有父书签
    let currentElement = bookmarkElement;
    while (currentElement) {
      const parentBookmarkId = currentElement.getAttribute('data-parent-id');
      if (!parentBookmarkId) {
        break;
      }

      // 展开父书签
      collapsedBookmarks.delete(parentBookmarkId);
      const parentElement = document.querySelector(`[data-bookmark-id="${parentBookmarkId}"]`);
      if (parentElement) {
        parentElement.classList.remove('collapsed');
        const childrenList = parentElement.querySelector('.children-list');
        if (childrenList) {
          childrenList.classList.remove('collapsed');
        }
        currentElement = parentElement;
      } else {
        break;
      }
    }

    // 5. 移除所有其他 active 高亮
    document.querySelectorAll('.bookmark-item.active').forEach(item => {
      item.classList.remove('active');
    });

    // 6. 高亮当前书签
    bookmarkElement.classList.add('active');

    // 7. 滚动到书签位置
    setTimeout(() => {
      bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // 启动
  init();
})();
