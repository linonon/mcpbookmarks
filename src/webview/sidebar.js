// @ts-check

/**
 * AI Bookmarks Sidebar Webview Script
 * 处理侧边栏的渲染和交互逻辑
 */

(function () {
  console.log('🚀🚀🚀 [SIDEBAR.JS] FILE LOADED - NEW VERSION! 🚀🚀🚀');

  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // DOM Elements
  const bookmarksContainer = document.getElementById('bookmarks-container');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  const noResultsState = document.getElementById('no-results-state');
  const groupsList = document.getElementById('groups-list');
  const searchResults = document.getElementById('search-results');
  const contextMenu = document.getElementById('context-menu');

  // Header buttons
  // (view-style button removed, now controlled by VSCode toolbar)

  // State
  let currentData = { groups: [], viewMode: 'group' };
  let uiState = { viewMode: 'nested' }; // nested | tree
  let collapsedGroups = new Set();
  let collapsedBookmarks = new Set();
  let contextMenuTarget = null;
  /** @type {{mode: string, targetBookmarkId: string, groupId: string, parentId: string|null}|null} */
  let addBookmarkContext = null;


  /**
   * 动态加载模式特定的 CSS 文件
   * @param {string} mode - 视图模式 ('nested' | 'tree')
   */
  function loadModeSpecificCSS(mode) {
    // 移除之前加载的模式特定 CSS
    const existingModeCSS = document.getElementById('mode-specific-css');
    if (existingModeCSS) {
      existingModeCSS.remove();
    }

    // 获取主 CSS 的基础 URL (从现有的 link 标签中提取)
    const mainCssLink = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .find(link => link.href.includes('sidebar.css'));
    
    let baseUrl = '';
    if (mainCssLink) {
      // 提取基础 URL (去掉文件名)
      const mainCssUrl = mainCssLink.href;
      baseUrl = mainCssUrl.substring(0, mainCssUrl.lastIndexOf('/') + 1);
    }

    // 加载新的模式特定 CSS
    const link = document.createElement('link');
    link.id = 'mode-specific-css';
    link.rel = 'stylesheet';
    const fileName = mode === 'tree' ? 'sidebar-tree.css' : 'sidebar-nested.css';
    link.href = baseUrl + fileName;
    document.head.appendChild(link);

    console.log(`[CSS] Loaded ${mode} mode CSS from ${link.href}`);
  }

  /**
   * 动态加载模式特定的 JS 文件
   * @param {string} mode - 视图模式 ('nested' | 'tree')
   * @returns {Promise<void>}
   */
  function loadModeSpecificJS(mode) {
    return new Promise((resolve, reject) => {
      // 移除之前加载的模式特定 JS
      const existingModeJS = document.getElementById('mode-specific-js');
      if (existingModeJS) {
        existingModeJS.remove();
      }

      // 获取主 JS 的基础 URL (从现有的 script 标签中提取)
      const mainJsScript = Array.from(document.querySelectorAll('script'))
        .find(script => script.src.includes('sidebar.js'));
      
      let baseUrl = '';
      if (mainJsScript) {
        // 提取基础 URL (去掉文件名)
        const mainJsUrl = mainJsScript.src;
        baseUrl = mainJsUrl.substring(0, mainJsUrl.lastIndexOf('/') + 1);
      }

      // 加载新的模式特定 JS
      const script = document.createElement('script');
      script.id = 'mode-specific-js';
      const fileName = mode === 'tree' ? 'sidebar-tree.js' : 'sidebar-nested.js';
      script.src = baseUrl + fileName;
      script.onload = () => {
        console.log(`[JS] Loaded ${mode} mode JS from ${script.src}`);
        resolve();
      };
      script.onerror = (error) => {
        console.error(`[JS] Failed to load ${mode} mode JS from ${script.src}`, error);
        reject(error);
      };
      document.head.appendChild(script);
    });
  }

  // 初始化
  async function init() {
    console.log('✅✅✅ [INIT] Starting initialization... ✅✅✅');
    // 加载默认模式的 CSS 和 JS
    loadModeSpecificCSS(uiState.viewMode);
    await loadModeSpecificJS(uiState.viewMode);
    setupEventListeners();
    console.log('✅✅✅ [INIT] Event listeners setup complete ✅✅✅');
    // 通知 Extension 已准备好
    vscode.postMessage({ type: 'ready' });
    console.log('✅✅✅ [INIT] Initialization complete! ✅✅✅');
  }

  /**
   * 更新字体大小 CSS 变量
   * @param {Object} config - 字体配置对象
   * @param {number} config.title - 标题字体大小
   * @param {number} config.description - 描述字体大小
   * @param {number} config.groupName - 分组名称字体大小
   * @param {number} config.location - 位置字体大小
   */
  function updateFontSize(config) {
    const root = document.documentElement;
    root.style.setProperty('--font-size-title', `${config.title}px`);
    root.style.setProperty('--font-size-description', `${config.description}px`);
    root.style.setProperty('--font-size-group-name', `${config.groupName}px`);
    root.style.setProperty('--font-size-location', `${config.location}px`);
  }

  // 设置事件监听
  function setupEventListeners() {
    console.log('[Setup] Initializing event listeners...');

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

    // 事件委托：在 groupsList 上监听所有书签点击
    if (groupsList) {
      groupsList.addEventListener('click', handleBookmarkClick);
    }
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
      case 'collapseGroup':
        if (message.groupId) {
          collapseGroup(message.groupId);
        }
        break;
      case 'expandGroup':
        if (message.groupId) {
          expandGroup(message.groupId);
        }
        break;
      case 'revealBookmark':
        if (message.bookmarkId) {
          revealBookmark(message.bookmarkId);
        }
        break;
      case 'currentLocation':
        handleCurrentLocation(message.location, message.error);
        break;
      case 'validationError':
        // 显示错误提示，重新启用保存按钮
        if (message.field && message.error) {
          showError(message.field, message.error);
        }
        // 重新启用按钮
        const saveBtn = document.querySelector('.form-btn-save');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
        break;
      case 'updateFontSize':
        if (message.config) {
          updateFontSize(message.config);
        }
        break;
      case 'toggleViewMode':
        // 切换视图模式
        uiState.viewMode = uiState.viewMode === 'nested' ? 'tree' : 'nested';

        // 重新加载模式特定的 CSS
        loadModeSpecificCSS(uiState.viewMode);

        // 重新加载模式特定的 JS (异步)
        loadModeSpecificJS(uiState.viewMode).then(() => {
          console.log(`[Toggle View Mode] Successfully loaded ${uiState.viewMode} mode JS`);
          // JS 加载完成后,如果有数据就重新渲染
          if (currentData.groups) {
            renderGroups(currentData.groups);
          }
        }).catch(error => {
          console.error('[Toggle View Mode] Failed to load mode-specific JS:', error);
        });

        // 更新容器 class
        if (bookmarksContainer) {
          if (uiState.viewMode === 'tree') {
            bookmarksContainer.classList.add('view-mode-tree');
          } else {
            bookmarksContainer.classList.remove('view-mode-tree');
          }

          // 强制重绘
          bookmarksContainer.style.display = 'none';
          void bookmarksContainer.offsetHeight;
          bookmarksContainer.style.display = '';
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
      <div class="group-item ${creatorClass}" data-group-id="${escapeHtml(group.id)}">
        <div class="group-header ${creatorClass} ${isCollapsed ? 'collapsed' : ''}"
             data-group-id="${escapeHtml(group.id)}">
          <span class="group-chevron">
            <span class="codicon codicon-chevron-down"></span>
          </span>
          <span class="group-icon">
            <span class="codicon ${group.createdBy === 'ai' ? 'codicon-sparkle' : 'codicon-bookmark'}"></span>
          </span>
          <div class="group-info">
            <span class="group-name">${escapeHtml(group.name)}</span>
            ${group.query ? `<span class="group-query" title="${escapeHtml(group.query)}">Q: ${escapeHtml(group.query)}</span>` : ''}
          </div>
          <span class="group-count">${bookmarkCount}</span>
        </div>
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

    return currentLevelBookmarks.map((bookmark) => {
      const hasChildren = bookmarks.some(b => b.parentId === bookmark.id);
      const isCollapsed = collapsedBookmarks.has(bookmark.id);

      // 调试输出
      if (hasChildren) {
        console.log('[Chevron Debug] Bookmark with children:', {
          title: bookmark.title,
          id: bookmark.id,
          hasChildren,
          childCount: bookmarks.filter(/** @param {any} b */ b => b.parentId === bookmark.id).length
        });
      }

      // 获取子书签
      const childrenHtml = hasChildren
        ? renderBookmarkTree(bookmarks, groupId, bookmark.id, depth + 1)
        : '';

      return renderBookmark(bookmark, groupId, depth, hasChildren, isCollapsed, childrenHtml);
    }).join('');
  }

  // 渲染单个书签 - 嵌套包裹结构
  function renderBookmark(bookmark, groupId, depth, hasChildren, isCollapsed, childrenHtml) {
    const category = bookmark.category || 'note';

    // 调试输出 - 验证 chevron HTML 生成
    if (hasChildren) {
      console.log('[Chevron Render Debug]', {
        title: bookmark.title,
        id: bookmark.id,
        hasChildren,
        willRenderChevron: true,
        containerClasses: `has-children ${isCollapsed ? 'collapsed' : ''}`
      });
    }

    // 根据视图模式渲染 header
    let headerHtml;
    if (uiState.viewMode === 'tree') {
      // Tree 模式: 使用 Grid 布局
      // @ts-ignore - Function loaded dynamically from sidebar-tree.js
      if (typeof window.renderBookmarkHeaderTree !== 'function') {
        console.warn('[Render Warning] renderBookmarkHeaderTree not loaded yet, using fallback');
        // 回退到基础渲染 (显示标题而不是 Loading...)
        headerHtml = `
          <div class="bookmark-header" style="--indent-level: ${depth}">
            <div class="bookmark-indent"></div>
            <span class="bookmark-chevron">${hasChildren ? `<span class="icon icon-expand"></span>` : ''}</span>
            ${bookmark.order ? `<span class="order-badge">${bookmark.order}</span>` : ''}
            <div class="bookmark-title-location">
              <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
              <span class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</span>
            </div>
          </div>
        `;
      } else {
        headerHtml = window.renderBookmarkHeaderTree(bookmark, hasChildren, isCollapsed, depth);
      }
    } else {
      // Nested 模式: 使用 Flexbox 布局
      // @ts-ignore - Function loaded dynamically from sidebar-nested.js
      if (typeof window.renderBookmarkHeaderNested !== 'function') {
        console.warn('[Render Warning] renderBookmarkHeaderNested not loaded yet, using fallback');
        // 回退到基础渲染
        headerHtml = `
          <div class="bookmark-header">
            <span class="bookmark-chevron">${hasChildren ? `<span class="icon icon-expand"></span>` : ''}</span>
            ${bookmark.order ? `<span class="order-badge">${bookmark.order}</span>` : ''}
            <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
            <span class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</span>
          </div>
        `;
      } else {
        headerHtml = window.renderBookmarkHeaderNested(bookmark, hasChildren, isCollapsed);
      }
    }

    return `
      <div class="bookmark-container ${hasChildren ? 'has-children' : ''} ${isCollapsed ? 'collapsed' : ''}"
           data-bookmark-id="${escapeHtml(bookmark.id)}"
           data-group-id="${escapeHtml(groupId)}"
           data-depth="${depth}">
        <div class="bookmark-item"
             data-category="${escapeHtml(category)}">

          <div class="bookmark-content">
            ${headerHtml}
            ${bookmark.description ? `
              <div class="bookmark-description-wrapper">
                <div class="bookmark-action-buttons">
                  <button class="bookmark-toggle-btn" data-bookmark-id="${escapeHtml(bookmark.id)}" title="Expand/Collapse">
                    <span class="icon icon-expand"></span>
                  </button>
                </div>
                <div class="bookmark-description"
                     data-bookmark-id="${escapeHtml(bookmark.id)}"
                     data-markdown="${escapeHtml(bookmark.description)}">
                  ${renderMarkdown(bookmark.description)}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
        ${hasChildren ? `
          <div class="children-list ${isCollapsed ? 'collapsed' : ''}" data-parent-id="${escapeHtml(bookmark.id)}">
            ${childrenHtml}
          </div>
        ` : ''}
      </div>
    `;
  }

  // 格式化位置显示
  function formatLocation(location) {
    if (!location) return '';
    // 只显示文件名和行号
    const parts = location.split('/');
    return parts[parts.length - 1];
  }

  /**
   * 工具函数: HTML 转义
   * @param {string} str
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 暴露工具函数到全局作用域 (供外部渲染文件使用)
  // @ts-ignore - Dynamic property added at runtime for mode-specific rendering
  window.escapeHtml = escapeHtml;
  // @ts-ignore - Dynamic property added at runtime for mode-specific rendering
  window.formatLocation = formatLocation;

  // 处理书签点击事件 (事件委托)
  function handleBookmarkClick(e) {
    hideContextMenu(); // 关闭可能打开的右键菜单

    // 检查是否点击了文件链接
    const fileLink = e.target.closest('.file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();

      const filePath = fileLink.getAttribute('data-file-path');
      const lineStr = fileLink.getAttribute('data-line');
      const line = lineStr ? parseInt(lineStr, 10) : undefined;

      // 发送消息到扩展打开文件
      vscode.postMessage({
        type: 'openFile',
        path: filePath,
        line: line
      });
      return;
    }

    // 检查是否点击了 bookmark-chevron
    const chevron = e.target.closest('.bookmark-chevron');
    if (chevron) {
      e.preventDefault();
      e.stopPropagation();
      const container = chevron.closest('.bookmark-container');
      if (container) {
        const bookmarkId = container.getAttribute('data-bookmark-id');
        toggleBookmark(bookmarkId);
      }
      return;
    }

    // 检查是否点击了展开/折叠按钮
    const toggleBtn = e.target.closest('.bookmark-toggle-btn');
    if (toggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const bookmarkId = toggleBtn.getAttribute('data-bookmark-id');
      const descElement = document.querySelector(`.bookmark-description[data-bookmark-id="${bookmarkId}"]`);
      const icon = toggleBtn.querySelector('.icon');

      if (descElement && icon) {
        const isExpanded = descElement.classList.toggle('expanded');
        icon.className = isExpanded ? 'icon icon-collapse' : 'icon icon-expand';
      }
      return;
    }

    // 检查是否点击了编辑表单区域
    const editForm = e.target.closest('.bookmark-edit-form');
    if (editForm) {
      // 点击表单区域不触发任何操作
      e.stopPropagation();
      return;
    }

    // 检查是否点击了 description 区域
    const descElement = e.target.closest('.bookmark-description');
    if (descElement) {
      // 点击 description 不跳转
      return;
    }

    // 检查是否点击了书签项
    const bookmarkItem = e.target.closest('.bookmark-item');
    if (bookmarkItem) {
      e.stopPropagation();

      const container = bookmarkItem.closest('.bookmark-container');
      if (!container) return;

      // 检查是否处于编辑模式
      const bookmarkContent = container.querySelector('.bookmark-content');
      if (bookmarkContent && bookmarkContent.querySelector('.bookmark-edit-form')) {
        // 编辑模式下不触发跳转
        return;
      }

      const bookmarkId = container.getAttribute('data-bookmark-id');

      // 高亮当前书签 (移除其他高亮, 添加当前高亮)
      document.querySelectorAll('.bookmark-container.active').forEach(activeContainer => {
        activeContainer.classList.remove('active');
      });
      container.classList.add('active');

      vscode.postMessage({ type: 'jumpToBookmark', bookmarkId });
    }
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
    // 只绑定 contextmenu 事件（不会冒泡，必须单独绑定）
    // 其他事件（click）已通过事件委托在 groupsList 上处理
    document.querySelectorAll('.bookmark-item').forEach(item => {
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // data-* 属性在父元素 .bookmark-container 上
        const container = item.closest('.bookmark-container');
        if (!container) return;

        const bookmarkId = container.getAttribute('data-bookmark-id');
        const groupId = container.getAttribute('data-group-id');
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
    // data-bookmark-id 和 collapsed 类在 .bookmark-container 上
    const container = document.querySelector(`.bookmark-container[data-bookmark-id="${bookmarkId}"]`);
    const childrenList = document.querySelector(`.children-list[data-parent-id="${bookmarkId}"]`);

    if (!container || !childrenList) return;

    // 找到箭头图标
    const chevron = container.querySelector('.bookmark-chevron .icon');

    if (collapsedBookmarks.has(bookmarkId)) {
      collapsedBookmarks.delete(bookmarkId);
      container.classList.remove('collapsed');
      childrenList.classList.remove('collapsed');
      
      // 更新箭头图标：展开时向下
      if (chevron) {
        chevron.className = 'icon icon-collapse';
      }
    } else {
      collapsedBookmarks.add(bookmarkId);
      container.classList.add('collapsed');
      childrenList.classList.add('collapsed');
      
      // 更新箭头图标：折叠时向右
      if (chevron) {
        chevron.className = 'icon icon-expand';
      }
    }

    vscode.postMessage({ type: 'toggleBookmark', bookmarkId, expanded: !collapsedBookmarks.has(bookmarkId) });
  }

  /**
   * 进入全字段编辑模式
   * @param {string} bookmarkId - 书签 ID
   */
  function enterFullEditMode(bookmarkId) {
    // 查找书签数据
    let bookmark = null;
    for (const group of currentData.groups) {
      bookmark = findBookmarkById(bookmarkId, group.bookmarks || []);
      if (bookmark) break;
    }

    if (!bookmark) {
      console.warn('Cannot find bookmark:', bookmarkId);
      return;
    }

    // 保存原始数据
    const originalData = {
      title: bookmark.title,
      location: bookmark.location,
      description: bookmark.description || ''
    };

    // 找到书签容器
    const container = document.querySelector(`.bookmark-container[data-bookmark-id="${bookmarkId}"]`);
    if (!container) {
      console.warn('Cannot find bookmark container');
      return;
    }

    const bookmarkContent = container.querySelector('.bookmark-content');
    if (!bookmarkContent) {
      console.warn('Cannot find bookmark content');
      return;
    }

    // 保存原始 HTML
    const originalHTML = bookmarkContent.innerHTML;

    // 创建编辑表单
    const formHTML = createEditForm(bookmark);
    bookmarkContent.innerHTML = formHTML;

    // 阻止表单点击事件冒泡到 bookmark-container,防止误触发 JumpTo
    const formElement = bookmarkContent.querySelector('.bookmark-edit-form');
    if (formElement) {
      formElement.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // 绑定保存和取消事件
    const saveBtn = bookmarkContent.querySelector('.form-btn-save');
    const cancelBtn = bookmarkContent.querySelector('.form-btn-cancel');
    const titleInput = bookmarkContent.querySelector('#edit-title');
    const locationInput = bookmarkContent.querySelector('#edit-location');
    const descriptionTextarea = bookmarkContent.querySelector('#edit-description');

    if (!saveBtn || !cancelBtn || !titleInput || !locationInput || !descriptionTextarea) {
      console.warn('Cannot find form elements');
      bookmarkContent.innerHTML = originalHTML;
      return;
    }

    // 保存函数
    function save() {
      const title = titleInput.value.trim();
      const location = locationInput.value.trim();
      const description = descriptionTextarea.value.trim();

      // 前端验证
      const validation = validateInputs(title, location, description);
      if (!validation.isValid) {
        // 显示错误
        for (const [field, error] of Object.entries(validation.errors)) {
          showError(`error-${field}`, error);
        }
        return;
      }

      // 清除所有错误
      clearAllErrors();

      // 禁用保存按钮
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      // 发送更新消息
      vscode.postMessage({
        type: 'updateBookmarkFull',
        bookmarkId: bookmarkId,
        updates: { title, location, description }
      });

      // 注意: 成功后会收到 refresh 消息，不需要手动恢复
    }

    // 取消函数
    function cancel() {
      bookmarkContent.innerHTML = originalHTML;
      // 重新绑定事件
      bindBookmarkEvents();
    }

    // 绑定事件
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);

    // 快捷键
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    };

    titleInput.addEventListener('keydown', handleKeyDown);
    locationInput.addEventListener('keydown', handleKeyDown);
    descriptionTextarea.addEventListener('keydown', handleKeyDown);

    // 自适应高度
    function adjustHeight() {
      descriptionTextarea.style.height = 'auto';
      descriptionTextarea.style.height = descriptionTextarea.scrollHeight + 'px';
    }

    descriptionTextarea.addEventListener('input', adjustHeight);
    adjustHeight(); // 初始化高度

    // 聚焦到 title
    titleInput.focus();
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
  }

  /**
   * 创建编辑表单 HTML
   * @param {Object} bookmark - 书签对象
   * @returns {string} 表单 HTML
   */
  function createEditForm(bookmark) {
    return `
      <div class="bookmark-edit-form">
        <div class="form-field">
          <label class="form-label">Title</label>
          <input type="text" class="form-input" id="edit-title" value="${escapeHtml(bookmark.title)}" maxlength="200">
          <div class="form-error" id="error-title"></div>
        </div>

        <div class="form-field">
          <label class="form-label">Location</label>
          <input type="text" class="form-input" id="edit-location" value="${escapeHtml(bookmark.location)}">
          <div class="form-error" id="error-location"></div>
        </div>

        <div class="form-field">
          <label class="form-label">Description</label>
          <textarea class="form-textarea" id="edit-description" maxlength="10000">${escapeHtml(bookmark.description || '')}</textarea>
          <div class="form-error" id="error-description"></div>
        </div>

        <div class="form-actions">
          <button class="form-btn-save" data-bookmark-id="${escapeHtml(bookmark.id)}">Save</button>
          <button class="form-btn-cancel" data-bookmark-id="${escapeHtml(bookmark.id)}">Cancel</button>
        </div>
      </div>
    `;
  }

  /**
   * 验证输入
   * @param {string} title - 标题
   * @param {string} location - 位置
   * @param {string} description - 描述
   * @returns {Object} 验证结果
   */
  function validateInputs(title, location, description) {
    const errors = {};

    // Title 验证
    if (!title) {
      errors.title = 'Title is required';
    } else if (title.length > 200) {
      errors.title = 'Title is too long (max 200 characters)';
    }

    // Location 验证
    if (!location) {
      errors.location = 'Location is required';
    } else {
      // 格式: file:line 或 file:start-end
      const locationRegex = /^.+:\d+(-\d+)?$/;
      if (!locationRegex.test(location)) {
        errors.location = 'Invalid format. Use "file:line" or "file:start-end"';
      } else {
        // 检查行号 >= 1
        const parts = location.split(':');
        const linePart = parts[parts.length - 1];
        const lineNumbers = linePart.split('-').map(n => parseInt(n, 10));
        if (lineNumbers.some(n => n < 1)) {
          errors.location = 'Line numbers must be >= 1';
        }
      }
    }

    // Description 验证
    if (description.length > 10000) {
      errors.description = 'Description is too long (max 10000 characters)';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * 显示错误提示
   * @param {string} fieldId - 字段 ID (如 "error-title")
   * @param {string} message - 错误消息
   */
  function showError(fieldId, message) {
    const errorElement = document.getElementById(fieldId);
    if (errorElement) {
      errorElement.textContent = message;

      // 给对应的输入框添加 error 类
      const inputId = fieldId.replace('error-', 'edit-');
      const inputElement = document.getElementById(inputId);
      if (inputElement) {
        inputElement.classList.add('error');
      }
    }
  }

  /**
   * 清除单个字段错误
   * @param {string} fieldId - 字段 ID
   */
  function clearError(fieldId) {
    const errorElement = document.getElementById(fieldId);
    if (errorElement) {
      errorElement.textContent = '';

      const inputId = fieldId.replace('error-', 'edit-');
      const inputElement = document.getElementById(inputId);
      if (inputElement) {
        inputElement.classList.remove('error');
      }
    }
  }

  /**
   * 清除所有错误
   */
  function clearAllErrors() {
    ['error-title', 'error-location', 'error-description'].forEach(clearError);
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
      <div class="context-menu-item" data-action="editBookmark">
        <span class="codicon codicon-edit"></span>
        <span>Edit Bookmark</span>
      </div>
      <div class="context-menu-item" data-action="copyBookmarkInfo">
        <span class="codicon codicon-copy"></span>
        <span>Copy Info</span>
      </div>
      <div class="context-menu-item" data-action="copyRelativePath">
        <span class="codicon codicon-file"></span>
        <span>Copy Relative Path</span>
      </div>
      <div class="context-menu-item" data-action="copyAbsolutePath">
        <span class="codicon codicon-file-directory"></span>
        <span>Copy Absolute Path</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="addBookmarkAfter">
        <span class="codicon codicon-add"></span>
        <span>Add Bookmark</span>
      </div>
      <div class="context-menu-item" data-action="addChildBookmark">
        <span class="codicon codicon-symbol-namespace"></span>
        <span>Add Child Bookmark</span>
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
        // 复制格式: title(id)
        const info = `${bookmark.title}(${bookmark.id})`;
        navigator.clipboard.writeText(info).then(() => {
          // 复制成功 - 可以通过 postMessage 通知 extension 显示提示
          vscode.postMessage({ type: 'showInfo', message: 'Bookmark ID copied to clipboard' });
        }).catch(err => {
          console.error('Failed to copy:', err);
        });
        return;
      }
    }
  }

  // 复制相对路径到剪贴板
  function copyRelativePath(bookmarkId) {
    // 在所有分组中查找书签
    for (const group of currentData.groups) {
      const bookmark = findBookmarkById(bookmarkId, group.bookmarks || []);
      if (bookmark) {
        // 提取文件路径 (去掉 :line 或 :start-end)
        const filePath = bookmark.location.split(':')[0];
        navigator.clipboard.writeText(filePath).then(() => {
          vscode.postMessage({ type: 'showInfo', message: 'Relative path copied to clipboard' });
        }).catch(err => {
          console.error('Failed to copy:', err);
        });
        return;
      }
    }
  }

  // 复制绝对路径到剪贴板
  function copyAbsolutePath(bookmarkId) {
    // 在所有分组中查找书签
    for (const group of currentData.groups) {
      const bookmark = findBookmarkById(bookmarkId, group.bookmarks || []);
      if (bookmark) {
        // 提取文件路径并通知扩展复制绝对路径
        // 因为 webview 无法直接访问工作区路径,需要通过扩展来处理
        vscode.postMessage({
          type: 'copyAbsolutePath',
          location: bookmark.location
        });
        return;
      }
    }
  }

  /**
   * 在当前书签后添加同级书签
   * @param {string} bookmarkId - 目标书签 ID
   * @param {string} groupId - 分组 ID
   */
  function addBookmarkAfter(bookmarkId, groupId) {
    // 保存上下文信息
    addBookmarkContext = {
      mode: 'after',
      targetBookmarkId: bookmarkId,
      groupId: groupId,
      parentId: null
    };

    // 获取目标书签的 parentId
    for (const group of currentData.groups) {
      const bookmark = findBookmarkById(bookmarkId, group.bookmarks || []);
      if (bookmark) {
        addBookmarkContext.parentId = bookmark.parentId || null;
        break;
      }
    }

    // 请求 Extension 提供当前光标位置
    vscode.postMessage({
      type: 'requestCurrentLocation'
    });
  }

  /**
   * 在当前书签下添加子书签
   * @param {string} bookmarkId - 父书签 ID
   * @param {string} groupId - 分组 ID
   */
  function addChildBookmark(bookmarkId, groupId) {
    addBookmarkContext = {
      mode: 'child',
      targetBookmarkId: bookmarkId,
      groupId: groupId,
      parentId: bookmarkId
    };

    vscode.postMessage({
      type: 'requestCurrentLocation'
    });
  }

  /**
   * 处理当前光标位置返回
   * @param {string|null} location - 光标位置
   * @param {string} error - 错误信息
   */
  function handleCurrentLocation(location, error) {
    if (!addBookmarkContext) {
      console.error('No addBookmarkContext when receiving location');
      return;
    }

    if (error || !location) {
      vscode.postMessage({
        type: 'showInfo',
        message: error || 'No active editor to get location from'
      });
      addBookmarkContext = null;
      return;
    }

    // 显示添加书签表单
    showAddBookmarkForm(location, addBookmarkContext);
  }

  /**
   * 显示添加书签表单
   * @param {string} location - 预填的位置
   * @param {{mode: string, targetBookmarkId: string, groupId: string, parentId: string|null}} context - 添加书签的上下文
   */
  function showAddBookmarkForm(location, context) {
    // 创建表单 HTML
    const formHtml = `
      <div class="add-bookmark-panel">
        <div class="panel-header">
          <h3>${context.mode === 'child' ? 'Add Child Bookmark' : 'Add Bookmark'}</h3>
        </div>
        <div class="bookmark-edit-form">
          <div class="form-field">
            <label class="form-label">Title *</label>
            <input type="text" class="form-input" id="add-title" maxlength="200" autofocus>
            <div class="form-error" id="error-add-title"></div>
          </div>

          <div class="form-field">
            <label class="form-label">Location *</label>
            <input type="text" class="form-input" id="add-location" value="${escapeHtml(location)}">
            <div class="form-error" id="error-add-location"></div>
          </div>

          <div class="form-field">
            <label class="form-label">Description</label>
            <textarea class="form-textarea" id="add-description" maxlength="10000"></textarea>
            <div class="form-error" id="error-add-description"></div>
          </div>

          <div class="form-actions">
            <button class="form-btn-save" id="add-bookmark-save">Save</button>
            <button class="form-btn-cancel" id="add-bookmark-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // 插入表单到容器顶部
    if (!bookmarksContainer) return;
    const panel = document.createElement('div');
    panel.innerHTML = formHtml;
    const formElement = panel.firstElementChild;
    if (formElement) {
      bookmarksContainer.prepend(formElement);
    }

    // 绑定事件
    const saveBtn = document.getElementById('add-bookmark-save');
    const cancelBtn = document.getElementById('add-bookmark-cancel');
    const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-title'));

    if (saveBtn) {
      saveBtn.addEventListener('click', saveAddBookmark);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeAddBookmarkForm);
    }

    // 聚焦 title 输入框
    if (titleInput) {
      setTimeout(() => titleInput.focus(), 100);
    }
  }

  /**
   * 关闭添加书签表单
   */
  function closeAddBookmarkForm() {
    const panel = document.querySelector('.add-bookmark-panel');
    if (panel) {
      panel.remove();
    }
    addBookmarkContext = null;
  }

  /**
   * 保存添加的书签
   */
  function saveAddBookmark() {
    const titleEl = /** @type {HTMLInputElement|null} */ (document.getElementById('add-title'));
    const locationEl = /** @type {HTMLInputElement|null} */ (document.getElementById('add-location'));
    const descriptionEl = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('add-description'));

    if (!titleEl || !locationEl || !descriptionEl) {
      console.error('Form elements not found');
      return;
    }

    const title = titleEl.value.trim();
    const location = locationEl.value.trim();
    const description = descriptionEl.value.trim();

    // 清除之前的错误提示
    document.querySelectorAll('.add-bookmark-panel .form-error').forEach(el => {
      el.textContent = '';
      const htmlEl = /** @type {HTMLElement} */ (el);
      htmlEl.style.display = 'none';
    });

    // 验证
    const validation = validateInputs(title, location, description);
    if (!validation.isValid) {
      // 显示错误
      for (const [field, error] of Object.entries(validation.errors)) {
        const errorEl = document.getElementById(`error-add-${field}`);
        if (errorEl) {
          errorEl.textContent = error;
          const htmlErrorEl = /** @type {HTMLElement} */ (errorEl);
          htmlErrorEl.style.display = 'block';
        }
      }
      return;
    }

    if (!addBookmarkContext) {
      console.error('No addBookmarkContext when saving');
      return;
    }

    // 禁用按钮防止重复提交
    const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('add-bookmark-save'));
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    // 发送添加请求
    const messageType = addBookmarkContext.mode === 'after' ? 'addBookmark' : 'addChildBookmark';

    vscode.postMessage({
      type: messageType,
      payload: {
        groupId: addBookmarkContext.groupId,
        targetBookmarkId: addBookmarkContext.targetBookmarkId,
        parentId: addBookmarkContext.parentId,
        bookmark: {
          title,
          location,
          description: description || '',
          category: 'note'
        }
      }
    });

    // 清理并关闭
    closeAddBookmarkForm();
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
      case 'editBookmark':
        // 直接进入编辑模式
        enterFullEditMode(contextMenuTarget.id);
        break;
      case 'deleteBookmark':
        vscode.postMessage({ type: 'deleteBookmark', bookmarkId: contextMenuTarget.id });
        break;
      case 'copyBookmarkInfo':
        copyBookmarkInfo(contextMenuTarget.id);
        break;
      case 'copyRelativePath':
        copyRelativePath(contextMenuTarget.id);
        break;
      case 'copyAbsolutePath':
        copyAbsolutePath(contextMenuTarget.id);
        break;
      case 'addBookmarkAfter':
        if (contextMenuTarget.type === 'bookmark') {
          addBookmarkAfter(contextMenuTarget.id, contextMenuTarget.groupId);
        }
        break;
      case 'addChildBookmark':
        if (contextMenuTarget.type === 'bookmark') {
          addChildBookmark(contextMenuTarget.id, contextMenuTarget.groupId);
        }
        break;
      case 'editGroup':
        vscode.postMessage({ type: 'editGroup', groupId: contextMenuTarget.id });
        break;
      case 'deleteGroup':
        vscode.postMessage({ type: 'deleteGroup', groupId: contextMenuTarget.id });
        break;
    }
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

  /**
   * 安全渲染 Markdown 为 HTML
   * @param {string} markdown - Markdown 源文本
   * @returns {string} 安全的 HTML
   */
  function renderMarkdown(markdown) {
    // 检查输入是否有效
    if (!markdown) {
      return '';
    }

    // 检查库是否加载
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      console.warn('Markdown libraries not loaded, falling back to plain text');
      return escapeHtml(markdown);
    }

    try {
      // 配置 marked 的自定义渲染器来处理链接
      const renderer = new marked.Renderer();
      
      // 自定义链接渲染: 将 [text](path) 或 [text](path:line) 转换为可点击的链接
      renderer.link = function(href, title, text) {
        // 解析文件路径和行号
        let filePath = href;
        let line = undefined;
        
        const colonIndex = href.lastIndexOf(':');
        if (colonIndex > 0) {
          const beforeColon = href.substring(0, colonIndex);
          const afterColon = href.substring(colonIndex + 1);
          
          // 检查冒号后面是否是行号
          const lineMatch = afterColon.match(/^(\d+)/);
          if (lineMatch) {
            filePath = beforeColon;
            line = parseInt(lineMatch[1], 10);
          }
        }
        
        // 使用 data- 属性存储路径和行号信息
        const dataAttrs = `data-file-path="${escapeHtml(filePath)}"` + 
                         (line !== undefined ? ` data-line="${line}"` : '');
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        
        return `<a href="#" class="file-link" ${dataAttrs}${titleAttr}>${escapeHtml(text)}</a>`;
      };

      // 配置 marked
      marked.setOptions({
        breaks: true,        // 支持换行
        gfm: true,          // GitHub Flavored Markdown
        headerIds: false,   // 禁用标题 ID
        mangle: false,      // 禁用邮箱混淆
        renderer: renderer
      });

      // 渲染 Markdown
      const rawHtml = marked.parse(markdown);

      // DOMPurify 清理 - 现在允许 <a> 标签和 data- 属性
      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 's', 'del', 'a'],
        ALLOWED_ATTR: ['class', 'data-file-path', 'data-line', 'title', 'href'],
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'img'],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'src']
      });

      return cleanHtml;
    } catch (error) {
      console.error('Markdown rendering failed:', error);
      return escapeHtml(markdown);
    }
  }

  // 工具函数: 截断文本
  function truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  // 展开全部/折叠全部切换

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

  // 折叠单个分组
  /**
   * @param {string} groupId - 分组 ID
   */
  function collapseGroup(groupId) {
    collapsedGroups.add(groupId);
    const header = document.querySelector(`.group-header[data-group-id="${groupId}"]`);
    const list = document.querySelector(`.bookmarks-list[data-group-id="${groupId}"]`);
    if (header) {
      header.classList.add('collapsed');
    }
    if (list) {
      list.classList.add('collapsed');
    }
  }

  // 展开单个分组
  /**
   * @param {string} groupId - 分组 ID
   */
  function expandGroup(groupId) {
    collapsedGroups.delete(groupId);
    const header = document.querySelector(`.group-header[data-group-id="${groupId}"]`);
    const list = document.querySelector(`.bookmarks-list[data-group-id="${groupId}"]`);
    if (header) {
      header.classList.remove('collapsed');
    }
    if (list) {
      list.classList.remove('collapsed');
    }
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
    let currentContainer = bookmarkElement;
    while (currentContainer) {
      // 找到当前容器的父元素 .children-list (如果有的话)
      const parentChildrenList = currentContainer.closest('.children-list');
      if (!parentChildrenList) {
        break;
      }

      // 从 .children-list 获取 data-parent-id
      const parentBookmarkId = parentChildrenList.getAttribute('data-parent-id');
      if (!parentBookmarkId) {
        break;
      }

      // 展开父书签
      collapsedBookmarks.delete(parentBookmarkId);
      const parentContainer = document.querySelector(`.bookmark-container[data-bookmark-id="${parentBookmarkId}"]`);
      if (parentContainer) {
        parentContainer.classList.remove('collapsed');
        const childrenList = parentContainer.querySelector('.children-list');
        if (childrenList) {
          childrenList.classList.remove('collapsed');
        }
        currentContainer = parentContainer;
      } else {
        break;
      }
    }

    // 5. 移除所有其他 active 高亮
    document.querySelectorAll('.bookmark-container.active').forEach(container => {
      container.classList.remove('active');
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
