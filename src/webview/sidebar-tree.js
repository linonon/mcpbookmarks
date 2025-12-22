// ==================== Tree 模式渲染逻辑 (Grid 布局改进) ====================

/**
 * 渲染 bookmark header (Tree 模式 - Grid 布局，编辑按钮统一右对齐)
 * @param {Object} bookmark - 书签对象
 * @param {boolean} hasChildren - 是否有子书签
 * @param {boolean} isCollapsed - 是否折叠
 * @param {number} depth - 层级深度 (用于计算缩进)
 * @returns {string} HTML 字符串
 */
function renderBookmarkHeaderTree(bookmark, hasChildren, isCollapsed, depth = 0) {
  // 需要从 window 获取工具函数 (定义在 sidebar.js 中)
  const escapeHtml = window.escapeHtml || ((str) => {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  });

  const formatLocation = window.formatLocation || ((location) => {
    if (!location) return '';
    const parts = location.split('/');
    return parts[parts.length - 1];
  });

  // Tree 模式下缩进由容器 margin 处理, 这里的 indent 设为 0 以保证箭头靠左
  return `
    <div class="bookmark-header" style="--indent-level: 0">
      <div class="bookmark-indent"></div>
      <span class="bookmark-chevron">${hasChildren ? `<span class="icon ${isCollapsed ? 'icon-expand' : 'icon-collapse'}"></span>` : ''}</span>
      ${bookmark.order ? `<span class="order-badge">${bookmark.order}</span>` : ''}
      <div class="bookmark-title-location">
        <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
        <span class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</span>
      </div>
    </div>
  `.trim();
}

// 暴露到全局作用域
window.renderBookmarkHeaderTree = renderBookmarkHeaderTree;
