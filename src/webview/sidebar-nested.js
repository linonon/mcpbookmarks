// ==================== Nested 模式渲染逻辑 (原始 Flexbox 布局) ====================

/**
 * 渲染 bookmark header (Nested 模式 - Flexbox 布局)
 * @param {Object} bookmark - 书签对象
 * @param {boolean} hasChildren - 是否有子书签
 * @param {boolean} isCollapsed - 是否折叠
 * @returns {string} HTML 字符串
 */
function renderBookmarkHeaderNested(bookmark, hasChildren, isCollapsed) {
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

  return `
    <div class="bookmark-header">
      <span class="bookmark-chevron">${hasChildren ? `<span class="icon ${isCollapsed ? 'icon-expand' : 'icon-collapse'}"></span>` : ''}</span>
      <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
      <span class="bookmark-location">${escapeHtml(formatLocation(bookmark.location))}</span>
    </div>
  `.trim();
}

// 暴露到全局作用域
window.renderBookmarkHeaderNested = renderBookmarkHeaderNested;
