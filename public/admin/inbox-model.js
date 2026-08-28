(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KwsInboxModel = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function text(value) {
    return value == null ? "" : String(value);
  }

  function booleanValue(value) {
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    }
    return false;
  }

  function updatedAtOf(item) {
    return text(item && (item.updatedAt || item.createdAt));
  }

  function dateValue(value) {
    const time = Date.parse(value || "");
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  }

  function mapFeedback(item) {
    const source = item || {};
    return {
      source: "feedback",
      id: Number(source.id),
      title: text(source.title) || "无标题反馈",
      summary: text(source.content),
      status: text(source.status),
      priority: "",
      type: text(source.type),
      updatedAt: updatedAtOf(source),
      createdAt: text(source.createdAt),
      detailFields: {
        type: text(source.type),
        content: text(source.content),
        contact: text(source.contact),
        adminNote: text(source.adminNote),
        publicReply: text(source.publicReply),
        showOnHome: booleanValue(source.showOnHome),
        accountUserId: text(source.accountUserId),
        accountEmailSnapshot: text(source.accountEmailSnapshot),
        accountDisplayNameSnapshot: text(source.accountDisplayNameSnapshot)
      }
    };
  }

  function mapWorktask(item) {
    const source = item || {};
    return {
      source: "worktask",
      id: Number(source.id),
      title: text(source.title) || "无标题 WorkTask",
      summary: text(source.content),
      status: text(source.status),
      priority: text(source.priority),
      type: text(source.type),
      updatedAt: updatedAtOf(source),
      createdAt: text(source.createdAt),
      detailFields: {
        type: text(source.type),
        content: text(source.content),
        contact: text(source.contact),
        expectedAt: text(source.expectedAt),
        scheduledAt: text(source.scheduledAt),
        assignee: text(source.assignee),
        tags: text(source.tags),
        adminNote: text(source.adminNote),
        publicReply: text(source.publicReply),
        showOnHome: booleanValue(source.showOnHome),
        createdByAdmin: booleanValue(source.createdByAdmin),
        accountUserId: text(source.accountUserId),
        accountEmailSnapshot: text(source.accountEmailSnapshot),
        accountDisplayNameSnapshot: text(source.accountDisplayNameSnapshot)
      }
    };
  }

  function mergeInboxItems(feedbackItems, worktaskItems) {
    return [...(feedbackItems || []), ...(worktaskItems || [])].sort((left, right) => {
      const leftDate = dateValue(left.updatedAt);
      const rightDate = dateValue(right.updatedAt);
      if (rightDate > leftDate) return 1;
      if (rightDate < leftDate) return -1;
      const sourceDifference = text(left.source).localeCompare(text(right.source));
      if (sourceDifference !== 0) return sourceDifference;
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId)) return leftId - rightId;
      if (Number.isFinite(leftId)) return -1;
      if (Number.isFinite(rightId)) return 1;
      return 0;
    });
  }

  function filterInboxItems(items, filters) {
    const options = filters || {};
    const keyword = text(options.keyword).trim().toLocaleLowerCase();
    return (items || []).filter((item) => {
      if (options.source && item.source !== options.source) return false;
      if (options.status && item.status !== options.status) return false;
      if (options.priority && item.priority !== options.priority) return false;
      if (!keyword) return true;
      const detail = item.detailFields || {};
      const haystack = [item.title, item.summary, item.status, item.priority, item.type, ...Object.values(detail)]
        .map(text)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(keyword);
    });
  }

  function hasMoreInboxItems(feedbackData, worktaskData) {
    return Number(feedbackData && feedbackData.totalPages || 1) > 1
      || Number(worktaskData && worktaskData.totalPages || 1) > 1;
  }

  return {
    mapFeedback,
    mapWorktask,
    mergeInboxItems,
    filterInboxItems,
    hasMoreInboxItems
  };
});
