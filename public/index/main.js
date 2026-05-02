(function () {
  const state = {
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    formatter: null
  };

  function createFormatter(locale, timezone) {
    try {
      return new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    } catch (_) {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    }
  }

  function formatDateTime(input) {
    if (!input) return "-";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return String(input);
    const formatter = state.formatter || createFormatter("zh-CN", "Asia/Shanghai");
    const parts = formatter.formatToParts(date);
    const map = {};
    for (const part of parts) {
      map[part.type] = part.value;
    }
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  }

  function escapeHtml(input) {
    return String(input == null ? "" : input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function feedbackStatusLabel(status) {
    return ({ new: "新反馈", reviewed: "已查看", resolved: "已解决", notplanned: "暂不处理" }[status]) || status;
  }

  function worktaskStatusLabel(status) {
    return ({ new: "新工单", scheduled: "已安排", in_progress: "进行中", completed: "已完成", cancelled: "已取消" }[status]) || status;
  }

  function worktaskPriorityLabel(priority) {
    return ({ low: "低", medium: "中", high: "高", urgent: "紧急" }[priority]) || priority || "-";
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error((data && data.error && data.error.message) || "请求失败");
    }
    return data.data || {};
  }

  function renderList(containerId, items, emptyText, metaBuilder) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<li class="empty">${escapeHtml(emptyText)}</li>`;
      return;
    }

    container.innerHTML = items.map((item) => `
      <li class="show-item">
        <strong>${escapeHtml(item.title)}</strong>
        <div class="show-meta">${escapeHtml(metaBuilder(item))}</div>
        ${item.publicReply ? `<div class="show-reply">回复：${escapeHtml(item.publicReply)}</div>` : ""}
      </li>
    `).join("");
  }

  async function loadHomeShowcase() {
    try {
      const [uiConfig, highlights] = await Promise.all([
        fetchJson("/api/public/config"),
        fetchJson("/api/public/highlights")
      ]);

      state.locale = uiConfig.displayLocale || "zh-CN";
      state.timezone = uiConfig.displayTimezone || "Asia/Shanghai";
      state.formatter = createFormatter(state.locale, state.timezone);

      renderList(
        "homeFeedbackList",
        highlights.feedbackItems || [],
        "暂无被设置为主页显示的处理中反馈。",
        (item) => `类型：${item.type} | 状态：${feedbackStatusLabel(item.status)} | 更新时间：${formatDateTime(item.updatedAt)}`
      );
      renderList(
        "homeWorktaskList",
        highlights.worktaskItems || [],
        "暂无被设置为主页显示的进行中任务。",
        (item) => `类型：${item.type} | 来源：${item.createdByAdmin ? "本人添加" : "用户提交"} | 状态：${worktaskStatusLabel(item.status)} | 优先级：${worktaskPriorityLabel(item.priority)} | 更新时间：${formatDateTime(item.updatedAt)}`
      );
    } catch (_) {
      renderList("homeFeedbackList", [], "主页展示数据加载失败，请稍后刷新。", () => "");
      renderList("homeWorktaskList", [], "主页展示数据加载失败，请稍后刷新。", () => "");
    }
  }

  loadHomeShowcase();
})();
