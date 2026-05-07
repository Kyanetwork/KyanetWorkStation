(function () {
  const state = {
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    formatter: null,
    meowStatusRefreshMs: 10000,
    meowStatusTimer: null,
    meowStatusLoading: false
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

  function statusStateLabel(status) {
    return ({ working: "工作中", studying: "学习中", resting: "休息中", away: "离开中" }[status]) || status || "-";
  }

  function minecraftOnlineText(payload) {
    if (!payload) return "未知";
    return payload.online ? "在线" : "离线";
  }

  function minecraftPlayersText(payload) {
    if (!payload) return "-";
    const online = payload.playersOnline == null ? "?" : payload.playersOnline;
    const max = payload.playersMax == null ? "?" : payload.playersMax;
    return `${online} / ${max}`;
  }

  function minecraftLatencyText(payload) {
    if (!payload || payload.latencyMs == null) return "-";
    return `${payload.latencyMs} ms`;
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

  function renderMeowStatus(statusData) {
    const section = document.getElementById("meowStatusSection");
    const profilePanel = document.getElementById("profileStatusPanel");
    const mcPanel = document.getElementById("minecraftStatusPanel");
    const profileEnabled = Boolean(statusData.settings && statusData.settings.profileEnabled);
    const minecraftEnabled = Boolean(statusData.settings && statusData.settings.minecraftEnabled);

    if (!section) {
      return;
    }

    if (!profileEnabled && !minecraftEnabled) {
      section.classList.add("hidden");
      profilePanel.classList.add("hidden");
      mcPanel.classList.add("hidden");
      return;
    }

    section.classList.remove("hidden");
    profilePanel.classList.toggle("hidden", !profileEnabled);
    mcPanel.classList.toggle("hidden", !minecraftEnabled);

    if (profileEnabled) {
      const profile = statusData.profile || {};
      document.getElementById("profileState").textContent = statusStateLabel(profile.state);
      document.getElementById("profileNote").textContent = profile.note || statusData.error || "-";
      document.getElementById("profileUpdatedAt").textContent = `更新时间：${formatDateTime(profile.updatedAt)}`;
    }

    if (minecraftEnabled) {
      renderMinecraftWidgets(statusData.minecraftWidgets || [], statusData.error || "");
    }
  }

  function renderMinecraftWidgets(widgets, error) {
    const container = document.getElementById("minecraftStatusList");
    if (!container) return;

    if (error) {
      container.innerHTML = `<div class="mc-error">${escapeHtml(error)}</div>`;
      return;
    }
    if (!widgets.length) {
      container.innerHTML = `<div class="empty">MeowStatus 暂无 Minecraft 挂件数据。</div>`;
      return;
    }

    container.innerHTML = widgets.map((widget) => {
      const payload = widget.lastPayload;
      const onlineState = payload && payload.online === true ? "online" : payload && payload.online === false ? "offline" : "unknown";
      const iconHtml = payload && payload.favicon && String(payload.favicon).startsWith("data:image")
        ? `<img class="server-icon" src="${escapeHtml(payload.favicon)}" alt="">`
        : `<img class="server-icon hidden" alt="">`;
      const target = payload && payload.target ? payload.target : `${widget.config.host || "-"}:${widget.config.port || "-"}`;
      const errorText = widget.lastErrorCode ? `[${widget.lastErrorCode}] ${widget.lastError || ""}` : (widget.lastError || "");
      return `
        <article class="mc-card" data-online="${onlineState}">
          <div class="mc-head">
            <div class="mc-name">${iconHtml}<span>${escapeHtml(widget.name)}</span></div>
            <div class="mc-state">${escapeHtml(minecraftOnlineText(payload))}</div>
          </div>
          <div class="mc-line">地址：${escapeHtml(target)} | 版本：${escapeHtml(payload && payload.version || "-")} | 核心：${escapeHtml(payload && payload.serverSoftware || "-")}</div>
          <div class="mc-line">玩家：${escapeHtml(minecraftPlayersText(payload))} | 延迟：${escapeHtml(minecraftLatencyText(payload))} | 更新时间：${escapeHtml(formatDateTime(widget.lastUpdatedAt))}</div>
          <div class="mc-line">MOTD：${escapeHtml(payload && payload.motd || "-")}</div>
          ${errorText ? `<div class="mc-error">${escapeHtml(errorText)}</div>` : ""}
        </article>
      `;
    }).join("");
  }

  async function refreshMeowStatus() {
    if (state.meowStatusLoading) return;
    state.meowStatusLoading = true;
    try {
      const meowStatus = await fetchJson("/api/public/meowstatus");
      renderMeowStatus(meowStatus || {});
    } catch (_) {
      renderMeowStatus({
        settings: {
          profileEnabled: true,
          minecraftEnabled: true
        },
        profile: null,
        minecraftWidgets: [],
        error: "MeowStatus 状态刷新失败，请稍后重试。"
      });
    } finally {
      state.meowStatusLoading = false;
    }
  }

  function startMeowStatusRefreshTimer() {
    if (state.meowStatusTimer) {
      clearInterval(state.meowStatusTimer);
    }
    const intervalMs = Math.max(5000, Number(state.meowStatusRefreshMs) || 10000);
    state.meowStatusTimer = setInterval(refreshMeowStatus, intervalMs);
  }

  async function loadHomeShowcase() {
    try {
      const [uiConfig, highlights, meowStatus] = await Promise.all([
        fetchJson("/api/public/config"),
        fetchJson("/api/public/highlights"),
        fetchJson("/api/public/meowstatus")
      ]);

      state.locale = uiConfig.displayLocale || "zh-CN";
      state.timezone = uiConfig.displayTimezone || "Asia/Shanghai";
      state.meowStatusRefreshMs = Number(uiConfig.meowStatusRefreshMs || 10000);
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
      renderMeowStatus(meowStatus || {});
      startMeowStatusRefreshTimer();
    } catch (_) {
      renderList("homeFeedbackList", [], "主页展示数据加载失败，请稍后刷新。", () => "");
      renderList("homeWorktaskList", [], "主页展示数据加载失败，请稍后刷新。", () => "");
    }
  }

  loadHomeShowcase();
})();
