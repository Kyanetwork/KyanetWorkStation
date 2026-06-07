(function () {
  const loginCard = document.getElementById("loginCard");
  const adminPanel = document.getElementById("adminPanel");
  const loginMsg = document.getElementById("loginMsg");
  const globalMsg = document.getElementById("globalMsg");
  const feedbackMsg = document.getElementById("feedbackMsg");
  const worktaskMsg = document.getElementById("worktaskMsg");
  const worktaskCreateMsg = document.getElementById("worktaskCreateMsg");
  const smtpTestMsg = document.getElementById("smtpTestMsg");
  const webhookTestMsg = document.getElementById("webhookTestMsg");
  const statusSettingsMsg = document.getElementById("statusSettingsMsg");
  const toastWrap = document.getElementById("toastWrap");

  const tabFeedback = document.getElementById("tabFeedback");
  const tabWorktask = document.getElementById("tabWorktask");
  const tabWorktaskCreate = document.getElementById("tabWorktaskCreate");
  const moduleFeedback = document.getElementById("moduleFeedback");
  const moduleWorktask = document.getElementById("moduleWorktask");
  const moduleWorktaskCreate = document.getElementById("moduleWorktaskCreate");

  const state = {
    active: "feedback",
    feedback: { page: 1, pageSize: 20, totalPages: 1, loaded: false, items: [] },
    worktask: { page: 1, pageSize: 20, totalPages: 1, loaded: false, items: [] },
    statusSettings: {
      profile: { enabled: true, apiBaseUrl: "http://127.0.0.1:8080", timeoutMs: 5000 },
      minecraft: { enabled: true }
    },
    ui: {
      displayTimezone: "Asia/Shanghai",
      displayLocale: "zh-CN",
      dateTimeFormatter: null
    }
  };

  function showMessage(target, kind, text) {
    target.className = `msg ${kind}`;
    target.textContent = text;
  }

  function clearMessage(target) {
    target.className = "msg";
    target.textContent = "";
  }

  function showToast(kind, text) {
    if (!toastWrap) return;
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    toast.textContent = text;
    toastWrap.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 180);
    }, 2200);
  }

  function notify(target, kind, text) {
    if (target) {
      showMessage(target, kind, text);
    }
    showToast(kind, text);
  }

  async function withButtonBusy(btn, busyText, task) {
    const previousText = btn.textContent;
    const previousDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add("is-busy");
    if (busyText) {
      btn.textContent = busyText;
    }
    try {
      return await task();
    } finally {
      btn.classList.remove("is-busy");
      btn.disabled = previousDisabled;
      btn.textContent = previousText;
    }
  }

  function escapeHtml(input) {
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function linkifySafeText(raw) {
    const escaped = escapeHtml(raw || "");
    return escaped.replace(/(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/g, (url) => {
      const safeUrl = url.replace(/"/g, "");
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
    });
  }

  function toDateTimeLocalValue(isoText) {
    if (!isoText) return "";
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  function toIsoOrEmpty(localDateTimeText) {
    if (!localDateTimeText) return "";
    const date = new Date(localDateTimeText);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

  function createDateTimeFormatter(locale, timezone) {
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

  function setDisplaySettings(settings) {
    const timezone = typeof settings.displayTimezone === "string" && settings.displayTimezone ? settings.displayTimezone : "Asia/Shanghai";
    const locale = typeof settings.displayLocale === "string" && settings.displayLocale ? settings.displayLocale : "zh-CN";
    state.ui.displayTimezone = timezone;
    state.ui.displayLocale = locale;
    state.ui.dateTimeFormatter = createDateTimeFormatter(locale, timezone);
  }

  function formatDateTimeDisplay(input) {
    if (!input) return "-";
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
      return String(input);
    }
    const formatter = state.ui.dateTimeFormatter || createDateTimeFormatter("zh-CN", "Asia/Shanghai");
    const parts = formatter.formatToParts(date);
    const dict = {};
    for (const part of parts) {
      dict[part.type] = part.value;
    }
    return `${dict.year}-${dict.month}-${dict.day} ${dict.hour}:${dict.minute}:${dict.second}`;
  }

  async function api(path, payload, options = {}) {
    const method = options.method || "POST";
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error((data.error && data.error.message) || "请求失败");
    }
    return data.data || {};
  }

  async function loadDisplaySettings() {
    try {
      const data = await api("/api/public/config", null, { method: "GET" });
      setDisplaySettings(data);
    } catch (_) {
      setDisplaySettings({});
    }
  }

  function renderStatusSettings(settings) {
    const profile = settings.profile || {};
    const minecraft = settings.minecraft || {};
    state.statusSettings = {
      profile: {
        enabled: profile.enabled !== false,
        apiBaseUrl: profile.apiBaseUrl || "http://127.0.0.1:8080",
        timeoutMs: Number(profile.timeoutMs || 5000)
      },
      minecraft: {
        enabled: minecraft.enabled !== false
      }
    };

    document.getElementById("statusProfileEnabled").value = state.statusSettings.profile.enabled ? "1" : "0";
    document.getElementById("meowStatusApiBaseUrl").value = state.statusSettings.profile.apiBaseUrl;
    document.getElementById("meowStatusTimeoutMs").value = String(state.statusSettings.profile.timeoutMs);
    document.getElementById("statusMinecraftEnabled").value = state.statusSettings.minecraft.enabled ? "1" : "0";
  }

  async function loadStatusSettings() {
    const data = await api("/api/admin/status/settings", null, { method: "GET" });
    renderStatusSettings(data);
  }

  async function saveStatusProfileSettings() {
    clearMessage(statusSettingsMsg);
    const btn = document.getElementById("statusProfileSaveBtn");
    const payload = {
      enabled: document.getElementById("statusProfileEnabled").value === "1",
      apiBaseUrl: document.getElementById("meowStatusApiBaseUrl").value.trim(),
      timeoutMs: Number(document.getElementById("meowStatusTimeoutMs").value || 5000)
    };
    await withButtonBusy(btn, "保存中...", async () => {
      const data = await api("/api/admin/status/profile", payload);
      renderStatusSettings({ ...state.statusSettings, profile: data });
      notify(statusSettingsMsg, "ok", "MeowStatus 状态展示设置已保存");
    });
  }

  async function saveMinecraftStatusSettings() {
    clearMessage(statusSettingsMsg);
    const btn = document.getElementById("statusMinecraftSaveBtn");
    const payload = {
      enabled: document.getElementById("statusMinecraftEnabled").value === "1"
    };
    await withButtonBusy(btn, "保存中...", async () => {
      const data = await api("/api/admin/status/minecraft", payload);
      renderStatusSettings({ ...state.statusSettings, minecraft: data });
      notify(statusSettingsMsg, "ok", "Minecraft 状态展示设置已保存");
    });
  }

  function feedbackStatusLabel(status) {
    return ({ new: "新反馈", reviewed: "已查看", resolved: "已解决", notplanned: "暂不处理" }[status]) || status;
  }

  function worktaskStatusLabel(status) {
    return ({ new: "新工单", scheduled: "已安排", in_progress: "进行中", completed: "已完成", cancelled: "已取消" }[status]) || status;
  }

  function worktaskPriorityLabel(priority) {
    return ({ low: "低", medium: "中", high: "高", urgent: "紧急" }[priority]) || priority;
  }

  function homeDisplayLabel(showOnHome) {
    return showOnHome ? "显示中" : "隐藏中";
  }

  function accountSnapshotText(item) {
    if (!item || !item.accountUserId) {
      return "-";
    }
    const name = item.accountDisplayNameSnapshot || "未命名账号";
    const email = item.accountEmailSnapshot || "无邮箱快照";
    return `${name} <${email}>`;
  }

  function renderFeedbackStats(total, summary) {
    const s = {
      new: Number(summary && summary.new || 0),
      reviewed: Number(summary && summary.reviewed || 0),
      resolved: Number(summary && summary.resolved || 0),
      notplanned: Number(summary && summary.notplanned || 0)
    };
    document.getElementById("feedbackStats").innerHTML = [
      ["总反馈", total || 0],
      ["新反馈", s.new],
      ["已查看", s.reviewed],
      ["已解决", s.resolved],
      ["暂不处理", s.notplanned]
    ].map((row) => `<div class="stat"><div class="k">${row[0]}</div><div class="v">${row[1]}</div></div>`).join("");
  }

  function renderFeedbackList(items) {
    const container = document.getElementById("feedbackList");
    if (!items.length) {
      container.innerHTML = "<p>当前没有符合条件的反馈。</p>";
      return;
    }

    container.innerHTML = items.map((item) => `
      <article class="item">
        <h3>[反馈 #${item.id}] ${escapeHtml(item.title)}</h3>
        <div class="meta">类型：${escapeHtml(item.type)} | 状态：${feedbackStatusLabel(item.status)} | 首页展示状态：${homeDisplayLabel(Boolean(item.showOnHome))} | 联系方式：${escapeHtml(item.contact)} | 提交：${escapeHtml(formatDateTimeDisplay(item.createdAt))}</div>
        <div class="meta">关联账号：${escapeHtml(accountSnapshotText(item))}</div>
        <div class="content">${linkifySafeText(item.content)}</div>
        <div class="ops">
          <button data-action="feedback-status" data-id="${item.id}" data-status="new" ${item.status === "new" ? "disabled" : ""}>新反馈</button>
          <button data-action="feedback-status" data-id="${item.id}" data-status="reviewed" ${item.status === "reviewed" ? "disabled" : ""}>已查看</button>
          <button data-action="feedback-status" data-id="${item.id}" data-status="resolved" ${item.status === "resolved" ? "disabled" : ""}>已解决</button>
          <button data-action="feedback-status" data-id="${item.id}" data-status="notplanned" ${item.status === "notplanned" ? "disabled" : ""}>暂不处理</button>
          <button data-action="feedback-home-display" data-id="${item.id}" data-show="${item.showOnHome ? "0" : "1"}">${item.showOnHome ? "取消主页展示" : "设为主页展示"}</button>
          <button class="del" data-action="feedback-delete" data-id="${item.id}">删除</button>
        </div>
        <div class="ops" style="margin-top:6px;">
          <textarea id="feedback-note-${item.id}" rows="2" placeholder="管理员备注（仅后台可见）" maxlength="2000">${escapeHtml(item.adminNote || "")}</textarea>
          <textarea id="feedback-reply-${item.id}" rows="2" placeholder="对外回复（可在主页展示）" maxlength="2000">${escapeHtml(item.publicReply || "")}</textarea>
          <button data-action="feedback-note-reply" data-id="${item.id}">保存备注/回复</button>
        </div>
      </article>
    `).join("");
  }

  function renderWorktaskStats(total, summary, prioritySummary) {
    const s = {
      new: Number(summary && summary.new || 0),
      scheduled: Number(summary && summary.scheduled || 0),
      in_progress: Number(summary && summary.in_progress || 0),
      completed: Number(summary && summary.completed || 0),
      urgent: Number(prioritySummary && prioritySummary.urgent || 0)
    };
    document.getElementById("worktaskStats").innerHTML = [
      ["WorkTask总数", total || 0],
      ["新工单", s.new],
      ["已安排", s.scheduled],
      ["进行中", s.in_progress],
      ["已完成", s.completed],
      ["紧急优先级", s.urgent]
    ].map((row) => `<div class="stat"><div class="k">${row[0]}</div><div class="v">${row[1]}</div></div>`).join("");
  }

  function renderWorktaskList(items) {
    const container = document.getElementById("worktaskList");
    if (!items.length) {
      container.innerHTML = "<p>当前没有符合条件的 WorkTask。</p>";
      return;
    }

    container.innerHTML = items.map((item) => `
      <article class="item">
        <h3>[WorkTask #${item.id}] ${escapeHtml(item.title)}</h3>
        <div class="meta">类型：${escapeHtml(item.type)} | 来源：${item.createdByAdmin ? "本人添加" : "用户提交"} | 状态：${worktaskStatusLabel(item.status)} | 优先级：${worktaskPriorityLabel(item.priority)} | 首页展示状态：${homeDisplayLabel(Boolean(item.showOnHome))} | 联系方式：${escapeHtml(item.contact)}</div>
        <div class="meta">关联账号：${escapeHtml(accountSnapshotText(item))}</div>
        <div class="meta">期望时间：${escapeHtml(formatDateTimeDisplay(item.expectedAt))} | 计划时间：${escapeHtml(formatDateTimeDisplay(item.scheduledAt))} | 负责人：${escapeHtml(item.assignee || "未分配")} | 标签：${escapeHtml(item.tags || "-")}</div>
        <div class="content">${linkifySafeText(item.content)}</div>
        <div class="ops">
          <button data-action="worktask-status" data-id="${item.id}" data-status="new" ${item.status === "new" ? "disabled" : ""}>新工单</button>
          <button data-action="worktask-status" data-id="${item.id}" data-status="scheduled" ${item.status === "scheduled" ? "disabled" : ""}>已安排</button>
          <button data-action="worktask-status" data-id="${item.id}" data-status="in_progress" ${item.status === "in_progress" ? "disabled" : ""}>进行中</button>
          <button data-action="worktask-status" data-id="${item.id}" data-status="completed" ${item.status === "completed" ? "disabled" : ""}>已完成</button>
          <button data-action="worktask-status" data-id="${item.id}" data-status="cancelled" ${item.status === "cancelled" ? "disabled" : ""}>已取消</button>
          <button data-action="worktask-home-display" data-id="${item.id}" data-show="${item.showOnHome ? "0" : "1"}">${item.showOnHome ? "取消主页展示" : "设为主页展示"}</button>
          <button class="del" data-action="worktask-delete" data-id="${item.id}">删除</button>
        </div>
        <div class="ops" style="margin-top:6px;">
          <input id="assignee-${item.id}" placeholder="负责人（可选）" value="${escapeHtml(item.assignee || "")}">
          <input id="scheduled-${item.id}" type="datetime-local" value="${toDateTimeLocalValue(item.scheduledAt)}">
          <button data-action="worktask-arrange" data-id="${item.id}">保存安排</button>
        </div>
        <div class="ops" style="margin-top:6px;">
          <textarea id="worktask-note-${item.id}" rows="2" placeholder="管理员备注（仅后台可见）" maxlength="2000">${escapeHtml(item.adminNote || "")}</textarea>
          <textarea id="worktask-reply-${item.id}" rows="2" placeholder="对外回复（可在主页展示）" maxlength="2000">${escapeHtml(item.publicReply || "")}</textarea>
          <button data-action="worktask-note-reply" data-id="${item.id}">保存备注/回复</button>
        </div>
      </article>
    `).join("");
  }

  function csvEscape(value) {
    const text = String(value == null ? "" : value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv(rows, header, filenamePrefix) {
    const csvText = [header, ...rows].map((line) => line.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function fetchAllFeedbackForExport() {
    const status = document.getElementById("feedbackStatusFilter").value;
    const keyword = document.getElementById("feedbackKeyword").value.trim();
    const first = await api("/api/admin/feedback/list", { status, keyword, page: 1, pageSize: 100 });
    let all = (first.items || []).slice();
    for (let p = 2; p <= (first.totalPages || 1); p += 1) {
      const pageData = await api("/api/admin/feedback/list", { status, keyword, page: p, pageSize: 100 });
      all = all.concat(pageData.items || []);
    }
    return all;
  }

  async function fetchAllWorktaskForExport() {
    const status = document.getElementById("worktaskStatusFilter").value;
    const priority = document.getElementById("worktaskPriorityFilter").value;
    const keyword = document.getElementById("worktaskKeyword").value.trim();
    const first = await api("/api/admin/worktask/list", { status, priority, keyword, page: 1, pageSize: 100 });
    let all = (first.items || []).slice();
    for (let p = 2; p <= (first.totalPages || 1); p += 1) {
      const pageData = await api("/api/admin/worktask/list", { status, priority, keyword, page: p, pageSize: 100 });
      all = all.concat(pageData.items || []);
    }
    return all;
  }

  async function loadFeedback() {
    clearMessage(feedbackMsg);
    const payload = {
      status: document.getElementById("feedbackStatusFilter").value,
      keyword: document.getElementById("feedbackKeyword").value.trim(),
      page: state.feedback.page,
      pageSize: state.feedback.pageSize
    };
    const data = await api("/api/admin/feedback/list", payload);
    state.feedback.items = data.items || [];
    state.feedback.totalPages = data.totalPages || 1;
    state.feedback.loaded = true;

    if (state.feedback.page > state.feedback.totalPages) {
      state.feedback.page = state.feedback.totalPages;
      return loadFeedback();
    }

    renderFeedbackStats(data.total || 0, data.summary || {});
    renderFeedbackList(state.feedback.items);
    document.getElementById("feedbackPageText").textContent = `第 ${data.page} / ${data.totalPages} 页`;
    document.getElementById("feedbackPageSummary").textContent = `总计 ${data.total} 条，当前页 ${state.feedback.items.length} 条`;
    document.getElementById("feedbackPrevBtn").disabled = state.feedback.page <= 1;
    document.getElementById("feedbackNextBtn").disabled = state.feedback.page >= state.feedback.totalPages;
    document.getElementById("globalLoadTime").textContent = `最近加载：${formatDateTimeDisplay(new Date())}`;
  }

  async function loadWorktask() {
    clearMessage(worktaskMsg);
    const payload = {
      status: document.getElementById("worktaskStatusFilter").value,
      priority: document.getElementById("worktaskPriorityFilter").value,
      keyword: document.getElementById("worktaskKeyword").value.trim(),
      page: state.worktask.page,
      pageSize: state.worktask.pageSize
    };
    const data = await api("/api/admin/worktask/list", payload);
    state.worktask.items = data.items || [];
    state.worktask.totalPages = data.totalPages || 1;
    state.worktask.loaded = true;

    if (state.worktask.page > state.worktask.totalPages) {
      state.worktask.page = state.worktask.totalPages;
      return loadWorktask();
    }

    renderWorktaskStats(data.total || 0, data.summary || {}, data.prioritySummary || {});
    renderWorktaskList(state.worktask.items);
    document.getElementById("worktaskPageText").textContent = `第 ${data.page} / ${data.totalPages} 页`;
    document.getElementById("worktaskPageSummary").textContent = `总计 ${data.total} 条，当前页 ${state.worktask.items.length} 条`;
    document.getElementById("worktaskPrevBtn").disabled = state.worktask.page <= 1;
    document.getElementById("worktaskNextBtn").disabled = state.worktask.page >= state.worktask.totalPages;
    document.getElementById("globalLoadTime").textContent = `最近加载：${formatDateTimeDisplay(new Date())}`;
  }

  function resetWorktaskCreateForm() {
    document.getElementById("createType").value = "任务安排";
    document.getElementById("createPriority").value = "medium";
    document.getElementById("createStatus").value = "";
    document.getElementById("createShowOnHome").value = "0";
    document.getElementById("createTitle").value = "";
    document.getElementById("createAssignee").value = "";
    document.getElementById("createExpectedAt").value = "";
    document.getElementById("createScheduledAt").value = "";
    document.getElementById("createTags").value = "";
    document.getElementById("createContent").value = "";
    document.getElementById("createPublicReply").value = "";
    document.getElementById("createAdminNote").value = "";
  }

  async function createWorktaskByAdmin() {
    clearMessage(worktaskCreateMsg);
    const payload = {
      type: document.getElementById("createType").value,
      title: document.getElementById("createTitle").value.trim(),
      content: document.getElementById("createContent").value.trim(),
      priority: document.getElementById("createPriority").value,
      status: document.getElementById("createStatus").value,
      showOnHome: document.getElementById("createShowOnHome").value === "1",
      assignee: document.getElementById("createAssignee").value.trim(),
      expectedAt: toIsoOrEmpty(document.getElementById("createExpectedAt").value),
      scheduledAt: toIsoOrEmpty(document.getElementById("createScheduledAt").value),
      tags: document.getElementById("createTags").value.trim(),
      publicReply: document.getElementById("createPublicReply").value.trim(),
      adminNote: document.getElementById("createAdminNote").value.trim()
    };

    const createBtn = document.getElementById("createWorktaskBtn");
    await withButtonBusy(createBtn, "创建中...", async () => {
      const data = await api("/api/admin/worktask/create", payload);
      notify(worktaskCreateMsg, "ok", `本人任务创建成功（#${data.id}）`);
      resetWorktaskCreateForm();
    });
  }

  async function triggerSmtpTestMail() {
    clearMessage(smtpTestMsg);
    const to = document.getElementById("smtpTestTo").value.trim();
    const smtpBtn = document.getElementById("smtpTestBtn");
    await withButtonBusy(smtpBtn, "发送中...", async () => {
      const data = await api("/api/admin/notify/smtp-test", { to });
      const recipients = Array.isArray(data.recipients) && data.recipients.length
        ? data.recipients.join(", ")
        : "SMTP_TO 已配置收件人";
      notify(smtpTestMsg, "ok", `SMTP 测试邮件已发送：${recipients}`);
    });
  }

  async function triggerWebhookTestMessage() {
    clearMessage(webhookTestMsg);
    const content = document.getElementById("webhookTestContent").value.trim();
    const webhookBtn = document.getElementById("webhookTestBtn");
    await withButtonBusy(webhookBtn, "发送中...", async () => {
      const data = await api("/api/admin/notify/webhook-test", { content });
      const text = `Webhook 测试完成：成功 ${data.okCount || 0}，失败 ${data.failCount || 0}`;
      const kind = Number(data.failCount || 0) > 0 ? "error" : "ok";
      notify(webhookTestMsg, kind, data.firstError ? `${text}（${data.firstError}）` : text);
    });
  }

  function switchModule(module) {
    state.active = module;
    const isFeedback = module === "feedback";
    const isWorktask = module === "worktask";
    const isWorktaskCreate = module === "worktaskCreate";
    tabFeedback.classList.toggle("active", isFeedback);
    tabWorktask.classList.toggle("active", isWorktask);
    tabWorktaskCreate.classList.toggle("active", isWorktaskCreate);
    moduleFeedback.classList.toggle("hidden", !isFeedback);
    moduleWorktask.classList.toggle("hidden", !isWorktask);
    moduleWorktaskCreate.classList.toggle("hidden", !isWorktaskCreate);

    if (isFeedback && !state.feedback.loaded) {
      loadFeedback().catch((err) => showMessage(globalMsg, "error", err.message));
    }
    if (isWorktask && !state.worktask.loaded) {
      loadWorktask().catch((err) => showMessage(globalMsg, "error", err.message));
    }
  }

  async function login() {
    clearMessage(loginMsg);
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    try {
      const data = await api("/api/admin/login", { username, password });
      document.getElementById("loginState").textContent = `已登录：${data.username}`;
      loginCard.classList.add("hidden");
      adminPanel.classList.remove("hidden");
      await loadStatusSettings().catch((err) => notify(statusSettingsMsg, "error", err.message));
      switchModule("feedback");
    } catch (error) {
      showMessage(loginMsg, "error", error.message);
    }
  }

  async function checkLogin() {
    try {
      const data = await api("/api/admin/me", null, { method: "GET" });
      document.getElementById("loginState").textContent = `已登录：${data.username}`;
      loginCard.classList.add("hidden");
      adminPanel.classList.remove("hidden");
      await loadStatusSettings().catch((err) => notify(statusSettingsMsg, "error", err.message));
      switchModule("feedback");
    } catch (_) {
      loginCard.classList.remove("hidden");
      adminPanel.classList.add("hidden");
    }
  }

  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", {});
    } finally {
      state.feedback.loaded = false;
      state.worktask.loaded = false;
      resetWorktaskCreateForm();
      clearMessage(worktaskCreateMsg);
      clearMessage(smtpTestMsg);
      clearMessage(webhookTestMsg);
      clearMessage(statusSettingsMsg);
      document.getElementById("smtpTestTo").value = "";
      document.getElementById("webhookTestContent").value = "";
      loginCard.classList.remove("hidden");
      adminPanel.classList.add("hidden");
    }
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    try {
      if (state.active === "feedback") await loadFeedback();
      else if (state.active === "worktask") await loadWorktask();
      else clearMessage(worktaskCreateMsg);
      notify(globalMsg, "ok", "当前板块已刷新");
    } catch (error) {
      notify(globalMsg, "error", error.message);
    }
  });

  document.getElementById("smtpTestBtn").addEventListener("click", async () => {
    try {
      await triggerSmtpTestMail();
    } catch (error) {
      notify(smtpTestMsg, "error", error.message);
    }
  });

  document.getElementById("webhookTestBtn").addEventListener("click", async () => {
    try {
      await triggerWebhookTestMessage();
    } catch (error) {
      notify(webhookTestMsg, "error", error.message);
    }
  });

  document.getElementById("statusProfileSaveBtn").addEventListener("click", async () => {
    try {
      await saveStatusProfileSettings();
    } catch (error) {
      notify(statusSettingsMsg, "error", error.message);
    }
  });

  document.getElementById("statusMinecraftSaveBtn").addEventListener("click", async () => {
    try {
      await saveMinecraftStatusSettings();
    } catch (error) {
      notify(statusSettingsMsg, "error", error.message);
    }
  });

  tabFeedback.addEventListener("click", () => switchModule("feedback"));
  tabWorktask.addEventListener("click", () => switchModule("worktask"));
  tabWorktaskCreate.addEventListener("click", () => switchModule("worktaskCreate"));

  document.getElementById("createWorktaskBtn").addEventListener("click", async () => {
    try {
      await createWorktaskByAdmin();
      state.worktask.loaded = false;
    } catch (error) {
      notify(worktaskCreateMsg, "error", error.message);
    }
  });
  document.getElementById("createWorktaskResetBtn").addEventListener("click", () => {
    resetWorktaskCreateForm();
    clearMessage(worktaskCreateMsg);
  });

  document.getElementById("feedbackSearchBtn").addEventListener("click", async () => {
    try { state.feedback.page = 1; await loadFeedback(); } catch (error) { notify(feedbackMsg, "error", error.message); }
  });
  document.getElementById("feedbackPrevBtn").addEventListener("click", async () => {
    if (state.feedback.page <= 1) return;
    try { state.feedback.page -= 1; await loadFeedback(); } catch (error) { notify(feedbackMsg, "error", error.message); }
  });
  document.getElementById("feedbackNextBtn").addEventListener("click", async () => {
    if (state.feedback.page >= state.feedback.totalPages) return;
    try { state.feedback.page += 1; await loadFeedback(); } catch (error) { notify(feedbackMsg, "error", error.message); }
  });

  document.getElementById("feedbackExportBtn").addEventListener("click", async () => {
    try {
      const rows = await fetchAllFeedbackForExport();
      exportCsv(rows.map((it) => [it.id, it.type, it.title, it.content, it.contact, feedbackStatusLabel(it.status), it.accountUserId || "", it.accountEmailSnapshot || "", it.accountDisplayNameSnapshot || "", it.createdAt, it.updatedAt]), ["id", "type", "title", "content", "contact", "status", "accountUserId", "accountEmailSnapshot", "accountDisplayNameSnapshot", "createdAt", "updatedAt"], "feedback_export");
      notify(feedbackMsg, "ok", `反馈 CSV 导出完成，共 ${rows.length} 条`);
    } catch (error) {
      notify(feedbackMsg, "error", error.message);
    }
  });

  document.getElementById("worktaskSearchBtn").addEventListener("click", async () => {
    try { state.worktask.page = 1; await loadWorktask(); } catch (error) { notify(worktaskMsg, "error", error.message); }
  });
  document.getElementById("worktaskPrevBtn").addEventListener("click", async () => {
    if (state.worktask.page <= 1) return;
    try { state.worktask.page -= 1; await loadWorktask(); } catch (error) { notify(worktaskMsg, "error", error.message); }
  });
  document.getElementById("worktaskNextBtn").addEventListener("click", async () => {
    if (state.worktask.page >= state.worktask.totalPages) return;
    try { state.worktask.page += 1; await loadWorktask(); } catch (error) { notify(worktaskMsg, "error", error.message); }
  });

  document.getElementById("worktaskExportBtn").addEventListener("click", async () => {
    try {
      const rows = await fetchAllWorktaskForExport();
      exportCsv(rows.map((it) => [it.id, it.type, it.title, it.content, it.contact, worktaskPriorityLabel(it.priority), worktaskStatusLabel(it.status), it.accountUserId || "", it.accountEmailSnapshot || "", it.accountDisplayNameSnapshot || "", it.expectedAt, it.scheduledAt, it.assignee, it.tags, it.createdAt, it.updatedAt]), ["id", "type", "title", "content", "contact", "priority", "status", "accountUserId", "accountEmailSnapshot", "accountDisplayNameSnapshot", "expectedAt", "scheduledAt", "assignee", "tags", "createdAt", "updatedAt"], "worktask_export");
      notify(worktaskMsg, "ok", `WorkTask CSV 导出完成，共 ${rows.length} 条`);
    } catch (error) {
      notify(worktaskMsg, "error", error.message);
    }
  });

  document.getElementById("feedbackList").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    try {
      if (btn.dataset.action === "feedback-status") {
        await withButtonBusy(btn, "更新中...", async () => {
          await api("/api/admin/feedback/status", { id, status: btn.dataset.status });
          await loadFeedback();
        });
        notify(feedbackMsg, "ok", "反馈状态已更新");
      }
      if (btn.dataset.action === "feedback-delete") {
        if (!confirm("确认删除该反馈吗？该操作不可恢复。")) return;
        await withButtonBusy(btn, "删除中...", async () => {
          await api("/api/admin/feedback/delete", { id });
          await loadFeedback();
        });
        notify(feedbackMsg, "ok", "反馈已删除");
      }
      if (btn.dataset.action === "feedback-home-display") {
        const showOnHome = btn.dataset.show === "1";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/feedback/home-display", { id, showOnHome });
          await loadFeedback();
        });
        notify(feedbackMsg, "ok", showOnHome ? "反馈已设置为主页显示" : "反馈已从主页隐藏");
      }
      if (btn.dataset.action === "feedback-note-reply") {
        const noteInput = document.getElementById(`feedback-note-${id}`);
        const replyInput = document.getElementById(`feedback-reply-${id}`);
        const adminNote = noteInput ? noteInput.value : "";
        const publicReply = replyInput ? replyInput.value : "";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/feedback/note-reply", { id, adminNote, publicReply });
          await loadFeedback();
        });
        notify(feedbackMsg, "ok", "反馈备注/回复已保存");
      }
    } catch (error) {
      notify(feedbackMsg, "error", error.message);
    }
  });

  document.getElementById("worktaskList").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);

    try {
      if (btn.dataset.action === "worktask-status") {
        await withButtonBusy(btn, "更新中...", async () => {
          await api("/api/admin/worktask/status", { id, status: btn.dataset.status });
          await loadWorktask();
        });
        notify(worktaskMsg, "ok", "WorkTask 状态已更新");
      }

      if (btn.dataset.action === "worktask-arrange") {
        const assigneeInput = document.getElementById(`assignee-${id}`);
        const scheduledInput = document.getElementById(`scheduled-${id}`);
        const assignee = assigneeInput ? assigneeInput.value.trim() : "";
        const scheduledAt = scheduledInput && scheduledInput.value ? new Date(scheduledInput.value).toISOString() : "";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/worktask/arrange", { id, assignee, scheduledAt });
          await loadWorktask();
        });
        notify(worktaskMsg, "ok", "WorkTask 安排已保存");
      }

      if (btn.dataset.action === "worktask-delete") {
        if (!confirm("确认删除该 WorkTask 吗？该操作不可恢复。")) return;
        await withButtonBusy(btn, "删除中...", async () => {
          await api("/api/admin/worktask/delete", { id });
          await loadWorktask();
        });
        notify(worktaskMsg, "ok", "WorkTask 已删除");
      }

      if (btn.dataset.action === "worktask-home-display") {
        const showOnHome = btn.dataset.show === "1";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/worktask/home-display", { id, showOnHome });
          await loadWorktask();
        });
        notify(worktaskMsg, "ok", showOnHome ? "WorkTask 已设置为主页显示" : "WorkTask 已从主页隐藏");
      }
      if (btn.dataset.action === "worktask-note-reply") {
        const noteInput = document.getElementById(`worktask-note-${id}`);
        const replyInput = document.getElementById(`worktask-reply-${id}`);
        const adminNote = noteInput ? noteInput.value : "";
        const publicReply = replyInput ? replyInput.value : "";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/worktask/note-reply", { id, adminNote, publicReply });
          await loadWorktask();
        });
        notify(worktaskMsg, "ok", "WorkTask 备注/回复已保存");
      }
    } catch (error) {
      notify(worktaskMsg, "error", error.message);
    }
  });

  (async () => {
    resetWorktaskCreateForm();
    await loadDisplaySettings();
    await checkLogin();
  })();
})();
