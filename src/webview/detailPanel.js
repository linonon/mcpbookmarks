// @ts-check

(function() {
  // 获取 VSCode API
  const vscode = acquireVsCodeApi();

  // 当前书签数据
  let currentBookmark = null;

  /**
   * 监听来自扩展的消息
   */
  window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
      case 'init':
      case 'update':
        currentBookmark = message.data;
        renderBookmark(message.data);
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  });

  /**
   * 渲染书签数据到 UI
   */
  function renderBookmark(data) {
    const { bookmark, group, parent, children, hasChildren } = data;

    // Header - Title and Order
    document.getElementById('bookmark-title').textContent = bookmark.title;
    document.getElementById('bookmark-order').textContent = `#${bookmark.order}`;

    // Location
    document.getElementById('bookmark-location').textContent = bookmark.location;

    // Description (核心: 多行显示)
    document.getElementById('bookmark-description').textContent = bookmark.description || 'No description provided.';

    // Category
    renderCategory(bookmark.category);

    // Hierarchy
    renderHierarchy(parent, children, hasChildren);

    // Group
    document.getElementById('group-name').textContent = group.name;
    const createdByBadge = document.getElementById('group-created-by');
    createdByBadge.textContent = group.createdBy;
    createdByBadge.className = `badge ${group.createdBy}`;

    // Metadata
    document.getElementById('bookmark-id').textContent = bookmark.id;

    // 设置按钮事件
    setupEventListeners(bookmark.id);
  }

  /**
   * 渲染分类徽章
   */
  function renderCategory(category) {
    const categoryElement = document.getElementById('bookmark-category');

    if (!category) {
      categoryElement.innerHTML = '<span class="codicon codicon-tag"></span><span>No category</span>';
      categoryElement.className = 'category-badge';
      return;
    }

    const icons = {
      'entry-point': 'codicon-rocket',
      'core-logic': 'codicon-gear',
      'issue': 'codicon-warning',
      'note': 'codicon-note'
    };

    const labels = {
      'entry-point': 'Entry Point',
      'core-logic': 'Core Logic',
      'issue': 'Issue',
      'note': 'Note'
    };

    const icon = icons[category] || 'codicon-tag';
    const label = labels[category] || category;

    categoryElement.innerHTML = `
      <span class="codicon ${icon}"></span>
      <span class="category-label">${label}</span>
    `;
    categoryElement.className = `category-badge ${category}`;
  }

  /**
   * 渲染层级关系
   */
  function renderHierarchy(parent, children, hasChildren) {
    const parentSection = document.getElementById('parent-section');
    const childrenSection = document.getElementById('children-section');
    const noHierarchy = document.getElementById('no-hierarchy');

    // 重置显示
    parentSection.style.display = 'none';
    childrenSection.style.display = 'none';
    noHierarchy.style.display = 'none';

    // 显示父书签
    if (parent) {
      parentSection.style.display = 'block';
      const parentElement = document.getElementById('parent-bookmark');
      parentElement.innerHTML = `
        <span class="codicon codicon-symbol-class"></span>
        <span class="bookmark-link-title">${parent.title}</span>
      `;
      parentElement.onclick = () => navigateToBookmark(parent.id);
      noHierarchy.style.display = 'none';
    }

    // 显示子书签
    if (hasChildren && children.length > 0) {
      childrenSection.style.display = 'block';
      document.getElementById('children-count').textContent = `Children (${children.length})`;

      const childrenList = document.getElementById('children-list');
      childrenList.innerHTML = '';

      children.forEach(child => {
        const childElement = document.createElement('div');
        childElement.className = 'bookmark-link';
        childElement.innerHTML = `
          <span class="codicon codicon-symbol-method"></span>
          <div style="flex: 1;">
            <div class="bookmark-link-title">${child.title}</div>
            <div class="bookmark-link-location">${child.location}</div>
          </div>
        `;
        childElement.onclick = () => navigateToBookmark(child.id);
        childrenList.appendChild(childElement);
      });

      noHierarchy.style.display = 'none';
    }

    // 如果既没有父书签也没有子书签
    if (!parent && !hasChildren) {
      noHierarchy.style.display = 'flex';
    }
  }

  /**
   * 设置事件监听器
   */
  function setupEventListeners(bookmarkId) {
    // Jump to Code 按钮
    const btnJump = document.getElementById('btn-jump');
    btnJump.onclick = () => jumpToCode(bookmarkId);

    // Copy Location 按钮
    const btnCopyLocation = document.getElementById('btn-copy-location');
    btnCopyLocation.onclick = () => copyLocation();
  }

  /**
   * 跳转到代码位置
   */
  function jumpToCode(bookmarkId) {
    vscode.postMessage({
      type: 'jumpToCode',
      bookmarkId: bookmarkId
    });
  }

  /**
   * 导航到其他书签
   */
  function navigateToBookmark(bookmarkId) {
    vscode.postMessage({
      type: 'navigateToBookmark',
      bookmarkId: bookmarkId
    });
  }

  /**
   * 复制位置到剪贴板
   */
  function copyLocation() {
    if (!currentBookmark) {
      return;
    }

    const location = currentBookmark.bookmark.location;

    // 创建临时文本区域来复制
    const textarea = document.createElement('textarea');
    textarea.value = location;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      // 简单的视觉反馈
      const btn = document.getElementById('btn-copy-location');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<span class="codicon codicon-check"></span>';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 1000);
    } catch (err) {
      console.error('Failed to copy:', err);
    } finally {
      document.body.removeChild(textarea);
    }
  }

  // 初始化时显示加载状态
  console.log('Bookmark detail panel initialized');
})();
