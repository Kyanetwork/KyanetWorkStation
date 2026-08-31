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
  const aiStatusText = document.getElementById("aiStatusText");
  const aiProfilesList = document.getElementById("aiProfilesList");
  const aiStatusMsg = document.getElementById("aiStatusMsg");
  const inboxMsg = document.getElementById("inboxMsg");
  const inboxList = document.getElementById("inboxList");
  const toastWrap = document.getElementById("toastWrap");

  const tabInbox = document.getElementById("tabInbox");
  const tabFeedback = document.getElementById("tabFeedback");
  const tabWorktask = document.getElementById("tabWorktask");
  const tabWorktaskCreate = document.getElementById("tabWorktaskCreate");
  const moduleInbox = document.getElementById("moduleInbox");
  const moduleFeedback = document.getElementById("moduleFeedback");
  const moduleWorktask = document.getElementById("moduleWorktask");
  const moduleWorktaskCreate = document.getElementById("moduleWorktaskCreate");
  const inboxModel = window.KwsInboxModel;
  const aiModel = window.KwsAiModel;

  const state = {
    active: "inbox",
    inbox: {
      loaded: false,
      loading: false,
      requestId: 0,
      items: [],
      feedbackData: null,
      worktaskData: null
    },
    feedback: { page: 1, pageSize: 20, totalPages: 1, loaded: false, items: [] },
    worktask: { page: 1, pageSize: 20, totalPages: 1, loaded: false, items: [] },
    statusSettings: {
      profile: { enabled: true, apiBaseUrl: "http://127.0.0.1:8080", timeoutMs: 5000 },
      minecraft: { enabled: true }
    },
    ai: {
      enabled: false,
      available: false,
      reason: "",
      activeProfile: null,
      profiles: [],
      suggestions: {}
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

  function aiReasonLabel(reason, enabled, available) {
    if (!enabled) return "已关闭（AI_COPILOT_ENABLED=false）";
    if (available) return "可用";
    return ({
      no_active_profile: "未选择 active profile",
      encryption_key_unavailable: "主密钥不可用",
      profile_key_unavailable: "active profile 不可用"
    }[reason]) || "暂不可用";
  }

  function renderAiProfiles(profiles) {
    if (!aiProfilesList) return;
    if (!profiles.length) {
      aiProfilesList.innerHTML = `<p class="meta">尚未保存 profile。保存后可在这里切换 active profile。</p>`;
      return;
    }
    aiProfilesList.innerHTML = profiles.map((profile) => {
      const active = state.ai.activeProfile && state.ai.activeProfile.id === profile.id;
      const protocolLabel = ({
        "openai-chat": "OpenAI Chat / 兼容",
        "openai-responses": "OpenAI Responses",
        "anthropic-messages": "Anthropic Messages"
      }[profile.protocol]) || profile.protocol || "未知协议";
      return `<div class="ai-profile-row">
        <div>
          <strong>${escapeHtml(profile.name || "未命名 profile")}${active ? " · active" : ""}</strong>
          <div class="ai-profile-meta">${escapeHtml(protocolLabel)} · ${escapeHtml(profile.model || "未设置模型")} · ${escapeHtml(profile.baseUrl || "未设置地址")}</div>
          <div class="ai-profile-meta">API Key：${profile.keyConfigured ? escapeHtml(profile.keyMask || "••••••••") : "未配置"}</div>
        </div>
        <div class="ai-profile-actions">
          <button type="button" data-action="ai-edit-profile" data-id="${escapeHtml(profile.id)}">编辑</button>
          ${active ? "" : `<button type="button" data-action="ai-activate-profile" data-id="${escapeHtml(profile.id)}">设为 active</button>`}
          <button type="button" data-action="ai-delete-profile" data-id="${escapeHtml(profile.id)}">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  function renderAiStatus(data) {
    const profiles = Array.isArray(data && data.profiles)
      ? data.profiles.map((profile) => aiModel.normalizeProfile(profile))
      : [];
    const activeProfile = data && data.activeProfile ? aiModel.normalizeProfile(data.activeProfile) : null;
    state.ai.enabled = data && data.enabled === true;
    state.ai.available = data && data.available === true;
    state.ai.reason = data && typeof data.reason === "string" ? data.reason : "";
    state.ai.activeProfile = activeProfile;
    state.ai.profiles = profiles;
    if (aiStatusText) {
      aiStatusText.textContent = `状态：${aiReasonLabel(state.ai.reason, state.ai.enabled, state.ai.available)}${activeProfile ? ` · 当前：${activeProfile.name || activeProfile.id}` : ""}`;
    }
    renderAiProfiles(profiles);
  }

  async function loadAiStatus() {
    const data = await api("/api/admin/ai/status", null, { method: "GET" });
    renderAiStatus(data);
  }

  function resetAiProfileForm() {
    document.getElementById("aiProfileId").value = "";
    document.getElementById("aiProfileName").value = "";
    document.getElementById("aiProfileProtocol").value = "openai-chat";
    document.getElementById("aiProfileBaseUrl").value = "";
    document.getElementById("aiProfileModel").value = "";
    document.getElementById("aiProfileApiKey").value = "";
  }

  function editAiProfile(id) {
    const profile = state.ai.profiles.find((item) => item.id === id);
    if (!profile) return;
    document.getElementById("aiProfileId").value = profile.id;
    document.getElementById("aiProfileName").value = profile.name;
    document.getElementById("aiProfileProtocol").value = profile.protocol;
    document.getElementById("aiProfileBaseUrl").value = profile.baseUrl;
    document.getElementById("aiProfileModel").value = profile.model;
    document.getElementById("aiProfileApiKey").value = "";
    document.getElementById("aiProfileName").focus();
  }

  async function saveAiProfile() {
    clearMessage(aiStatusMsg);
    const payload = {
      id: document.getElementById("aiProfileId").value.trim() || undefined,
      name: document.getElementById("aiProfileName").value.trim(),
      protocol: document.getElementById("aiProfileProtocol").value,
      baseUrl: document.getElementById("aiProfileBaseUrl").value.trim(),
      model: document.getElementById("aiProfileModel").value.trim(),
      key: document.getElementById("aiProfileApiKey").value
    };
    const btn = document.getElementById("aiProfileSaveBtn");
    await withButtonBusy(btn, "保存中...", async () => {
      await api("/api/admin/ai/profiles", payload);
      await loadAiStatus();
      resetAiProfileForm();
      notify(aiStatusMsg, "ok", "AI profile 已保存");
    });
  }

  async function activateAiProfile(id) {
    const btn = Array.from(document.querySelectorAll('button[data-action="ai-activate-profile"]'))
      .find((candidate) => candidate.dataset.id === id);
    const run = async () => {
      await api("/api/admin/ai/profiles/active", { id });
      await loadAiStatus();
      notify(aiStatusMsg, "ok", "active profile 已切换，新请求将使用该 profile");
    };
    if (btn) await withButtonBusy(btn, "切换中...", run);
    else await run();
  }

  async function deleteAiProfile(id) {
    const profile = state.ai.profiles.find((item) => item.id === id);
    if (!profile || !confirm(`确认删除 AI profile“${profile.name || id}”吗？`)) return;
    const btn = Array.from(document.querySelectorAll('button[data-action="ai-delete-profile"]'))
      .find((candidate) => candidate.dataset.id === id);
    const run = async () => {
      await api("/api/admin/ai/profiles/delete", { id });
      await loadAiStatus();
      if (document.getElementById("aiProfileId").value === id) resetAiProfileForm();
      notify(aiStatusMsg, "ok", "AI profile 已删除");
    };
    if (btn) await withButtonBusy(btn, "删除中...", run);
    else await run();
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
    return ({ new: "新反馈", reviewed: "已查看", resolved: "已解决", notplanned: "暂不处理" }[status]) || status || "-";
  }

  function worktaskStatusLabel(status) {
    return ({ new: "新工单", scheduled: "已安排", in_progress: "进行中", completed: "已完成", cancelled: "已取消" }[status]) || status || "-";
  }

  function worktaskPriorityLabel(priority) {
    return ({ low: "低", medium: "中", high: "高", urgent: "紧急" }[priority]) || priority || "-";
  }

  function inboxSourceLabel(source) {
    return source === "worktask" ? "WorkTask" : "反馈";
  }

  function inboxStatusLabel(item) {
    return item.source === "worktask"
      ? worktaskStatusLabel(item.status)
      : feedbackStatusLabel(item.status);
  }

  function renderInboxDetailField(label, value, options = {}) {
    const rendered = options.linkify
      ? (value ? linkifySafeText(value) : "-")
      : escapeHtml(value || "-");
    return `<div class="inbox-detail-field${options.wide ? " is-wide" : ""}">
      <span class="inbox-detail-label">${escapeHtml(label)}</span>
      <div class="inbox-detail-value">${rendered}</div>
    </div>`;
  }

  function renderInboxInputField(label, id, value, ariaLabel, placeholder) {
    const safeId = escapeHtml(id);
    return `<div class="inbox-detail-field">
      <label class="inbox-detail-label" for="${safeId}">${escapeHtml(label)}</label>
      <input id="${safeId}" aria-label="${escapeHtml(ariaLabel)}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder || "")}">
    </div>`;
  }

  function renderInboxStatusButtons(item) {
    const id = escapeHtml(item.id);
    if (item.source === "feedback") {
      return [
        ["new", "新反馈"],
        ["reviewed", "已查看"],
        ["resolved", "已解决"],
        ["notplanned", "暂不处理"]
      ].map(([status, label]) => `<button type="button" data-action="feedback-status" data-id="${id}" data-status="${status}" ${item.status === status ? "disabled" : ""}>${label}</button>`).join("");
    }
    return [
      ["new", "新工单"],
      ["scheduled", "已安排"],
      ["in_progress", "进行中"],
      ["completed", "已完成"],
      ["cancelled", "已取消"]
    ].map(([status, label]) => `<button type="button" data-action="worktask-status" data-id="${id}" data-status="${status}" ${item.status === status ? "disabled" : ""}>${label}</button>`).join("");
  }

  function aiSuggestionKey(source, id) {
    return `${source}-${id}`;
  }

  function renderAiDecisionButtons(suggestionId, field) {
    if (!aiModel.isDecisionField(field)) return "";
    const id = escapeHtml(suggestionId);
    const safeField = escapeHtml(field);
    return `<button type="button" data-action="ai-decision" data-suggestion-id="${id}" data-decision="accepted" data-fields="${safeField}">接受</button>
      <button type="button" data-action="ai-decision" data-suggestion-id="${id}" data-decision="rejected" data-fields="${safeField}">拒绝</button>`;
  }

  function renderAiSuggestionField(label, field, value, suggestionId, options = {}) {
    const textValue = value || "暂无建议";
    const controls = options.copy
      ? `<button type="button" data-action="ai-copy" data-copy-value="${escapeHtml(value || "")}">复制</button>`
      : "";
    const fill = options.fill
      ? `<button type="button" data-action="ai-fill-reply" data-suggestion-id="${escapeHtml(suggestionId)}">填入回复</button>`
      : "";
    const decisions = options.decision === false ? "" : renderAiDecisionButtons(suggestionId, field);
    return `<div class="ai-suggestion-field${options.wide ? " is-wide" : ""}">
      <strong>${escapeHtml(label)}</strong>
      <p>${escapeHtml(textValue)}</p>
      <div class="ai-suggestion-actions">${controls}${fill}${decisions}</div>
    </div>`;
  }

  function renderAiPanel(item, suggestion, options = {}) {
    const source = escapeHtml(item.source);
    const id = escapeHtml(item.id);
    const key = aiSuggestionKey(item.source, item.id);
    const suggestionId = suggestion ? escapeHtml(suggestion.id) : "";
    const generateButton = `<button type="button" data-action="ai-suggest" data-source="${source}" data-id="${id}"${options.loading ? " disabled" : state.ai.available ? "" : " disabled"}>${suggestion ? "重新生成" : "生成 AI 建议"}</button>`;
    if (options.loading) {
      return `<section class="ai-suggestion-panel" data-ai-key="${escapeHtml(key)}">
        <div class="ai-suggestion-head"><strong>AI Copilot</strong>${generateButton}</div>
        <p class="ai-suggestion-note" role="status" aria-live="polite">正在请求当前 active profile，请稍候……</p>
      </section>`;
    }
    if (options.error) {
      return `<section class="ai-suggestion-panel" data-ai-key="${escapeHtml(key)}">
        <div class="ai-suggestion-head"><strong>AI Copilot</strong>${generateButton}</div>
        <p class="ai-suggestion-note" role="alert">${escapeHtml(options.error)}</p>
      </section>`;
    }
    if (!suggestion) {
      const note = state.ai.available
        ? "生成前会将该条目的最小工作字段发送到当前 Provider；联系方式、管理员备注和账号快照不会发送。"
        : `当前不可用：${aiReasonLabel(state.ai.reason, state.ai.enabled, state.ai.available)}`;
      return `<section class="ai-suggestion-panel" data-ai-key="${escapeHtml(key)}">
        <div class="ai-suggestion-head"><strong>AI Copilot</strong>${generateButton}</div>
        <p class="ai-suggestion-note">${escapeHtml(note)}</p>
      </section>`;
    }

    const normalized = aiModel.normalizeSuggestion(suggestion);
    const suggestionData = normalized.suggestion;
    const similar = normalized.similarItems.length
      ? `<ul>${normalized.similarItems.map((similarItem) => `<li>${escapeHtml(similarItem.entityType === "worktask" ? "WorkTask" : "反馈")} #${escapeHtml(similarItem.entityId)}：${escapeHtml(similarItem.title || "无标题")}（${escapeHtml(similarItem.status || "-")}，${Math.round(similarItem.score * 100)}%）</li>`).join("")}</ul>`
      : "<p>未发现达到阈值的相似条目。</p>";
    const providerText = [normalized.provider.name, normalized.provider.protocol, normalized.provider.model]
      .filter(Boolean)
      .join(" · ") || "当前 Provider";
    const decisionEnabled = normalized.status === "available";
    return `<section class="ai-suggestion-panel" data-ai-key="${escapeHtml(key)}" data-suggestion-id="${suggestionId}">
      <div class="ai-suggestion-head"><strong>AI Copilot 建议 · ${escapeHtml(providerText)}</strong>${generateButton}</div>
      <p class="ai-suggestion-note">生成于 ${escapeHtml(formatDateTimeDisplay(normalized.generatedAt))}，状态：${escapeHtml(normalized.status)}；建议仅供人工确认，过期时间：${escapeHtml(formatDateTimeDisplay(normalized.expiresAt))}</p>
      <div class="ai-suggestion-grid">
        ${renderAiSuggestionField("摘要", "summary", suggestionData.summary, normalized.id, { copy: true, wide: true, decision: decisionEnabled })}
        ${renderAiSuggestionField("建议类型", "category", suggestionData.category, normalized.id, { copy: true, decision: decisionEnabled })}
        ${item.source === "worktask" ? renderAiSuggestionField("建议优先级", "priority", suggestionData.priority, normalized.id, { copy: true, decision: decisionEnabled }) : ""}
        ${item.source === "worktask" ? renderAiSuggestionField("建议标签", "tags", suggestionData.tags.join(", "), normalized.id, { copy: true, decision: decisionEnabled }) : ""}
        ${renderAiSuggestionField("对外回复草稿", "replyDraft", suggestionData.replyDraft, normalized.id, { fill: true, wide: true, decision: decisionEnabled })}
        ${renderAiSuggestionField("建议依据", "rationale", suggestionData.rationale, normalized.id, { wide: true, decision: decisionEnabled })}
        <div class="ai-suggestion-field is-wide"><strong>缺失信息</strong><p>${escapeHtml(suggestionData.missingInfo.join("；") || "未指出")}</p></div>
        <div class="ai-suggestion-field is-wide"><strong>相似条目</strong>${similar}</div>
      </div>
    </section>`;
  }

  function renderInboxItem(item) {
    const detail = item.detailFields || {};
    const id = escapeHtml(item.id);
    const source = escapeHtml(item.source);
    const sourceLabel = escapeHtml(inboxSourceLabel(item.source));
    const statusLabel = escapeHtml(inboxStatusLabel(item));
    const priorityLabel = item.source === "worktask" ? escapeHtml(worktaskPriorityLabel(item.priority)) : "";
    const account = accountSnapshotText(detail);
    const homeDisplay = Boolean(detail.showOnHome);
    const homeAction = item.source === "worktask" ? "worktask-home-display" : "feedback-home-display";
    const deleteAction = item.source === "worktask" ? "worktask-delete" : "feedback-delete";
    const noteAction = item.source === "worktask" ? "worktask-note-reply" : "feedback-note-reply";
    const noteId = `${source}-${id}`;
    const controls = item.source === "worktask"
      ? `<div class="inbox-detail-grid">
          ${renderInboxDetailField("类型", detail.type)}
          ${renderInboxDetailField("联系方式", detail.contact)}
          ${renderInboxDetailField("期望时间", formatDateTimeDisplay(detail.expectedAt))}
          ${renderInboxDetailField("计划时间", formatDateTimeDisplay(detail.scheduledAt))}
          ${renderInboxDetailField("标签", detail.tags)}
          ${renderInboxDetailField("关联账号", account)}
          ${renderInboxInputField("负责人", `inbox-assignee-${id}`, detail.assignee, `WorkTask #${id} 负责人`, "负责人（可选）")}
          ${renderInboxDetailField("详细内容", detail.content || item.summary, { linkify: true, wide: true })}
        </div>
        <div class="ops">
          <label class="inbox-inline-field" for="inbox-scheduled-${id}">
            <span>计划时间</span>
            <input id="inbox-scheduled-${id}" aria-label="WorkTask #${id} 计划时间" type="datetime-local" value="${escapeHtml(toDateTimeLocalValue(detail.scheduledAt))}">
          </label>
          <button type="button" data-action="worktask-arrange" data-id="${id}">保存安排</button>
          <button type="button" data-action="worktask-clear-assignee" data-id="${id}">清空负责人</button>
          <button type="button" data-action="worktask-clear-scheduled" data-id="${id}">清空计划时间</button>
        </div>`
      : `<div class="inbox-detail-grid">
          ${renderInboxDetailField("类型", detail.type)}
          ${renderInboxDetailField("联系方式", detail.contact)}
          ${renderInboxDetailField("关联账号", account)}
          ${renderInboxDetailField("详细内容", detail.content || item.summary, { linkify: true, wide: true })}
        </div>`;

    return `<details class="inbox-item" data-source="${source}" data-id="${id}">
      <summary>
        <div class="inbox-summary-main">
          <h3 class="inbox-summary-title">${escapeHtml(item.title)}</h3>
          <div class="inbox-summary-meta">
            <span class="inbox-tag">${sourceLabel}</span>
            <span>${statusLabel}</span>
            ${priorityLabel ? `<span>优先级：${priorityLabel}</span>` : ""}
            <span class="inbox-summary-excerpt">${escapeHtml(item.summary || "暂无摘要")}</span>
          </div>
        </div>
        <time class="inbox-summary-time" datetime="${escapeHtml(item.updatedAt)}">${escapeHtml(formatDateTimeDisplay(item.updatedAt))}</time>
      </summary>
      <div class="inbox-detail">
        ${controls}
        ${renderAiPanel(item, state.ai.suggestions[aiSuggestionKey(item.source, item.id)])}
        <div class="ops">
          ${renderInboxStatusButtons(item)}
          <button type="button" data-action="${homeAction}" data-id="${id}" data-show="${homeDisplay ? "0" : "1"}">${homeDisplay ? "取消主页展示" : "设为主页展示"}</button>
          <button type="button" class="del" data-action="${deleteAction}" data-id="${id}">删除</button>
        </div>
        <div class="ops">
          <textarea id="inbox-note-${noteId}" aria-label="${sourceLabel} #${id} 管理员备注" rows="2" placeholder="管理员备注（仅后台可见）" maxlength="2000">${escapeHtml(detail.adminNote)}</textarea>
          <textarea id="inbox-reply-${noteId}" aria-label="${sourceLabel} #${id} 对外回复" rows="2" placeholder="对外回复（可在主页展示）" maxlength="2000">${escapeHtml(detail.publicReply)}</textarea>
          <button type="button" data-action="${noteAction}" data-id="${id}">保存备注/回复</button>
        </div>
      </div>
    </details>`;
  }

  function renderInboxList(items) {
    if (!inboxList) return;
    if (!items.length) {
      inboxList.innerHTML = `<p class="empty-state">当前筛选条件下没有待处理记录。</p>`;
      return;
    }
    inboxList.innerHTML = items.map(renderInboxItem).join("");
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
          <button data-action="worktask-clear-assignee" data-id="${item.id}">清空负责人</button>
          <button data-action="worktask-clear-scheduled" data-id="${item.id}">清空计划时间</button>
        </div>
        <div class="ops" style="margin-top:6px;">
          <textarea id="worktask-note-${item.id}" rows="2" placeholder="管理员备注（仅后台可见）" maxlength="2000">${escapeHtml(item.adminNote || "")}</textarea>
          <textarea id="worktask-reply-${item.id}" rows="2" placeholder="对外回复（可在主页展示）" maxlength="2000">${escapeHtml(item.publicReply || "")}</textarea>
          <button data-action="worktask-note-reply" data-id="${item.id}">保存备注/回复</button>
        </div>
      </article>
    `).join("");
  }

  async function downloadServerCsv(pathname, payload) {
    const response = await fetch(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = data.error && data.error.code;
      const error = new Error(
        code === "EXPORT_LIMIT_EXCEEDED"
          ? (data.error.message || "导出结果超过上限，请缩小筛选范围后重试")
          : ((data.error && data.error.message) || "CSV 导出失败")
      );
      error.code = code || "EXPORT_FAILED";
      throw error;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (response.headers.get("content-disposition") || "export.csv")
      .match(/filename="?([^";]+)"?/i)?.[1] || "export.csv";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return Number(response.headers.get("x-export-count") || 0);
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

  function inboxFilters() {
    return {
      source: document.getElementById("inboxSourceFilter").value,
      status: document.getElementById("inboxStatusFilter").value,
      priority: document.getElementById("inboxPriorityFilter").value,
      keyword: document.getElementById("inboxKeyword").value.trim()
    };
  }

  function inboxListPayload(filters, source) {
    const feedbackStatuses = new Set(["new", "reviewed", "resolved", "notplanned"]);
    const worktaskStatuses = new Set(["new", "scheduled", "in_progress", "completed", "cancelled"]);
    const payload = {
      page: 1,
      pageSize: 100,
      keyword: filters.keyword
    };
    if (source === "feedback") {
      if (feedbackStatuses.has(filters.status)) payload.status = filters.status;
    } else {
      if (worktaskStatuses.has(filters.status)) payload.status = filters.status;
      payload.priority = filters.priority;
    }
    return payload;
  }

  async function loadInbox() {
    if (!inboxModel) {
      throw new Error("收件箱模块加载失败，请刷新页面重试");
    }
    const requestId = state.inbox.requestId + 1;
    state.inbox.requestId = requestId;
    state.inbox.loading = true;
    clearMessage(inboxMsg);
    inboxList.setAttribute("aria-busy", "true");
    inboxList.innerHTML = '<p class="empty-state">正在加载工作收件箱…</p>';
    try {
      const filters = inboxFilters();
      const includeFeedback = !filters.source || filters.source === "feedback";
      const includeWorktask = !filters.source || filters.source === "worktask";
      const [feedbackData, worktaskData] = await Promise.all([
        includeFeedback
          ? api("/api/admin/feedback/list", inboxListPayload(filters, "feedback"))
          : Promise.resolve({ items: [], totalPages: 1, total: 0 }),
        includeWorktask
          ? api("/api/admin/worktask/list", inboxListPayload(filters, "worktask"))
          : Promise.resolve({ items: [], totalPages: 1, total: 0 })
      ]);

      if (requestId !== state.inbox.requestId) return;
      const feedbackItems = (Array.isArray(feedbackData.items) ? feedbackData.items : []).map(inboxModel.mapFeedback);
      const worktaskItems = (Array.isArray(worktaskData.items) ? worktaskData.items : []).map(inboxModel.mapWorktask);
      const merged = inboxModel.mergeInboxItems(feedbackItems, worktaskItems);
      state.inbox.items = inboxModel.filterInboxItems(merged, filters);
      state.inbox.feedbackData = feedbackData;
      state.inbox.worktaskData = worktaskData;
      state.inbox.loaded = true;

      renderInboxList(state.inbox.items);
      document.getElementById("inboxCount").textContent = `${state.inbox.items.length} 条`;
      const boundary = document.getElementById("inboxBoundaryNote");
      const hasMore = inboxModel.hasMoreInboxItems(feedbackData, worktaskData);
      boundary.classList.toggle("hidden", !hasMore);
      if (hasMore) {
        document.getElementById("inboxBoundaryText").textContent = "当前仅加载每类来源的前 100 条近期记录；需要更早记录时请进入专项管理页。";
      }
      document.getElementById("globalLoadTime").textContent = `最近加载：${formatDateTimeDisplay(new Date())}`;
    } catch (error) {
      if (requestId !== state.inbox.requestId) return;
      state.inbox.loaded = false;
      state.inbox.items = [];
      document.getElementById("inboxCount").textContent = "0 条";
      document.getElementById("inboxBoundaryNote").classList.add("hidden");
      inboxList.innerHTML = `<p class="empty-state">收件箱加载失败，请检查登录状态后重试。</p>`;
      showMessage(inboxMsg, "error", error && error.message ? error.message : "收件箱加载失败");
      throw error;
    } finally {
      if (requestId === state.inbox.requestId) {
        state.inbox.loading = false;
        inboxList.setAttribute("aria-busy", "false");
      }
    }
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

  function findInboxItem(source, id) {
    return state.inbox.items.find((item) => item.source === source && Number(item.id) === Number(id)) || null;
  }

  function findAiSuggestionById(id) {
    return Object.values(state.ai.suggestions).find((item) => Number(item && item.id) === Number(id)) || null;
  }

  async function generateAiSuggestion(item, panel, button) {
    if (!item || !panel) return;
    const key = aiSuggestionKey(item.source, item.id);
    await withButtonBusy(button, "生成中...", async () => {
      panel.outerHTML = renderAiPanel(item, null, { loading: true });
      const loadingPanel = Array.from(inboxList.querySelectorAll(".ai-suggestion-panel"))
        .find((candidate) => candidate.dataset.aiKey === key);
      try {
        const data = await api("/api/admin/ai/suggest", {
          entityType: item.source,
          entityId: Number(item.id)
        });
        const suggestion = aiModel.normalizeSuggestion(data);
        state.ai.suggestions[key] = suggestion;
        if (loadingPanel) loadingPanel.outerHTML = renderAiPanel(item, suggestion);
      } catch (error) {
        if (loadingPanel) loadingPanel.outerHTML = renderAiPanel(item, null, { error: error.message });
        throw error;
      }
    });
  }

  async function loadStoredAiSuggestion(item, panel) {
    if (!item || !panel || panel.dataset.aiLoaded === "1") return;
    panel.dataset.aiLoaded = "1";
    const key = aiSuggestionKey(item.source, item.id);
    if (state.ai.suggestions[key]) return;
    try {
      const data = await api(`/api/admin/ai/suggestions?entityType=${encodeURIComponent(item.source)}&entityId=${encodeURIComponent(item.id)}`, null, { method: "GET" });
      const suggestions = Array.isArray(data) ? data : [];
      if (!suggestions.length) return;
      const suggestion = aiModel.normalizeSuggestion(suggestions[0]);
      state.ai.suggestions[key] = suggestion;
      if (panel.isConnected) panel.outerHTML = renderAiPanel(item, suggestion);
    } catch (_) {
      // Loading a previous candidate is best-effort; generation remains available.
    }
  }

  async function decideAiSuggestion(button) {
    const suggestion = findAiSuggestionById(button.dataset.suggestionId);
    if (!suggestion) return;
    const fields = button.dataset.fields
      .split(",")
      .map((field) => field.trim())
      .filter((field) => aiModel.isDecisionField(field));
    if (!fields.length) return;
    await withButtonBusy(button, "保存中...", async () => {
      const data = await api("/api/admin/ai/suggestions/decision", {
        suggestionId: Number(suggestion.id),
        decision: button.dataset.decision,
        fields
      });
      suggestion.status = data.status || button.dataset.decision;
      const item = findInboxItem(suggestion.entityType, suggestion.entityId);
      const panel = button.closest(".ai-suggestion-panel");
      if (item && panel) panel.outerHTML = renderAiPanel(item, suggestion);
      notify(inboxMsg, "ok", button.dataset.decision === "accepted" ? "AI 建议已标记接受（业务内容仍需手动保存）" : "AI 建议已标记拒绝");
    });
  }

  async function copyAiSuggestion(button) {
    const value = button.dataset.copyValue || "";
    if (!value) return;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      notify(inboxMsg, "error", "当前浏览器不支持复制，请手动选择文本");
      return;
    }
    await navigator.clipboard.writeText(value);
    notify(inboxMsg, "ok", "建议内容已复制");
  }

  function fillAiReply(button) {
    const suggestion = findAiSuggestionById(button.dataset.suggestionId);
    if (!suggestion) return;
    const item = findInboxItem(suggestion.entityType, suggestion.entityId);
    if (!item) return;
    const replyInput = document.getElementById(`inbox-reply-${aiSuggestionKey(item.source, item.id)}`);
    if (!replyInput) return;
    replyInput.value = suggestion.suggestion.replyDraft || "";
    replyInput.focus();
    notify(inboxMsg, "ok", "回复草稿已填入，请编辑后手动保存");
  }

  function switchModule(module) {
    state.active = module;
    const isInbox = module === "inbox";
    const isFeedback = module === "feedback";
    const isWorktask = module === "worktask";
    const isWorktaskCreate = module === "worktaskCreate";
    tabInbox.classList.toggle("active", isInbox);
    tabFeedback.classList.toggle("active", isFeedback);
    tabWorktask.classList.toggle("active", isWorktask);
    tabWorktaskCreate.classList.toggle("active", isWorktaskCreate);
    tabInbox.setAttribute("aria-selected", String(isInbox));
    tabFeedback.setAttribute("aria-selected", String(isFeedback));
    tabWorktask.setAttribute("aria-selected", String(isWorktask));
    tabWorktaskCreate.setAttribute("aria-selected", String(isWorktaskCreate));
    moduleInbox.classList.toggle("hidden", !isInbox);
    moduleFeedback.classList.toggle("hidden", !isFeedback);
    moduleWorktask.classList.toggle("hidden", !isWorktask);
    moduleWorktaskCreate.classList.toggle("hidden", !isWorktaskCreate);

    if (isInbox && !state.inbox.loaded && !state.inbox.loading) {
      loadInbox().catch((err) => showMessage(inboxMsg, "error", err.message));
    }
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
      await loadAiStatus().catch((err) => notify(aiStatusMsg, "error", err.message));
      switchModule("inbox");
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
      await loadAiStatus().catch((err) => notify(aiStatusMsg, "error", err.message));
      switchModule("inbox");
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
      state.inbox.loaded = false;
      state.inbox.loading = false;
      state.inbox.requestId += 1;
      state.inbox.items = [];
      state.inbox.feedbackData = null;
      state.inbox.worktaskData = null;
      state.feedback.loaded = false;
      state.worktask.loaded = false;
      resetWorktaskCreateForm();
      clearMessage(worktaskCreateMsg);
      clearMessage(smtpTestMsg);
      clearMessage(webhookTestMsg);
      clearMessage(statusSettingsMsg);
      clearMessage(aiStatusMsg);
      state.ai.enabled = false;
      state.ai.available = false;
      state.ai.reason = "";
      state.ai.activeProfile = null;
      state.ai.profiles = [];
      state.ai.suggestions = {};
      resetAiProfileForm();
      document.getElementById("smtpTestTo").value = "";
      document.getElementById("webhookTestContent").value = "";
      loginCard.classList.remove("hidden");
      adminPanel.classList.add("hidden");
    }
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    try {
      if (state.active === "inbox") {
        state.inbox.loaded = false;
        await loadInbox();
      } else if (state.active === "feedback") await loadFeedback();
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

  document.getElementById("aiProfileSaveBtn").addEventListener("click", async () => {
    try {
      await saveAiProfile();
    } catch (error) {
      notify(aiStatusMsg, "error", error.message);
    }
  });

  document.getElementById("aiProfileResetBtn").addEventListener("click", () => {
    resetAiProfileForm();
    clearMessage(aiStatusMsg);
  });

  aiProfilesList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    try {
      if (btn.dataset.action === "ai-edit-profile") {
        editAiProfile(btn.dataset.id);
      } else if (btn.dataset.action === "ai-activate-profile") {
        await activateAiProfile(btn.dataset.id);
      } else if (btn.dataset.action === "ai-delete-profile") {
        await deleteAiProfile(btn.dataset.id);
      }
    } catch (error) {
      notify(aiStatusMsg, "error", error.message);
    }
  });

  tabInbox.addEventListener("click", () => switchModule("inbox"));
  tabFeedback.addEventListener("click", () => switchModule("feedback"));
  tabWorktask.addEventListener("click", () => switchModule("worktask"));
  tabWorktaskCreate.addEventListener("click", () => switchModule("worktaskCreate"));

  document.getElementById("inboxFilterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.inbox.loaded = false;
    try {
      await loadInbox();
    } catch (error) {
      notify(inboxMsg, "error", error.message);
    }
  });

  document.getElementById("inboxFeedbackLink").addEventListener("click", () => switchModule("feedback"));
  document.getElementById("inboxWorktaskLink").addEventListener("click", () => switchModule("worktask"));

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

  document.getElementById("feedbackExportBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      const count = await withButtonBusy(button, "导出中…", () => downloadServerCsv("/api/admin/feedback/export", {
        status: document.getElementById("feedbackStatusFilter").value,
        keyword: document.getElementById("feedbackKeyword").value.trim()
      }));
      notify(feedbackMsg, "ok", `反馈 CSV 导出完成，共 ${count} 条`);
    } catch (error) {
      notify(feedbackMsg, "error", error.message || "CSV 导出失败");
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

  document.getElementById("worktaskExportBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      const count = await withButtonBusy(button, "导出中…", () => downloadServerCsv("/api/admin/worktask/export", {
        status: document.getElementById("worktaskStatusFilter").value,
        priority: document.getElementById("worktaskPriorityFilter").value,
        keyword: document.getElementById("worktaskKeyword").value.trim()
      }));
      notify(worktaskMsg, "ok", `WorkTask CSV 导出完成，共 ${count} 条`);
    } catch (error) {
      notify(worktaskMsg, "error", error.message || "CSV 导出失败");
    }
  });

  async function refreshInboxAfterMutation() {
    state.inbox.loaded = false;
    state.feedback.loaded = false;
    state.worktask.loaded = false;
    await loadInbox();
  }

  inboxList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    if (["ai-suggest", "ai-decision", "ai-copy", "ai-fill-reply"].includes(btn.dataset.action)) {
      try {
        if (btn.dataset.action === "ai-suggest") {
          const item = findInboxItem(btn.dataset.source, btn.dataset.id);
          const panel = btn.closest(".ai-suggestion-panel");
          await generateAiSuggestion(item, panel, btn);
        } else if (btn.dataset.action === "ai-decision") {
          await decideAiSuggestion(btn);
        } else if (btn.dataset.action === "ai-copy") {
          await copyAiSuggestion(btn);
        } else {
          fillAiReply(btn);
        }
      } catch (error) {
        notify(inboxMsg, "error", error.message);
      }
      return;
    }

    const itemElement = btn.closest(".inbox-item");
    const id = Number(btn.dataset.id);
    const source = itemElement ? itemElement.dataset.source : "";
    const noteKey = `${source}-${btn.dataset.id}`;
    try {
      if (btn.dataset.action === "feedback-status") {
        await withButtonBusy(btn, "更新中...", async () => {
          await api("/api/admin/feedback/status", { id, status: btn.dataset.status });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "反馈状态已更新");
      }
      if (btn.dataset.action === "feedback-delete") {
        if (!confirm("确认删除该反馈吗？该操作不可恢复。")) return;
        await withButtonBusy(btn, "删除中...", async () => {
          await api("/api/admin/feedback/delete", { id });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "反馈已删除");
      }
      if (btn.dataset.action === "feedback-home-display") {
        const showOnHome = btn.dataset.show === "1";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/feedback/home-display", { id, showOnHome });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", showOnHome ? "反馈已设置为主页显示" : "反馈已从主页隐藏");
      }
      if (btn.dataset.action === "feedback-note-reply") {
        const noteInput = document.getElementById(`inbox-note-${noteKey}`);
        const replyInput = document.getElementById(`inbox-reply-${noteKey}`);
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/feedback/note-reply", {
            id,
            adminNote: noteInput ? noteInput.value : "",
            publicReply: replyInput ? replyInput.value : ""
          });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "反馈备注/回复已保存");
      }
      if (btn.dataset.action === "worktask-status") {
        await withButtonBusy(btn, "更新中...", async () => {
          await api("/api/admin/worktask/status", { id, status: btn.dataset.status });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "WorkTask 状态已更新");
      }
      if (btn.dataset.action === "worktask-arrange") {
        const assigneeInput = document.getElementById(`inbox-assignee-${btn.dataset.id}`);
        const scheduledInput = document.getElementById(`inbox-scheduled-${btn.dataset.id}`);
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/worktask/arrange", {
            id,
            assignee: assigneeInput ? assigneeInput.value.trim() : "",
            scheduledAt: scheduledInput ? toIsoOrEmpty(scheduledInput.value) : ""
          });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "WorkTask 安排已保存");
      }
      if (btn.dataset.action === "worktask-clear-assignee" || btn.dataset.action === "worktask-clear-scheduled") {
        const payload = { id };
        if (btn.dataset.action === "worktask-clear-assignee") payload.assignee = null;
        else payload.scheduledAt = null;
        await withButtonBusy(btn, "清除中...", async () => {
          await api("/api/admin/worktask/arrange", payload);
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", btn.dataset.action === "worktask-clear-assignee" ? "WorkTask 负责人已清空" : "WorkTask 计划时间已清空");
      }
      if (btn.dataset.action === "worktask-delete") {
        if (!confirm("确认删除该 WorkTask 吗？该操作不可恢复。")) return;
        await withButtonBusy(btn, "删除中...", async () => {
          await api("/api/admin/worktask/delete", { id });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "WorkTask 已删除");
      }
      if (btn.dataset.action === "worktask-home-display") {
        const showOnHome = btn.dataset.show === "1";
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/worktask/home-display", { id, showOnHome });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", showOnHome ? "WorkTask 已设置为主页显示" : "WorkTask 已从主页隐藏");
      }
      if (btn.dataset.action === "worktask-note-reply") {
        const noteInput = document.getElementById(`inbox-note-${noteKey}`);
        const replyInput = document.getElementById(`inbox-reply-${noteKey}`);
        await withButtonBusy(btn, "保存中...", async () => {
          await api("/api/admin/worktask/note-reply", {
            id,
            adminNote: noteInput ? noteInput.value : "",
            publicReply: replyInput ? replyInput.value : ""
          });
          await refreshInboxAfterMutation();
        });
        notify(inboxMsg, "ok", "WorkTask 备注/回复已保存");
      }
    } catch (error) {
      notify(inboxMsg, "error", error.message);
    }
  });

  inboxList.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!details || details.tagName !== "DETAILS" || !details.open) return;
    const item = findInboxItem(details.dataset.source, details.dataset.id);
    const panel = details.querySelector(".ai-suggestion-panel");
    if (item && panel) {
      loadStoredAiSuggestion(item, panel);
    }
  }, true);

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

      if (btn.dataset.action === "worktask-clear-assignee" || btn.dataset.action === "worktask-clear-scheduled") {
        const payload = { id };
        if (btn.dataset.action === "worktask-clear-assignee") {
          payload.assignee = null;
        } else {
          payload.scheduledAt = null;
        }
        await withButtonBusy(btn, "清除中...", async () => {
          await api("/api/admin/worktask/arrange", payload);
          await loadWorktask();
        });
        notify(worktaskMsg, "ok", btn.dataset.action === "worktask-clear-assignee" ? "WorkTask 负责人已清空" : "WorkTask 计划时间已清空");
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
