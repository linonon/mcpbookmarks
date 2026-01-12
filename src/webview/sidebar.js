/// <reference lib="dom" />
// @ts-check

// @ts-ignore
const marked = /** @type {any} */ (window).marked;
// @ts-ignore
const DOMPurify = /** @type {any} */ (window).DOMPurify;

/**
 * MCP Bookmarks Sidebar Webview Script
 * 处理侧边栏的渲染和交互逻辑
 */

(function () {

  // @ts-ignore
  const vscode = (/** @type {any} */ (window)).acquireVsCodeApi();

  // DOM Elements
  const bookmarksContainer = document.getElementById('bookmarks-container');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  const noResultsState = document.getElementById('no-results-state');
  const groupsList = document.getElementById('groups-list');
  const searchResults = document.getElementById('search-results');
  const contextMenu = document.getElementById('context-menu');

  if (!bookmarksContainer || !loadingState || !emptyState || !noResultsState || !groupsList || !searchResults || !contextMenu) {
    console.error('Required DOM elements not found');
    return;
  }

  // Header buttons
  // (view-style button removed, now controlled by VSCode toolbar)

  // State
  /**
   * @type {{
   *   groups: Array<{
   *     id: string;
   *     name: string;
   *     bookmarks: Array<any>;
   *     createdBy: string;
   *     description?: string;
   *   }>;
   *   viewMode: string;
   * }}
   */
  let currentData = { groups: [], viewMode: 'group' };
  
  /** @type {{ viewMode: 'nested' | 'tree' }} */
  let uiState = { viewMode: 'tree' }; // nested | tree

  // 尝试从持久化状态恢复 (完整状态)
  const savedState = vscode.getState();
  if (savedState) {
    if (savedState.viewMode) {
      uiState.viewMode = savedState.viewMode;
    }
  }

  /** @type {Set<string>} */
  let collapsedGroups = new Set(savedState?.collapsedGroups || []);

  /** @type {Set<string>} */
  let collapsedBookmarks = new Set(savedState?.collapsedBookmarks || []);

  /**
   * 保存完整状态到 VSCode webview state
   * 包括: viewMode, collapsedGroups, collapsedBookmarks, scrollPosition
   */
  function saveState() {
    const state = {
      viewMode: uiState.viewMode,
      collapsedGroups: Array.from(collapsedGroups),
      collapsedBookmarks: Array.from(collapsedBookmarks),
      scrollPosition: bookmarksContainer?.scrollTop || 0,
      timestamp: Date.now()
    };
    vscode.setState(state);
  }

  /**
   * 恢复滚动位置 (需要等待 DOM 渲染完成)
   */
  function restoreScrollPosition() {
    if (savedState?.scrollPosition && bookmarksContainer) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (bookmarksContainer) {
            bookmarksContainer.scrollTop = savedState.scrollPosition;
          }
        });
      });
    }
  }

  /** @type {{ type: 'group' | 'bookmark', id: string, groupId?: string } | null} */
  let contextMenuTarget = null;
  /** @type {{mode: string, targetBookmarkId: string, groupId: string, parentId: string|null}|null} */
  let addBookmarkContext = null;


  // ========================================
  // 资源预加载缓存系统
  // ========================================

  /** @type {Record<string, string>} */
  const cssCache = {};

  /** @type {Record<string, boolean>} */
  const jsCache = {};

  /**
   * 获取资源基础 URL
   * @returns {string}
   */
  function getBaseUrl() {
    const mainCssLink = /** @type {HTMLLinkElement | undefined} */ (Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .find(link => /** @type {HTMLLinkElement} */ (link).href.includes('sidebar.css')));

    if (mainCssLink) {
      const mainCssUrl = mainCssLink.href;
      return mainCssUrl.substring(0, mainCssUrl.lastIndexOf('/') + 1);
    }
    return '';
  }

  /**
   * 预加载所有视图模式资源 (CSS 和 JS)
   * 在初始化时并行加载,切换时直接使用缓存
   * @returns {Promise<void>}
   */
  async function preloadAllResources() {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      console.warn('[Preload] Could not determine base URL, skipping preload');
      return;
    }

    const modes = ['nested', 'tree'];
    const preloadPromises = [];

    // 并行预加载所有 CSS
    for (const mode of modes) {
      const cssFileName = mode === 'tree' ? 'sidebar-tree.css' : 'sidebar-nested.css';
      const cssUrl = baseUrl + cssFileName;

      preloadPromises.push(
        fetch(cssUrl)
          .then(response => response.text())
          .then(cssText => {
            cssCache[mode] = cssText;
          })
          .catch(error => {
            console.error(`[Preload] Failed to cache ${mode} CSS:`, error);
          })
      );
    }

    // 并行预加载所有 JS
    for (const mode of modes) {
      const jsFileName = mode === 'tree' ? 'sidebar-tree.js' : 'sidebar-nested.js';
      const jsUrl = baseUrl + jsFileName;

      preloadPromises.push(
        new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = jsUrl;
          script.dataset.mode = mode;
          script.style.display = 'none'; // 隐藏但加载
          script.onload = () => {
            jsCache[mode] = true;
            resolve(undefined);
          };
          script.onerror = (error) => {
            console.error(`[Preload] Failed to cache ${mode} JS:`, error);
            reject(error);
          };
          document.head.appendChild(script);
        })
      );
    }

    try {
      await Promise.all(preloadPromises);
    } catch (error) {
      console.error('[Preload] Some resources failed to preload:', error);
    }
  }

  /**
   * 动态加载模式特定的 CSS 文件 (使用缓存优化)
   * @param {string} mode - 视图模式 ('nested' | 'tree')
   */
  function loadModeSpecificCSS(mode) {
    // 移除之前加载的模式特定 CSS
    const existingModeCSS = document.getElementById('mode-specific-css');
    if (existingModeCSS) {
      existingModeCSS.remove();
    }

    // 优先使用缓存的 CSS (通过 <style> 标签注入,比 <link> 更快)
    if (cssCache[mode]) {
      const style = document.createElement('style');
      style.id = 'mode-specific-css';
      style.textContent = cssCache[mode];
      document.head.appendChild(style);
      return;
    }

    // 缓存未命中,回退到动态加载
    const baseUrl = getBaseUrl();
    const link = document.createElement('link');
    link.id = 'mode-specific-css';
    link.rel = 'stylesheet';
    const fileName = mode === 'tree' ? 'sidebar-tree.css' : 'sidebar-nested.css';
    link.href = baseUrl + fileName;
    document.head.appendChild(link);

  }

  /**
   * 动态加载模式特定的 JS 文件 (使用缓存优化)
   * @param {string} mode - 视图模式 ('nested' | 'tree')
   * @returns {Promise<void>}
   */
  function loadModeSpecificJS(mode) {
    // 优先使用缓存 (JS 已在预加载时执行,无需重新加载)
    if (jsCache[mode]) {
      return Promise.resolve(undefined);
    }

    // 缓存未命中,回退到动态加载
    return new Promise((resolve, reject) => {
      const baseUrl = getBaseUrl();
      const script = document.createElement('script');
      script.id = 'mode-specific-js';
      const fileName = mode === 'tree' ? 'sidebar-tree.js' : 'sidebar-nested.js';
      script.src = baseUrl + fileName;
      script.onload = () => {
        jsCache[mode] = true; // 更新缓存
        resolve(undefined);
      };
      script.onerror = (error) => {
        console.error(`[JS] Failed to load ${mode} JS:`, error);
        reject(error);
      };
      document.head.appendChild(script);
    });
  }

  // 初始化
  async function init() {

    // 恢复容器 class
    if (bookmarksContainer) {
      if (uiState.viewMode === 'tree') {
        bookmarksContainer.classList.add('view-mode-tree');
      } else {
        bookmarksContainer.classList.remove('view-mode-tree');
      }
    }

    // 加载默认模式的 CSS 和 JS
    loadModeSpecificCSS(uiState.viewMode);
    await loadModeSpecificJS(uiState.viewMode);
    setupEventListeners();

    // 在后台预加载所有资源 (不阻塞初始化)
    preloadAllResources().catch(error => {
      console.error('[INIT] Resource preload failed:', error);
    });

    // 通知 Extension 已准备好
    vscode.postMessage({ type: 'ready' });
  }

  /**
   * 更新字体大小 CSS 变量
   * @param {Object} config - 字体配置对象
   * @param {number} config.title - 标题字体大小
   * @param {number} config.description - 描述字体大小
   * @param {number} config.groupName - 分组标题字体大小
   * @param {number} config.location - 位置字体大小
   */
  function updateFontSize(config) {
    const root = document.documentElement;
    root.style.setProperty('--font-size-title', `${config.title}px`);
    root.style.setProperty('--font-size-description', `${config.description}px`);
    root.style.setProperty('--font-size-group-name', `${config.groupName}px`);
    root.style.setProperty('--font-size-location', `${config.location}px`);
  }

  /**
   * 更新层级颜色 CSS 变量
   * @param {any} config - 颜色配置对象
   */
  function updateHierarchyColors(config) {
    const root = document.documentElement;
    for (let i = 0; i <= 7; i++) {
      const color = config[`depth${i}`];
      if (color) {
        root.style.setProperty(`--depth-${i}-color`, color);
      }
    }
  }

  // 设置事件监听
  function setupEventListeners() {

    // 全局点击 (关闭 context menu)
    document.addEventListener('click', () => {
      hideContextMenu();
    });

    // 阻止 context menu 内部点击传播
    if (contextMenu) {
      contextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

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
        const saveBtn = /** @type {HTMLButtonElement|null} */ (document.querySelector('.form-btn-save'));
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
        break;
      case 'groupValidationError':
        // 显示分组验证错误提示，重新启用保存按钮
        if (message.field && message.error) {
          showError(message.field, message.error);
        }
        // 重新启用按钮
        const groupSaveBtn = /** @type {HTMLButtonElement|null} */ (document.querySelector('.group-edit-form .form-btn-save'));
        if (groupSaveBtn) {
          groupSaveBtn.disabled = false;
          groupSaveBtn.textContent = 'Save';
        }
        break;
      case 'updateFontSize':
        if (message.config) {
          updateFontSize(message.config);
        }
        break;
      case 'updateHierarchyColors':
        if (message.config) {
          updateHierarchyColors(message.config);
        }
        break;
      case 'toggleViewMode':
        // 切换视图模式
        if (message.viewStyle) {
          uiState.viewMode = message.viewStyle;
        } else {
          uiState.viewMode = uiState.viewMode === 'nested' ? 'tree' : 'nested';
        }

        // 保存完整状态 (包括 collapsed groups/bookmarks)
        saveState();

        // 🚀 性能优化: 只加载 CSS,不重建 DOM
        // CSS 切换足以改变视图外观,无需完全重建 DOM 树
        loadModeSpecificCSS(uiState.viewMode);

        // 预加载另一个模式的 JS (后台加载,不阻塞)
        loadModeSpecificJS(uiState.viewMode).catch(error => {
          console.error('[Toggle View Mode] Failed to preload mode JS:', error);
        });

        // 更新容器 class
        if (bookmarksContainer) {
          if (uiState.viewMode === 'tree') {
            bookmarksContainer.classList.add('view-mode-tree');
          } else {
            bookmarksContainer.classList.remove('view-mode-tree');
          }

          // 使用 CSS 过渡替代强制重排
          bookmarksContainer.classList.add('view-transitioning');
          requestAnimationFrame(() => {
            bookmarksContainer.classList.remove('view-transitioning');
          });
        }
        break;
    }
  });

  // 处理刷新数据
  /** @param {any} data */
  function handleRefresh(data) {

    // 同步视图模式 (从 Extension 同步)
    if (data.viewStyle && data.viewStyle !== uiState.viewMode) {
      uiState.viewMode = data.viewStyle;
      vscode.setState({ viewMode: uiState.viewMode });
      
      // 重新加载 CSS 和 JS
      loadModeSpecificCSS(uiState.viewMode);
      loadModeSpecificJS(uiState.viewMode).then(() => {
        currentData = data;
        renderGroups(data.groups);
      });

      // 更新容器 class
      if (bookmarksContainer) {
        if (uiState.viewMode === 'tree') {
          bookmarksContainer.classList.add('view-mode-tree');
        } else {
          bookmarksContainer.classList.remove('view-mode-tree');
        }
      }
      return;
    }

    currentData = data;
    renderGroups(data.groups);
  }

  // 渲染分组列表
  /** @param {any[]} groups */
  function renderGroups(groups) {
    if (!loadingState || !emptyState || !noResultsState || !searchResults || !groupsList) return;

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

    // 🚀 事件委托优化: click 事件通过 handleBookmarkClick 委托
    // 只绑定无法冒泡的 contextmenu 事件
    bindGroupEvents();
    bindBookmarkEvents();

    // DOM 渲染完成后恢复滚动位置
    restoreScrollPosition();
  }

  // 渲染单个分组
  /** @param {any} group */
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
            <span class="group-name">${escapeHtml(group.title)}</span>
            ${group.description ? `
              <div class="group-description-wrapper">
                <button class="group-description-toggle-btn" data-group-id="${escapeHtml(group.id)}" title="Expand/Collapse">
                  <span class="icon icon-expand"></span>
                </button>
                <div class="group-description"
                     data-group-id="${escapeHtml(group.id)}"
                     data-markdown="${escapeHtml(group.description)}">
                  ${renderMarkdown(group.description)}
                </div>
              </div>
            ` : ''}
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
  /** @param {any[]} bookmarks */
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
  /**
   * @param {any[]} bookmarks
   * @param {string} groupId
   * @param {string|null} parentId
   * @param {number} depth
   * @returns {string}
   */
  function renderBookmarkTree(bookmarks, groupId, parentId, depth) {
    if (!bookmarks || bookmarks.length === 0) return '';

    // 过滤出当前层级的书签
    const currentLevelBookmarks = bookmarks.filter(b =>
      parentId ? b.parentId === parentId : !b.parentId
    );

    // 按 order 排序
    currentLevelBookmarks.sort((a, b) => (a.order || 0) - (b.order || 0));

    return currentLevelBookmarks.map((bookmark, index) => {
      const hasChildren = bookmarks.some(b => b.parentId === bookmark.id);
      const isCollapsed = collapsedBookmarks.has(bookmark.id);
      const displayBookmark = {
        ...bookmark,
        displayOrder: index + 1
      };

      // 获取子书签
      /** @type {string} */
      const childrenHtml = hasChildren
        ? renderBookmarkTree(bookmarks, groupId, bookmark.id, depth + 1)
        : '';

      return renderBookmark(displayBookmark, groupId, depth, hasChildren, isCollapsed, childrenHtml);
    }).join('');
  }

  // 渲染单个书签 - 嵌套包裹结构
  /**
   * @param {any} bookmark
   * @param {string} groupId
   * @param {number} depth
   * @param {boolean} hasChildren
   * @param {boolean} isCollapsed
   * @param {string} childrenHtml
   * @returns {string}
   */
  function renderBookmark(bookmark, groupId, depth, hasChildren, isCollapsed, childrenHtml) {
    const category = bookmark.category || 'note';
    const displayOrder = getBookmarkDisplayOrder(bookmark);
    const orderBadgeHtml = Number.isFinite(displayOrder)
      ? `<span class="order-badge">${displayOrder}</span>`
      : '';

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
            ${orderBadgeHtml}
            <div class="bookmark-title-location">
              <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
              <span class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</span>
            </div>
          </div>
        `;
      } else {
        headerHtml = (/** @type {any} */ (window)).renderBookmarkHeaderTree(bookmark, hasChildren, isCollapsed, depth);
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
            ${orderBadgeHtml}
            <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
            <span class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</span>
          </div>
        `;
      } else {
        headerHtml = (/** @type {any} */ (window)).renderBookmarkHeaderNested(bookmark, hasChildren, isCollapsed);
      }
    }

    return `
      <div class="bookmark-container ${hasChildren ? 'has-children' : ''} ${isCollapsed ? 'collapsed' : ''}"
           data-bookmark-id="${escapeHtml(bookmark.id)}"
           data-group-id="${escapeHtml(groupId)}"
           data-depth="${depth}"
           style="--indent-level: ${depth}">
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
  /** @param {string} location */
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

  /**
   * 获取用于显示的顺序号
   * @param {any} bookmark
   * @returns {number|undefined}
   */
  function getBookmarkDisplayOrder(bookmark) {
    if (!bookmark) return undefined;
    if (Number.isFinite(bookmark.displayOrder)) return bookmark.displayOrder;
    if (Number.isFinite(bookmark.order)) return bookmark.order;
    return undefined;
  }

  // 暴露工具函数到全局作用域 (供外部渲染文件使用)
  /** @type {any} */ (window).escapeHtml = escapeHtml;
  /** @type {any} */ (window).getBookmarkDisplayOrder = getBookmarkDisplayOrder;
  /** @type {any} */ (window).formatLocation = formatLocation;

  // 处理所有点击事件 (事件委托优化)
  /** @param {MouseEvent} e */
  function handleBookmarkClick(e) {
    hideContextMenu(); // 关闭可能打开的右键菜单

    // 检查是否点击了 group description 展开/折叠按钮 (优先级最高, 在 group-header 之前)
    const groupToggleBtn = /** @type {HTMLElement} */ (e.target).closest('.group-description-toggle-btn');
    if (groupToggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const groupId = groupToggleBtn.getAttribute('data-group-id');
      const descElement = document.querySelector(`.group-description[data-group-id="${groupId}"]`);
      const icon = groupToggleBtn.querySelector('.icon');

      if (descElement && icon) {
        const isExpanded = descElement.classList.toggle('expanded');
        icon.className = isExpanded ? 'icon icon-collapse' : 'icon icon-expand';
      }
      return;
    }

    // 检查是否点击了 group description 区域 (阻止冒泡到 group-header)
    const groupDescWrapper = /** @type {HTMLElement} */ (e.target).closest('.group-description-wrapper');
    if (groupDescWrapper) {
      e.stopPropagation();
      return;
    }

    // 🚀 事件委托优化: 检查是否点击了 group header
    const groupHeader = /** @type {HTMLElement} */ (e.target).closest('.group-header');
    if (groupHeader) {
      e.stopPropagation();
      const groupId = groupHeader.getAttribute('data-group-id');
      if (groupId) {
        toggleGroup(groupId);
      }
      return;
    }

    // 检查是否点击了文件链接
    const fileLink = /** @type {HTMLElement} */ (e.target).closest('.file-link');
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
    const chevron = /** @type {HTMLElement} */ (e.target).closest('.bookmark-chevron');
    if (chevron) {
      e.preventDefault();
      e.stopPropagation();
      const container = chevron.closest('.bookmark-container');
      const bookmarkId = container?.getAttribute('data-bookmark-id');
      if (bookmarkId) {
        toggleBookmark(bookmarkId);
      }
      return;
    }

    // 检查是否点击了 bookmark description 展开/折叠按钮
    const toggleBtn = /** @type {HTMLElement} */ (e.target).closest('.bookmark-toggle-btn');
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
    const editForm = /** @type {HTMLElement} */ (e.target).closest('.bookmark-edit-form');
    if (editForm) {
      // 点击表单区域不触发任何操作
      e.stopPropagation();
      return;
    }

    // 检查是否点击了 description 区域
    const descElement = /** @type {HTMLElement} */ (e.target).closest('.bookmark-description');
    if (descElement) {
      // 点击 description 不跳转
      return;
    }

    // 检查是否点击了书签项
    const bookmarkItem = /** @type {HTMLElement} */ (e.target).closest('.bookmark-item');
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

  // 绑定分组右键菜单事件 (contextmenu 无法冒泡,必须单独绑定)
  // 🚀 事件委托优化: click 事件已移除,通过 handleBookmarkClick 委托处理
  function bindGroupEvents() {
    document.querySelectorAll('.group-header').forEach(el => {
      const header = /** @type {HTMLElement} */ (el);
      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const groupId = header.getAttribute('data-group-id');
        if (groupId) showGroupContextMenu(e, groupId);
      });
    });
  }

  // 绑定书签事件
  function bindBookmarkEvents() {
    // 只绑定 contextmenu 事件（不会冒泡，必须单独绑定）
    // 其他事件（click）已通过事件委托在 groupsList 上处理
    document.querySelectorAll('.bookmark-item').forEach(el => {
      const item = /** @type {HTMLElement} */ (el);
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // data-* 属性在父元素 .bookmark-container 上
        const container = item.closest('.bookmark-container');
        if (!container) return;

        const bookmarkId = container.getAttribute('data-bookmark-id');
        const groupId = container.getAttribute('data-group-id');
        if (bookmarkId && groupId) showBookmarkContextMenu(e, bookmarkId, groupId);
      });
    });
  }

  // 切换分组展开/折叠
  /** @param {string} groupId */
  function toggleGroup(groupId) {
    const header = document.querySelector(`.group-header[data-group-id="${groupId}"]`);
    const list = document.querySelector(`.bookmarks-list[data-group-id="${groupId}"]`);

    if (!header || !list) return;

    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
      header.classList.remove('collapsed');
      list.classList.remove('collapsed');
    } else {
      collapsedGroups.add(groupId);
      header.classList.add('collapsed');
      list.classList.add('collapsed');
    }

    // 保存状态
    saveState();

    vscode.postMessage({ type: 'toggleGroup', groupId, expanded: !collapsedGroups.has(groupId) });
  }

  // 切换书签展开/折叠
  /** @param {string} bookmarkId */
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

    // 保存状态
    saveState();

    vscode.postMessage({ type: 'toggleBookmark', bookmarkId, expanded: !collapsedBookmarks.has(bookmarkId) });
  }

  /**
   * 进入全字段编辑模式
   * @param {string} bookmarkId - 书签 ID
   */
  function enterFullEditMode(bookmarkId) {
    // 查找书签数据
    /** @type {any} */
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
    const saveBtn = /** @type {HTMLButtonElement} */ (bookmarkContent.querySelector('.form-btn-save'));
    const cancelBtn = /** @type {HTMLButtonElement} */ (bookmarkContent.querySelector('.form-btn-cancel'));
    const titleInput = /** @type {HTMLInputElement} */ (bookmarkContent.querySelector('#edit-title'));
    const locationInput = /** @type {HTMLInputElement} */ (bookmarkContent.querySelector('#edit-location'));
    const descriptionTextarea = /** @type {HTMLTextAreaElement} */ (bookmarkContent.querySelector('#edit-description'));

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
      if (bookmarkContent) {
        bookmarkContent.innerHTML = originalHTML;
      }
      // 重新绑定事件
      bindBookmarkEvents();
    }

    // 绑定事件
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);

    // 快捷键
    /** @param {KeyboardEvent} e */
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
   * @param {any} bookmark - 书签对象
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
   * @returns {{isValid: boolean, errors: Record<string, string>}} 验证结果
   */
  function validateInputs(title, location, description) {
    /** @type {Record<string, string>} */
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

  // ============ 分组编辑功能 ============

  /**
   * 进入分组编辑模式
   * @param {string} groupId - 分组 ID
   */
  function enterGroupEditMode(groupId) {
    // 查找分组数据
    const group = currentData.groups.find(g => g.id === groupId);
    if (!group) {
      console.warn('Cannot find group:', groupId);
      return;
    }

    // 找到分组容器
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) {
      console.warn('Cannot find group element');
      return;
    }

    const groupHeader = groupElement.querySelector('.group-header');
    if (!groupHeader) {
      console.warn('Cannot find group header');
      return;
    }

    // 保存原始 HTML
    const originalHTML = groupHeader.innerHTML;

    // 创建编辑表单
    const formHTML = createGroupEditForm(group);
    groupHeader.innerHTML = formHTML;

    // 阻止表单点击事件冒泡
    const formElement = groupHeader.querySelector('.group-edit-form');
    if (formElement) {
      formElement.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // 绑定保存和取消事件
    const saveBtn = /** @type {HTMLButtonElement} */ (groupHeader.querySelector('.form-btn-save'));
    const cancelBtn = /** @type {HTMLButtonElement} */ (groupHeader.querySelector('.form-btn-cancel'));
    const titleInput = /** @type {HTMLInputElement} */ (groupHeader.querySelector('#edit-group-title'));
    const descriptionTextarea = /** @type {HTMLTextAreaElement} */ (groupHeader.querySelector('#edit-group-description'));

    if (!saveBtn || !cancelBtn || !titleInput || !descriptionTextarea) {
      console.warn('Cannot find form elements');
      groupHeader.innerHTML = originalHTML;
      return;
    }

    // 保存函数
    function save() {
      const title = titleInput.value.trim();
      const description = descriptionTextarea.value.trim();

      // 前端验证
      const validation = validateGroupInputs(title, description);
      if (!validation.isValid) {
        // 显示错误
        for (const [field, error] of Object.entries(validation.errors)) {
          showError(field, error);
        }
        return;
      }

      // 清除所有错误
      clearGroupErrors();

      // 禁用保存按钮
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      // 发送更新消息
      vscode.postMessage({
        type: 'updateGroupFull',
        groupId: groupId,
        updates: { title, description }
      });

      // 注意: 成功后会收到 refresh 消息，不需要手动恢复
    }

    // 取消函数
    function cancel() {
      if (groupHeader) {
        groupHeader.innerHTML = originalHTML;
      }
      // 重新绑定事件
      bindGroupEvents();
    }

    // 绑定事件
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);

    // 快捷键
    /** @param {KeyboardEvent} e */
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
   * 创建分组编辑表单 HTML
   * @param {any} group - 分组对象
   * @returns {string} 表单 HTML
   */
  function createGroupEditForm(group) {
    const bookmarkCount = (group.bookmarks || []).length;
    const createdDate = new Date(group.createdAt).toLocaleString();

    return `
      <div class="group-edit-form">
        <div class="form-field">
          <label class="form-label">Title *</label>
          <input type="text" class="form-input" id="edit-group-title" value="${escapeHtml(group.title)}" maxlength="200">
          <div class="form-error" id="error-group-title"></div>
        </div>

        <div class="form-field">
          <label class="form-label">Description</label>
          <textarea class="form-textarea" id="edit-group-description" maxlength="10000">${escapeHtml(group.description || '')}</textarea>
          <div class="form-error" id="error-group-description"></div>
        </div>

        <div class="form-info-section">
          <div class="form-info-row">
            <label>Created by:</label>
            <span class="form-info-value">${group.createdBy === 'ai' ? 'AI' : 'User'}</span>
          </div>

          <div class="form-info-row">
            <label>Created at:</label>
            <span class="form-info-value">${createdDate}</span>
          </div>

          <div class="form-info-row">
            <label>Bookmarks:</label>
            <span class="form-info-value">${bookmarkCount} bookmark${bookmarkCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div class="form-actions">
          <button class="form-btn-save">Save</button>
          <button class="form-btn-cancel">Cancel</button>
        </div>
      </div>
    `;
  }

  /**
   * 验证分组输入
   * @param {string} title - 分组标题
   * @param {string} description - 分组说明
   * @returns {{isValid: boolean, errors: Record<string, string>}} 验证结果
   */
  function validateGroupInputs(title, description) {
    /** @type {Record<string, string>} */
    const errors = {};

    // Title 验证
    if (!title) {
      errors['error-group-title'] = 'Title is required';
    } else if (title.length > 200) {
      errors['error-group-title'] = 'Title is too long (max 200 characters)';
    }

    // Description 验证
    if (description.length > 10000) {
      errors['error-group-description'] = 'Description is too long (max 10000 characters)';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * 清除分组编辑表单的所有错误
   */
  function clearGroupErrors() {
    ['error-group-title', 'error-group-description'].forEach(clearError);
  }

  // 显示分组右键菜单
  /**
   * @param {MouseEvent} e
   * @param {string} groupId
   */
  function showGroupContextMenu(e, groupId) {
    if (!contextMenu) return;
    contextMenuTarget = { type: 'group', id: groupId };
    contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="editGroup">
        <span class="codicon codicon-edit"></span>
        <span>Edit Group</span>
      </div>
      <div class="context-menu-item" data-action="copyGroupInfo">
        <span class="codicon codicon-copy"></span>
        <span>Copy ID and Title</span>
      </div>
      <div class="context-menu-item" data-action="copyGroupAsMarkdown">
        <span class="codicon codicon-markdown"></span>
        <span>Copy as Markdown</span>
      </div>
      <div class="context-menu-item" data-action="copyGroupInfoAsMarkdown">
        <span class="codicon codicon-note"></span>
        <span>Copy as Markdown (Info Only)</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="addGroupBookmark">
        <span class="codicon codicon-add"></span>
        <span>Add Bookmark</span>
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
  /**
   * @param {MouseEvent} e
   * @param {string} bookmarkId
   * @param {string} groupId
   */
  function showBookmarkContextMenu(e, bookmarkId, groupId) {
    if (!contextMenu) return;
    contextMenuTarget = { type: 'bookmark', id: bookmarkId, groupId };

    // 检测是否有子节点
    let hasChildren = false;
    const group = currentData.groups.find(g => g.id === groupId);
    if (group && group.bookmarks) {
      // 在扁平列表中查找是否有以当前书签为父节点的书签
      hasChildren = group.bookmarks.some(b => b.parentId === bookmarkId);
    }

    // 根据是否有子节点生成不同的 Markdown 菜单项
    const markdownMenuItems = hasChildren ? `
      <div class="context-menu-item" data-action="copyBookmarkAsMarkdown">
        <span class="codicon codicon-markdown"></span>
        <span>Copy All as Markdown</span>
      </div>
      <div class="context-menu-item" data-action="copyBookmarkAsMarkdownOnly">
        <span class="codicon codicon-note"></span>
        <span>Copy as Markdown (This Only)</span>
      </div>
    ` : `
      <div class="context-menu-item" data-action="copyBookmarkAsMarkdown">
        <span class="codicon codicon-markdown"></span>
        <span>Copy as Markdown</span>
      </div>
    `;

    contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="editBookmark">
        <span class="codicon codicon-edit"></span>
        <span>Edit Bookmark</span>
      </div>
      <div class="context-menu-item" data-action="copyBookmarkInfo">
        <span class="codicon codicon-copy"></span>
        <span>Copy ID and Title</span>
      </div>
      ${markdownMenuItems}
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
  /**
   * @param {number} x
   * @param {number} y
   */
  function showContextMenu(x, y) {
    if (!contextMenu) return;
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
    if (contextMenu) {
      contextMenu.style.display = 'none';
    }
    contextMenuTarget = null;
  }

  // 查找书签 (递归搜索包括子书签)
  /**
   * @param {string} bookmarkId
   * @param {any[]} bookmarks
   * @returns {any}
   */
  function findBookmarkById(bookmarkId, bookmarks) {
    // 直接在扁平列表中查找,不需要递归 (数据使用 parentId 而非 children)
    return bookmarks.find(b => b.id === bookmarkId) || null;
  }

  // 复制书签信息到剪贴板
  /** @param {string} bookmarkId */
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

  // 复制分组信息到剪贴板
  /** @param {string} groupId */
  function copyGroupInfo(groupId) {
    const group = currentData.groups.find(g => g.id === groupId);
    if (group) {
      const info = `${group.title}(${group.id})`;
      navigator.clipboard.writeText(info).then(() => {
        vscode.postMessage({ type: 'showInfo', message: 'Group ID copied to clipboard' });
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    }
  }

  // 复制相对路径到剪贴板
  /** @param {string} bookmarkId */
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
  /** @param {string} bookmarkId */
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

  // ==================== Markdown 生成和复制函数 ====================

  /**
   * 将书签转换为 Markdown 格式
   * @param {any} bookmark - 书签对象
   * @param {any[]} allBookmarks - 所有书签列表(用于查找子节点)
   * @param {number} level - 标题层级 (2 = ##, 3 = ###, ...)
   * @param {boolean} includeChildren - 是否包含子节点
   * @returns {string} Markdown 文本
   */
  function bookmarkToMarkdown(bookmark, allBookmarks, level = 2, includeChildren = true) {
    const heading = '#'.repeat(level);
    let md = `${heading} ${bookmark.title}\n\n`;
    md += `**Location**: [${bookmark.location}](${bookmark.location})\n\n`;

    if (bookmark.description) {
      md += `${bookmark.description}\n`;
    }

    if (includeChildren) {
      // 在所有书签中查找子节点
      const children = allBookmarks
        .filter(b => b.parentId === bookmark.id)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      
      if (children.length > 0) {
        for (const child of children) {
          md += '\n' + bookmarkToMarkdown(child, allBookmarks, level + 1, true);
        }
      }
    }

    return md;
  }

  /**
   * 将 Group 转换为 Markdown 格式 (完整版, 包含所有书签)
   * @param {any} group - 分组对象
   * @returns {string} Markdown 文本
   */
  function groupToMarkdown(group) {
    let md = `# ${group.title}\n\n`;

    if (group.description) {
      md += `> ${group.description}\n\n`;
    }

    if (group.bookmarks && group.bookmarks.length > 0) {
      // 只处理顶层书签 (没有 parentId 的)
      const topLevel = group.bookmarks.filter((/** @type {any} */ b) => !b.parentId);
      for (const bookmark of topLevel) {
        md += bookmarkToMarkdown(bookmark, group.bookmarks, 2, true) + '\n';
      }
    }

    return md.trim();
  }

  /**
   * 将 Group 转换为 Markdown 格式 (仅信息)
   * @param {any} group - 分组对象
   * @returns {string} Markdown 文本
   */
  function groupInfoToMarkdown(group) {
    let md = `# ${group.title}\n\n`;

    if (group.description) {
      md += `> ${group.description}\n\n`;
    }

    const createdDate = group.createdAt ? new Date(group.createdAt).toLocaleDateString() : 'Unknown';
    md += `- **Created**: ${createdDate}\n`;
    md += `- **Created By**: ${group.createdBy || 'Unknown'}\n`;
    md += `- **Bookmarks**: ${group.bookmarks?.length || 0}\n`;

    return md.trim();
  }

  /**
   * 复制书签为 Markdown
   * @param {string} bookmarkId
   * @param {boolean} includeChildren - 是否包含子节点
   */
  function copyBookmarkAsMarkdown(bookmarkId, includeChildren = true) {
    for (const group of currentData.groups) {
      const bookmark = findBookmarkById(bookmarkId, group.bookmarks || []);
      if (bookmark) {
        const md = bookmarkToMarkdown(bookmark, group.bookmarks, 2, includeChildren);
        // 检查实际的子书签 (通过 parentId 而非 children 字段)
        const hasChildren = group.bookmarks.some(b => b.parentId === bookmark.id);
        navigator.clipboard.writeText(md).then(() => {
          vscode.postMessage({
            type: 'showInfo',
            message: includeChildren && hasChildren
              ? 'Bookmark (with children) copied as Markdown'
              : 'Bookmark copied as Markdown'
          });
        }).catch(err => {
          console.error('Failed to copy:', err);
        });
        return;
      }
    }
  }

  /**
   * 复制 Group 为 Markdown
   * @param {string} groupId
   * @param {boolean} includeBookmarks - 是否包含书签
   */
  function copyGroupAsMarkdown(groupId, includeBookmarks = true) {
    const group = currentData.groups.find(g => g.id === groupId);
    if (group) {
      const md = includeBookmarks ? groupToMarkdown(group) : groupInfoToMarkdown(group);
      navigator.clipboard.writeText(md).then(() => {
        vscode.postMessage({
          type: 'showInfo',
          message: includeBookmarks ? 'Group copied as Markdown' : 'Group info copied as Markdown'
        });
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    }
  }

  // ==================== 书签添加功能 ====================

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
   * 在分组末尾添加顶层书签
   * @param {string} groupId - 分组 ID
   */
  function addGroupBookmark(groupId) {
    addBookmarkContext = {
      mode: 'group',
      targetBookmarkId: '', // 无目标书签
      groupId: groupId,
      parentId: null
    };

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
   * @param {string | undefined} error - 错误信息
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
    if (!contextMenu) return;
    contextMenu.querySelectorAll('.context-menu-item').forEach(el => {
      const item = /** @type {HTMLElement} */ (el);
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        if (action) handleContextMenuAction(action);
        hideContextMenu();
      });
    });
  }

  // 处理 context menu 动作
  /** @param {string} action */
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
      case 'copyBookmarkAsMarkdown':
        copyBookmarkAsMarkdown(contextMenuTarget.id, true);
        break;
      case 'copyBookmarkAsMarkdownOnly':
        copyBookmarkAsMarkdown(contextMenuTarget.id, false);
        break;
      case 'addBookmarkAfter':
        if (contextMenuTarget.type === 'bookmark' && contextMenuTarget.groupId) {
          addBookmarkAfter(contextMenuTarget.id, contextMenuTarget.groupId);
        }
        break;
      case 'addChildBookmark':
        if (contextMenuTarget.type === 'bookmark' && contextMenuTarget.groupId) {
          addChildBookmark(contextMenuTarget.id, contextMenuTarget.groupId);
        }
        break;
      case 'editGroup':
        // 直接进入编辑模式
        enterGroupEditMode(contextMenuTarget.id);
        break;
      case 'addGroupBookmark':
        if (contextMenuTarget.type === 'group') {
          addGroupBookmark(contextMenuTarget.id);
        }
        break;
      case 'copyGroupInfo':
        copyGroupInfo(contextMenuTarget.id);
        break;
      case 'copyGroupAsMarkdown':
        copyGroupAsMarkdown(contextMenuTarget.id, true);
        break;
      case 'copyGroupInfoAsMarkdown':
        copyGroupAsMarkdown(contextMenuTarget.id, false);
        break;
      case 'deleteGroup':
        vscode.postMessage({ type: 'deleteGroup', groupId: contextMenuTarget.id });
        break;
    }
  }



  // 处理搜索结果
  /** @param {any} data */
  function handleSearchResults(data) {
    if (!loadingState || !emptyState || !groupsList || !noResultsState || !searchResults) return;

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
    searchResults.innerHTML = data.results.map((/** @type {any} */ result) => renderSearchResult(result)).join('');

    // 绑定搜索结果点击事件
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const bookmarkId = item.getAttribute('data-bookmark-id');
        if (bookmarkId) {
          vscode.postMessage({ type: 'jumpToBookmark', bookmarkId });
        }
      });
    });
  }

  // 渲染搜索结果项
  /** @param {any} result */
  function renderSearchResult(result) {
    const { bookmark, group } = result;
    const category = bookmark.category || 'note';

    return `
      <div class="search-result-item"
           data-bookmark-id="${escapeHtml(bookmark.id)}"
           data-category="${escapeHtml(category)}">
        <div class="search-result-title">${escapeHtml(bookmark.title)}</div>
        <div class="search-result-group">${escapeHtml(group.title)}</div>
        <div class="search-result-location">${escapeHtml(formatLocation(bookmark.location))}</div>
      </div>
    `;
  }

  // 处理键盘事件
  /** @param {KeyboardEvent} e */
  function handleKeyDown(e) {
    // Escape 关闭 context menu
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  }

  // 工具函数: 防抖
  /**
   * @param {Function} fn
   * @param {number} delay
   * @returns {Function}
   */
  function debounce(fn, delay) {
    /** @type {any} */
    let timer = null;
    return (
      /**
       * @this {any}
       * @param {any[]} args
       */
      function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      }
    );
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
      const renderer = new (/** @type {any} */ (marked).Renderer)();
      
      // 自定义链接渲染: 将 [text](path) 或 [text](path:line) 转换为可点击的链接
      /** 
       * @param {string} href 
       * @param {string} title 
       * @param {string} text 
       */
      renderer.link = function(href, title, text) {
        // 解析文件路径和行号
        let filePath = href || '';
        /** @type {number | undefined} */
        let line = undefined;
        
        const colonIndex = filePath.lastIndexOf(':');
        if (colonIndex > 0) {
          const beforeColon = filePath.substring(0, colonIndex);
          const afterColon = filePath.substring(colonIndex + 1);
          
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
      /** @type {any} */ (marked).setOptions({
        breaks: true,        // 支持换行
        gfm: true,          // GitHub Flavored Markdown
        headerIds: false,   // 禁用标题 ID
        mangle: false,      // 禁用邮箱混淆
        renderer: renderer
      });

      // 渲染 Markdown
      const rawHtml = /** @type {any} */ (marked).parse(markdown);

      // DOMPurify 清理 - 现在允许 <a> 标签和 data- 属性
      const cleanHtml = /** @type {any} */ (DOMPurify).sanitize(rawHtml, {
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
  /**
   * @param {string} str
   * @param {number} maxLength
   */
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

    // 保存状态
    saveState();
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

    // 保存状态
    saveState();
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

    // 保存状态
    saveState();
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

    // 保存状态
    saveState();
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
    /** @type {HTMLElement | null} */
    let currentContainer = /** @type {HTMLElement} */ (bookmarkElement);
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
      const parentContainer = /** @type {HTMLElement | null} */ (document.querySelector(`.bookmark-container[data-bookmark-id="${parentBookmarkId}"]`));
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

    // 保存状态 (展开了 group 和父书签)
    saveState();

    // 7. 滚动到书签位置
    setTimeout(() => {
      bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // 启动
  init();
})();
