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
  const aiDiagnosticsList = document.getElementById("aiDiagnosticsList");
  const aiDiagnosticMsg = document.getElementById("aiDiagnosticMsg");
  const aiMetricsSummary = document.getElementById("aiMetricsSummary");
  const aiMetricsMsg = document.getElementById("aiMetricsMsg");
  const knowledgeStatusText = document.getElementById("knowledgeStatusText");
  const knowledgeStatusBadge = document.getElementById("knowledgeStatusBadge");
  const knowledgeIndexSummary = document.getElementById("knowledgeIndexSummary");
  const knowledgeRoots = document.getElementById("knowledgeRoots");
  const knowledgeRootFilter = document.getElementById("knowledgeRootFilter");
  const knowledgeStatusMsg = document.getElementById("knowledgeStatusMsg");
  const knowledgeAskMsg = document.getElementById("knowledgeAskMsg");
  const knowledgeAnswerCard = document.getElementById("knowledgeAnswerCard");
  const knowledgeAnswer = document.getElementById("knowledgeAnswer");
  const knowledgeBasis = document.getElementById("knowledgeBasis");
  const knowledgeCaveats = document.getElementById("knowledgeCaveats");
  const knowledgeSources = document.getElementById("knowledgeSources");
  const knowledgeHistoryList = document.getElementById("knowledgeHistoryList");
  const knowledgeHistoryMsg = document.getElementById("knowledgeHistoryMsg");
  const inboxMsg = document.getElementById("inboxMsg");
  const inboxList = document.getElementById("inboxList");
  const toastWrap = document.getElementById("toastWrap");
  const projectMsg = document.getElementById("projectMsg");
  const projectList = document.getElementById("projectList");
  const projectDetail = document.getElementById("projectDetail");
  const projectRelationsView = document.getElementById("projectRelationsView");
  const projectKanbanView = document.getElementById("projectKanbanView");
  const projectRelationsViewBtn = document.getElementById("projectRelationsViewBtn");
  const projectKanbanViewBtn = document.getElementById("projectKanbanViewBtn");
  const projectKanbanBoard = document.getElementById("projectKanbanBoard");
  const projectModel = window.KwsProjectModel;
  const workHubMsg = document.getElementById("workHubMsg");
  const moduleWorkHub = document.getElementById("moduleWorkHub");
  const tabWorkHub = document.getElementById("tabWorkHub");
  const workHubRefreshBtn = document.getElementById("workHubRefreshBtn");

  const projectKanbanSourceLabels = Object.freeze({ feedback: "Feedback", worktask: "WorkTask" });
  const projectKanbanStatusLabels = Object.freeze({
    feedback: Object.freeze({ new: "新建", reviewed: "已查看", resolved: "已解决", notplanned: "不计划" }),
    worktask: Object.freeze({ new: "新建", scheduled: "已安排", in_progress: "进行中", completed: "已完成", cancelled: "已取消" })
  });

  const tabInbox = document.getElementById("tabInbox");
  const tabFeedback = document.getElementById("tabFeedback");
  const tabWorktask = document.getElementById("tabWorktask");
  const tabWorktaskCreate = document.getElementById("tabWorktaskCreate");
  const tabProjects = document.getElementById("tabProjects");
  const tabKnowledge = document.getElementById("tabKnowledge");
  const tabSettings = document.getElementById("tabSettings");
  const moduleInbox = document.getElementById("moduleInbox");
  const moduleFeedback = document.getElementById("moduleFeedback");
  const moduleWorktask = document.getElementById("moduleWorktask");
  const moduleWorktaskCreate = document.getElementById("moduleWorktaskCreate");
  const moduleProjects = document.getElementById("moduleProjects");
  const moduleKnowledge = document.getElementById("moduleKnowledge");
  const moduleSettings = document.getElementById("moduleSettings");
  const inboxModel = window.KwsInboxModel;
  const aiModel = window.KwsAiModel;

  const state = {
    active: "inbox",
    workHub: {
      loaded: false,
      loading: false,
      requestId: 0,
      data: null
    },
    inbox: {
      loaded: false,
      loading: false,
      requestId: 0,
      items: [],
      feedbackData: null,
      worktaskData: null
    },
    feedback: { page: 1, pageSize: 20, totalPages: 1, loaded: false, items: [], focusId: null },
    worktask: { page: 1, pageSize: 20, totalPages: 1, loaded: false, items: [], focusId: null },
    projects: {
      page: 1,
      pageSize: 20,
      totalPages: 1,
      total: 0,
      loaded: false,
      items: [],
      detail: null,
      detailId: null,
      projectView: "relations",
      loading: false
    },
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
      suggestions: {},
      diagnostics: {},
      metrics: null
    },
    knowledge: {
      loaded: false,
      loading: false,
      available: false,
      reason: "",
      roots: [],
      autoCleanup: true,
      retentionDays: 30,
      history: { page: 1, pageSize: 10, totalPages: 0, total: 0, items: [] },
      answer: null
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
      no_active_profile: "未选择当前 AI 配置",
      encryption_key_unavailable: "主密钥不可用",
      profile_key_unavailable: "当前 AI 配置不可用"
    }[reason]) || "暂不可用";
  }

  function renderAiProfiles(profiles) {
    if (!aiProfilesList) return;
    if (!profiles.length) {
      aiProfilesList.innerHTML = `<p class="meta">尚未保存 AI 配置。保存后可在这里切换当前 AI 配置。</p>`;
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
          <strong>${escapeHtml(profile.name || "未命名 AI 配置")}${active ? " · 当前配置" : ""}</strong>
          <div class="ai-profile-meta">${escapeHtml(protocolLabel)} · ${escapeHtml(profile.model || "未设置模型")} · ${escapeHtml(profile.baseUrl || "未设置地址")}</div>
          <div class="ai-profile-meta">推理强度：${escapeHtml(profile.reasoningEffort || "未设置")} · 附加指令：${profile.promptInstruction ? "已配置" : "未配置"}</div>
          <div class="ai-profile-meta">API Key：${profile.keyConfigured ? escapeHtml(profile.keyMask || "••••••••") : "未配置"}</div>
        </div>
        <div class="ai-profile-actions">
          <button type="button" class="secondary" data-action="ai-edit-profile" data-id="${escapeHtml(profile.id)}">编辑</button>
          <button type="button" class="secondary" data-action="ai-diagnose-profile" data-id="${escapeHtml(profile.id)}">诊断</button>
          ${active ? "" : `<button type="button" class="primary" data-action="ai-activate-profile" data-id="${escapeHtml(profile.id)}">设为当前配置</button>`}
          <button type="button" class="danger" data-action="ai-delete-profile" data-id="${escapeHtml(profile.id)}">删除</button>
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
    renderAiDiagnostics();
  }

  async function loadAiStatus() {
    const data = await api("/api/admin/ai/status", null, { method: "GET" });
    renderAiStatus(data);
  }

  const diagnosticStatusLabels = {
    passed: "通过",
    failed: "失败",
    timeout: "超时"
  };

  const diagnosticProtocolLabels = {
    "openai-chat": "OpenAI Chat / 兼容",
    "openai-responses": "OpenAI Responses",
    "anthropic-messages": "Anthropic Messages"
  };

  function diagnosticCheckLabel(value) {
    return value ? "通过" : "未通过";
  }

  function diagnosticUsageLabel(usage) {
    const value = usage && typeof usage === "object" ? usage : {};
    const input = Number.isSafeInteger(value.inputTokens) ? value.inputTokens : null;
    const output = Number.isSafeInteger(value.outputTokens) ? value.outputTokens : null;
    return `输入 ${input === null ? "未知" : input} · 输出 ${output === null ? "未知" : output}`;
  }

  function renderAiDiagnostics() {
    if (!aiDiagnosticsList) return;
    const entries = Object.entries(state.ai.diagnostics || {});
    if (!entries.length) {
      aiDiagnosticsList.innerHTML = '<span class="meta">选择 AI 配置后点击“诊断”</span>';
      return;
    }
    aiDiagnosticsList.innerHTML = entries.map(([profileId, raw]) => {
      if (raw && raw.loading) {
        const profile = state.ai.profiles.find((item) => item.id === profileId);
        return `<div class="ai-diagnostic-result"><strong>${escapeHtml(profile ? profile.name : profileId)}：诊断中…</strong></div>`;
      }
      const result = aiModel.normalizeDiagnostic(raw);
      const profile = result.profile;
      const statusLabel = diagnosticStatusLabels[result.status] || "失败";
      const statusClass = result.status === "passed" ? "is-pass" : "is-fail";
      const checks = result.checks;
      const warningText = result.warnings.length ? `\n提示：${result.warnings.join("；")}` : "";
      const errorText = result.errorCode ? `\n错误码：${result.errorCode}` : "";
      const requestIdText = result.providerRequestId ? `\nProvider request id：${result.providerRequestId}` : "";
      const reasoningText = profile.protocol === "openai-responses"
        ? `\nreasoning_effort：${result.reasoningEffortApplied ? "已随请求发送（仅表示 Provider 接受/拒绝请求，不代表能力证明）" : "未发送"}`
        : "";
      return `<div class="ai-diagnostic-result ${statusClass}">
        <strong>${escapeHtml(profile.name || profile.id || profileId)}：${escapeHtml(statusLabel)}</strong>
        <div>协议：${escapeHtml(diagnosticProtocolLabels[profile.protocol] || profile.protocol || "未知")} · 模型：${escapeHtml(profile.model || "未设置")}</div>
        <div>检查：可达 ${escapeHtml(diagnosticCheckLabel(checks.reachable))} · JSON ${escapeHtml(diagnosticCheckLabel(checks.responseJson))} · 文本 ${escapeHtml(diagnosticCheckLabel(checks.textExtracted))} · 探针 ${escapeHtml(diagnosticCheckLabel(checks.probeMatched))} · 响应大小 ${escapeHtml(diagnosticCheckLabel(checks.responseWithinLimit))} · usage ${escapeHtml(checks.usageReported ? "已返回" : "未知")}</div>
        <div>HTTP：${escapeHtml(result.httpStatus === null ? "未知" : result.httpStatus)} · 耗时：${escapeHtml(result.durationMs === null ? "未知" : `${result.durationMs} ms`)} · 用量：${escapeHtml(diagnosticUsageLabel(result.usage))}</div>${reasoningText ? `<div>${escapeHtml(reasoningText.slice(1))}</div>` : ""}${requestIdText ? `<div>${escapeHtml(requestIdText.slice(1))}</div>` : ""}${warningText ? `<div>${escapeHtml(warningText.slice(1))}</div>` : ""}${errorText ? `<div>${escapeHtml(errorText.slice(1))}</div>` : ""}
        <div class="meta">检查时间：${escapeHtml(formatDateTimeDisplay(result.checkedAt))}</div>
      </div>`;
    }).join("");
  }

  async function diagnoseAiProfile(id, button) {
    const profile = state.ai.profiles.find((item) => item.id === id);
    if (!profile) return;
    clearMessage(aiDiagnosticMsg);
    state.ai.diagnostics[id] = { loading: true };
    renderAiDiagnostics();
    try {
      const data = await api("/api/admin/ai/profiles/diagnose", { profileId: id });
      state.ai.diagnostics[id] = aiModel.normalizeDiagnostic(data);
      renderAiDiagnostics();
      const result = state.ai.diagnostics[id];
      notify(aiDiagnosticMsg, result.status === "passed" ? "ok" : "error", result.status === "passed"
        ? `Provider 诊断通过：${profile.name || id}`
        : `Provider 诊断${diagnosticStatusLabels[result.status] || "失败"}：${result.errorCode || "请查看诊断结果"}`);
    } catch (error) {
      delete state.ai.diagnostics[id];
      renderAiDiagnostics();
      throw error;
    } finally {
      if (button && button.isConnected) {
        button.disabled = false;
      }
    }
  }

  function metricOperationLabel(operation) {
    return ({
      copilot_suggest: "Copilot 建议",
      knowledge_ask: "知识问答",
      provider_diagnostic: "Provider 诊断"
    }[operation]) || operation || "未知操作";
  }

  function renderAiMetrics(data) {
    if (!aiMetricsSummary) return;
    const metrics = aiModel.normalizeMetrics(data);
    state.ai.metrics = metrics;
    const average = metrics.averageDurationMs === null ? "未知" : `${Math.round(metrics.averageDurationMs)} ms`;
    aiMetricsSummary.innerHTML = `<div class="ai-metrics-summary">
      <div class="stat"><span class="k">总请求</span><span class="v">${escapeHtml(metrics.total)}</span></div>
      <div class="stat"><span class="k">成功 / 失败</span><span class="v">${escapeHtml(metrics.success)} / ${escapeHtml(metrics.failed)}</span></div>
      <div class="stat"><span class="k">超时</span><span class="v">${escapeHtml(metrics.timeout)}</span></div>
      <div class="stat"><span class="k">平均耗时</span><span class="v">${escapeHtml(average)}</span></div>
    </div>
    <div class="meta">输入 token 合计：${escapeHtml(metrics.inputTokens === null ? "未知" : metrics.inputTokens)} · 输出 token 合计：${escapeHtml(metrics.outputTokens === null ? "未知" : metrics.outputTokens)} · 未知用量：${escapeHtml(metrics.unknownUsageCount)} 次</div>
    <div class="ai-metrics-groups">${metrics.groups.length ? metrics.groups.map((group) => `<div class="ai-metrics-group"><strong>${escapeHtml(metricOperationLabel(group.operation))}</strong> · ${escapeHtml(diagnosticProtocolLabels[group.protocol] || group.protocol || "未知协议")}：${escapeHtml(group.total)} 次，成功 ${escapeHtml(group.success)}，失败 ${escapeHtml(group.failed)}，超时 ${escapeHtml(group.timeout)}，平均 ${escapeHtml(group.averageDurationMs === null ? "未知" : `${Math.round(group.averageDurationMs)} ms`)}</div>`).join("") : '<span class="meta">当前时间窗暂无请求指标。</span>'}</div>`;
  }

  async function loadAiMetrics() {
    if (!aiMetricsSummary) return;
    const button = document.getElementById("aiMetricsRefreshBtn");
    const hoursInput = document.getElementById("aiMetricsHours");
    const hours = [24, 168, 720].includes(Number(hoursInput && hoursInput.value)) ? Number(hoursInput.value) : 24;
    if (hoursInput) hoursInput.value = String(hours);
    await withButtonBusy(button, "加载中…", async () => {
      clearMessage(aiMetricsMsg);
      const data = await api(`/api/admin/ai/metrics?hours=${encodeURIComponent(hours)}`, null, { method: "GET" });
      renderAiMetrics(data);
      notify(aiMetricsMsg, "ok", `指标已刷新（最近 ${hours >= 168 ? `${Math.round(hours / 24)} 天` : `${hours} 小时`}）`);
    });
  }

  function knowledgeReasonLabel(reason, available) {
    if (available) return "就绪";
    return ({
      "config-invalid": "配置无效",
      "not-indexed": "尚未建立索引",
      "cache-invalid": "索引缓存不可用"
    }[reason]) || "暂不可用";
  }

  function knowledgeSummaryText(summary) {
    const value = summary && typeof summary === "object" ? summary : {};
    const files = Number(value.indexedFiles || value.fileCount || 0);
    const chunks = Number(value.chunkCount || value.chunks || 0);
    const bytes = Number(value.totalBytes || 0);
    const parts = [];
    if (Number.isFinite(files) && files >= 0) parts.push(`${files} 个文件`);
    if (Number.isFinite(chunks) && chunks >= 0) parts.push(`${chunks} 个片段`);
    if (Number.isFinite(bytes) && bytes > 0) parts.push(`${Math.round(bytes / 1024)} KiB`);
    return parts.length ? parts.join(" · ") : "暂无索引统计";
  }

  function renderKnowledgeRoots(roots) {
    const items = Array.isArray(roots) ? roots : [];
    knowledgeRoots.innerHTML = items.length
      ? items.map((root) => `<span class="knowledge-root-tag">${escapeHtml(root.name || root.id || "未命名知识库")}${root.indexed ? " · 已索引" : " · 待索引"}</span>`).join("")
      : '<span class="meta">未配置知识库目录</span>';
    const selected = knowledgeRootFilter.value;
    knowledgeRootFilter.innerHTML = '<option value="">全部知识库</option>' + items
      .map((root) => `<option value="${escapeHtml(root.id || "")}">${escapeHtml(root.name || root.id || "未命名知识库")}</option>`)
      .join("");
    if (items.some((root) => root.id === selected)) knowledgeRootFilter.value = selected;
  }

  function renderKnowledgeStatus(data) {
    const value = data && typeof data === "object" ? data : {};
    const available = value.available === true;
    state.knowledge.loaded = true;
    state.knowledge.available = available;
    state.knowledge.reason = typeof value.reason === "string" ? value.reason : "";
    state.knowledge.roots = Array.isArray(value.roots) ? value.roots : [];
    state.knowledge.autoCleanup = value.autoCleanup !== false;
    state.knowledge.retentionDays = Number.isSafeInteger(Number(value.retentionDays)) ? Number(value.retentionDays) : 30;
    knowledgeStatusText.textContent = knowledgeReasonLabel(state.knowledge.reason, available);
    knowledgeStatusBadge.textContent = available ? "INDEX ONLINE" : "INDEX OFFLINE";
    knowledgeStatusBadge.className = `badge ${available ? "is-online" : "is-offline"}`;
    knowledgeIndexSummary.textContent = `${knowledgeSummaryText(value.summary)} · 保留 ${state.knowledge.retentionDays} 天${value.builtAt ? ` · 构建于 ${formatDateTimeDisplay(value.builtAt)}` : ""}`;
    renderKnowledgeRoots(state.knowledge.roots);
    document.getElementById("knowledgeAutoCleanup").checked = state.knowledge.autoCleanup;
  }

  async function loadKnowledgeStatus() {
    const data = await api("/api/admin/ai/knowledge/status", null, { method: "GET" });
    renderKnowledgeStatus(data);
  }

  function knowledgeBasisLabel(basis) {
    return ({ document: "文档依据", mixed: "文档 + 基础知识", general: "非文档依据/未验证" }[basis]) || "未标注依据";
  }

  function renderKnowledgeSources(sources) {
    const items = Array.isArray(sources) ? sources : [];
    knowledgeSources.innerHTML = items.length
      ? items.map((source) => `<article class="knowledge-source"><strong>[${escapeHtml(source.sourceId || "-")}] ${escapeHtml(source.title || "未命名片段")}</strong><span class="meta">${escapeHtml(source.libraryName || "知识库")} / ${escapeHtml(source.relativePath || "-")}</span><p>${escapeHtml(source.excerpt || "暂无片段")}</p></article>`).join("")
      : '<span class="meta">暂无引用来源</span>';
  }

  function renderKnowledgeAnswer(data) {
    const value = data && typeof data === "object" ? data : {};
    state.knowledge.answer = value;
    knowledgeAnswerCard.classList.remove("hidden");
    knowledgeAnswer.textContent = value.answer || "暂无回答";
    knowledgeBasis.textContent = knowledgeBasisLabel(value.basis);
    knowledgeCaveats.textContent = value.caveats || "";
    knowledgeCaveats.classList.toggle("hidden", !value.caveats);
    renderKnowledgeSources(value.sources);
  }

  function renderKnowledgeHistory(data) {
    const value = data && typeof data === "object" ? data : {};
    const items = Array.isArray(value.items) ? value.items : [];
    state.knowledge.history = {
      page: Number(value.page) || 1,
      pageSize: Number(value.pageSize) || 10,
      totalPages: Number(value.totalPages) || 0,
      total: Number(value.total) || 0,
      items
    };
    if (!items.length) {
      knowledgeHistoryList.innerHTML = '<p class="empty-state">暂无问答历史。</p>';
    } else {
      knowledgeHistoryList.innerHTML = items.map((item) => `<article class="knowledge-history-item">
        <div class="knowledge-history-item-head"><strong>${escapeHtml(item.question || "未记录问题")}</strong><button type="button" class="danger" data-action="knowledge-history-delete" data-id="${escapeHtml(item.id)}">删除</button></div>
        <div class="meta">${escapeHtml(formatDateTimeDisplay(item.createdAt))} · ${escapeHtml(knowledgeBasisLabel(item.basis))}${item.expired ? " · 已过期" : ""}</div>
        <p>${escapeHtml(item.answer || "暂无回答")}</p>
        ${item.caveats ? `<div class="knowledge-history-caveat">${escapeHtml(item.caveats)}</div>` : ""}
      </article>`).join("");
    }
    document.getElementById("knowledgeHistoryPageText").textContent = `第 ${state.knowledge.history.page} / ${state.knowledge.history.totalPages || 1} 页 · 总计 ${state.knowledge.history.total} 条`;
    document.getElementById("knowledgeHistoryPrevBtn").disabled = state.knowledge.history.page <= 1;
    document.getElementById("knowledgeHistoryNextBtn").disabled = !state.knowledge.history.totalPages || state.knowledge.history.page >= state.knowledge.history.totalPages;
  }

  async function loadKnowledgeHistory() {
    clearMessage(knowledgeHistoryMsg);
    const history = state.knowledge.history;
    const query = new URLSearchParams({ page: String(history.page || 1), pageSize: String(history.pageSize || 10) });
    const data = await api(`/api/admin/ai/knowledge/history?${query.toString()}`, null, { method: "GET" });
    renderKnowledgeHistory(data);
  }

  async function reindexKnowledge() {
    const btn = document.getElementById("knowledgeReindexBtn");
    await withButtonBusy(btn, "重建中...", async () => {
      clearMessage(knowledgeStatusMsg);
      const data = await api("/api/admin/ai/knowledge/reindex", {});
      await loadKnowledgeStatus();
      notify(knowledgeStatusMsg, "ok", `索引已重建：${knowledgeSummaryText(data.summary)}`);
    });
  }

  async function askKnowledgeQuestion() {
    clearMessage(knowledgeAskMsg);
    const questionInput = document.getElementById("knowledgeQuestion");
    const question = questionInput.value.trim();
    if (!question) {
      showMessage(knowledgeAskMsg, "error", "请输入问题");
      questionInput.focus();
      return;
    }
    const btn = document.getElementById("knowledgeAskBtn");
    await withButtonBusy(btn, "回答中...", async () => {
      const data = await api("/api/admin/ai/knowledge/ask", {
        question,
        rootId: knowledgeRootFilter.value
      });
      renderKnowledgeAnswer(data);
      state.knowledge.history.page = 1;
      await loadKnowledgeHistory();
      notify(knowledgeAskMsg, "ok", "回答已生成，请结合引用来源核验");
    });
  }

  async function deleteKnowledgeHistory(id, button) {
    if (!confirm("确认删除这条知识问答历史吗？")) return;
    await withButtonBusy(button, "删除中...", async () => {
      await api("/api/admin/ai/knowledge/history/delete", { id: Number(id) });
      await loadKnowledgeHistory();
      notify(knowledgeHistoryMsg, "ok", "问答历史已删除");
    });
  }

  async function cleanupKnowledgeHistory() {
    const btn = document.getElementById("knowledgeCleanupBtn");
    await withButtonBusy(btn, "清理中...", async () => {
      const data = await api("/api/admin/ai/knowledge/history/cleanup", {});
      await loadKnowledgeHistory();
      notify(knowledgeHistoryMsg, "ok", `已清理 ${Number(data.deleted) || 0} 条过期记录`);
    });
  }

  async function saveKnowledgeSettings() {
    const btn = document.getElementById("knowledgeSettingsSaveBtn");
    await withButtonBusy(btn, "保存中...", async () => {
      const data = await api("/api/admin/ai/knowledge/settings", {
        autoCleanup: document.getElementById("knowledgeAutoCleanup").checked
      });
      state.knowledge.autoCleanup = data.autoCleanup === true;
      notify(knowledgeHistoryMsg, "ok", `自动清理已${state.knowledge.autoCleanup ? "启用" : "关闭"}`);
    });
  }

  function resetAiProfileForm() {
    document.getElementById("aiProfileId").value = "";
    document.getElementById("aiProfileName").value = "";
    document.getElementById("aiProfileProtocol").value = "openai-chat";
    document.getElementById("aiProfileBaseUrl").value = "";
    document.getElementById("aiProfileModel").value = "";
    document.getElementById("aiProfileReasoningEffort").value = "";
    document.getElementById("aiProfileApiKey").value = "";
    document.getElementById("aiProfilePromptInstruction").value = "";
    updateAiProtocolHint();
  }

  function updateAiProtocolHint() {
    const protocol = document.getElementById("aiProfileProtocol").value;
    const hint = document.getElementById("aiProfileProtocolHint");
    if (!hint) return;
    hint.textContent = protocol === "openai-responses"
      ? "Responses 协议会应用推理强度；附加工作指令只调整回答风格。"
      : "当前协议不会发送 reasoning_effort；附加工作指令只调整回答风格。";
  }

  function editAiProfile(id) {
    const profile = state.ai.profiles.find((item) => item.id === id);
    if (!profile) return;
    document.getElementById("aiProfileId").value = profile.id;
    document.getElementById("aiProfileName").value = profile.name;
    document.getElementById("aiProfileProtocol").value = profile.protocol;
    document.getElementById("aiProfileBaseUrl").value = profile.baseUrl;
    document.getElementById("aiProfileModel").value = profile.model;
    document.getElementById("aiProfileReasoningEffort").value = profile.reasoningEffort || "";
    document.getElementById("aiProfileApiKey").value = "";
    document.getElementById("aiProfilePromptInstruction").value = profile.promptInstruction || "";
    updateAiProtocolHint();
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
      reasoningEffort: document.getElementById("aiProfileReasoningEffort").value,
      promptInstruction: document.getElementById("aiProfilePromptInstruction").value,
      key: document.getElementById("aiProfileApiKey").value
    };
    const btn = document.getElementById("aiProfileSaveBtn");
    await withButtonBusy(btn, "保存中...", async () => {
      await api("/api/admin/ai/profiles", payload);
      await loadAiStatus();
      resetAiProfileForm();
      notify(aiStatusMsg, "ok", "AI 配置已保存");
    });
  }

  async function activateAiProfile(id) {
    const btn = Array.from(document.querySelectorAll('button[data-action="ai-activate-profile"]'))
      .find((candidate) => candidate.dataset.id === id);
    const run = async () => {
      await api("/api/admin/ai/profiles/active", { id });
      await loadAiStatus();
      notify(aiStatusMsg, "ok", "当前 AI 配置已切换，新请求将使用该配置");
    };
    if (btn) await withButtonBusy(btn, "切换中...", run);
    else await run();
  }

  async function deleteAiProfile(id) {
    const profile = state.ai.profiles.find((item) => item.id === id);
    if (!profile || !confirm(`确认删除 AI 配置“${profile.name || id}”吗？`)) return;
    const btn = Array.from(document.querySelectorAll('button[data-action="ai-delete-profile"]'))
      .find((candidate) => candidate.dataset.id === id);
    const run = async () => {
      await api("/api/admin/ai/profiles/delete", { id });
      await loadAiStatus();
      if (document.getElementById("aiProfileId").value === id) resetAiProfileForm();
      notify(aiStatusMsg, "ok", "AI 配置已删除");
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
        <p class="ai-suggestion-note" role="status" aria-live="polite">正在请求当前 AI 配置，请稍候……</p>
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
      <article class="item" data-item-id="${escapeHtml(item.id)}" tabindex="-1">
        <h3>[反馈 #${item.id}] ${escapeHtml(item.title)}</h3>
        <div class="meta">类型：${escapeHtml(item.type)} | 状态：${feedbackStatusLabel(item.status)} | 首页展示状态：${homeDisplayLabel(Boolean(item.showOnHome))} | 联系方式：${escapeHtml(item.contact)} | 提交：${escapeHtml(formatDateTimeDisplay(item.createdAt))}</div>
        <div class="meta">关联账号：${escapeHtml(accountSnapshotText(item))}</div>
        <div class="content">${linkifySafeText(item.content)}</div>
        <section class="project-source-control" data-project-source-control data-source-type="feedback" data-source-id="${escapeHtml(item.id)}">
          <div class="project-source-control-head"><strong>项目归属</strong><button type="button" data-action="project-source-load" data-source-type="feedback" data-source-id="${escapeHtml(item.id)}">加载项目归属</button></div>
          <div class="project-source-panel meta">点击加载当前项目关系。</div>
        </section>
        <div class="ops">
          <button type="button" data-action="feedback-status" data-id="${item.id}" data-status="new" ${item.status === "new" ? "disabled" : ""}>新反馈</button>
          <button type="button" data-action="feedback-status" data-id="${item.id}" data-status="reviewed" ${item.status === "reviewed" ? "disabled" : ""}>已查看</button>
          <button type="button" data-action="feedback-status" data-id="${item.id}" data-status="resolved" ${item.status === "resolved" ? "disabled" : ""}>已解决</button>
          <button type="button" data-action="feedback-status" data-id="${item.id}" data-status="notplanned" ${item.status === "notplanned" ? "disabled" : ""}>暂不处理</button>
          <button type="button" data-action="feedback-home-display" data-id="${item.id}" data-show="${item.showOnHome ? "0" : "1"}">${item.showOnHome ? "取消主页展示" : "设为主页展示"}</button>
          <button type="button" class="del" data-action="feedback-delete" data-id="${item.id}">删除</button>
        </div>
        <div class="ops ops-spaced">
          <textarea id="feedback-note-${item.id}" rows="2" placeholder="管理员备注（仅后台可见）" maxlength="2000">${escapeHtml(item.adminNote || "")}</textarea>
          <textarea id="feedback-reply-${item.id}" rows="2" placeholder="对外回复（可在主页展示）" maxlength="2000">${escapeHtml(item.publicReply || "")}</textarea>
          <button type="button" data-action="feedback-note-reply" data-id="${item.id}">保存备注/回复</button>
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
      <article class="item" data-item-id="${escapeHtml(item.id)}" tabindex="-1">
        <h3>[WorkTask #${item.id}] ${escapeHtml(item.title)}</h3>
        <div class="meta">类型：${escapeHtml(item.type)} | 来源：${item.createdByAdmin ? "本人添加" : "用户提交"} | 状态：${worktaskStatusLabel(item.status)} | 优先级：${worktaskPriorityLabel(item.priority)} | 首页展示状态：${homeDisplayLabel(Boolean(item.showOnHome))} | 联系方式：${escapeHtml(item.contact)}</div>
        <div class="meta">关联账号：${escapeHtml(accountSnapshotText(item))}</div>
        <div class="meta">期望时间：${escapeHtml(formatDateTimeDisplay(item.expectedAt))} | 计划时间：${escapeHtml(formatDateTimeDisplay(item.scheduledAt))} | 负责人：${escapeHtml(item.assignee || "未分配")} | 标签：${escapeHtml(item.tags || "-")}</div>
        <div class="content">${linkifySafeText(item.content)}</div>
        <section class="project-source-control" data-project-source-control data-source-type="worktask" data-source-id="${escapeHtml(item.id)}">
          <div class="project-source-control-head"><strong>项目归属</strong><button type="button" data-action="project-source-load" data-source-type="worktask" data-source-id="${escapeHtml(item.id)}">加载项目归属</button></div>
          <div class="project-source-panel meta">点击加载当前项目关系。</div>
        </section>
        <div class="ops">
          <button type="button" data-action="worktask-status" data-id="${item.id}" data-status="new" ${item.status === "new" ? "disabled" : ""}>新工单</button>
          <button type="button" data-action="worktask-status" data-id="${item.id}" data-status="scheduled" ${item.status === "scheduled" ? "disabled" : ""}>已安排</button>
          <button type="button" data-action="worktask-status" data-id="${item.id}" data-status="in_progress" ${item.status === "in_progress" ? "disabled" : ""}>进行中</button>
          <button type="button" data-action="worktask-status" data-id="${item.id}" data-status="completed" ${item.status === "completed" ? "disabled" : ""}>已完成</button>
          <button type="button" data-action="worktask-status" data-id="${item.id}" data-status="cancelled" ${item.status === "cancelled" ? "disabled" : ""}>已取消</button>
          <button type="button" data-action="worktask-home-display" data-id="${item.id}" data-show="${item.showOnHome ? "0" : "1"}">${item.showOnHome ? "取消主页展示" : "设为主页展示"}</button>
          <button type="button" class="del" data-action="worktask-delete" data-id="${item.id}">删除</button>
        </div>
        <div class="ops ops-spaced">
          <input id="assignee-${item.id}" placeholder="负责人（可选）" value="${escapeHtml(item.assignee || "")}">
          <input id="scheduled-${item.id}" type="datetime-local" value="${toDateTimeLocalValue(item.scheduledAt)}">
          <button type="button" data-action="worktask-arrange" data-id="${item.id}">保存安排</button>
          <button type="button" data-action="worktask-clear-assignee" data-id="${item.id}">清空负责人</button>
          <button type="button" data-action="worktask-clear-scheduled" data-id="${item.id}">清空计划时间</button>
        </div>
        <div class="ops ops-spaced">
          <textarea id="worktask-note-${item.id}" rows="2" placeholder="管理员备注（仅后台可见）" maxlength="2000">${escapeHtml(item.adminNote || "")}</textarea>
          <textarea id="worktask-reply-${item.id}" rows="2" placeholder="对外回复（可在主页展示）" maxlength="2000">${escapeHtml(item.publicReply || "")}</textarea>
          <button type="button" data-action="worktask-note-reply" data-id="${item.id}">保存备注/回复</button>
        </div>
      </article>
    `).join("");
  }

  function focusAdminListItem(sourceType, id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return;
    const listId = sourceType === "feedback" ? "feedbackList" : sourceType === "worktask" ? "worktaskList" : "";
    if (!listId) return;
    const item = document.querySelector(`#${listId} [data-item-id="${Number(id)}"]`);
    if (!item) return;
    item.classList.add("is-focused");
    if (typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (typeof item.focus === "function") item.focus({ preventScroll: true });
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
    if (state.feedback.focusId !== null) payload.id = state.feedback.focusId;
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
    focusAdminListItem("feedback", state.feedback.focusId);
    state.feedback.focusId = null;
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
    if (state.worktask.focusId !== null) payload.id = state.worktask.focusId;
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
    focusAdminListItem("worktask", state.worktask.focusId);
    state.worktask.focusId = null;
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

  const workHubSections = Object.freeze([
    { key: "overdue", listId: "workHubOverdue", statusId: "workHubOverdueStatus", countId: "workHubOverdueCount" },
    { key: "upcoming", listId: "workHubUpcoming", statusId: "workHubUpcomingStatus", countId: "workHubUpcomingCount" },
    { key: "unassigned", listId: "workHubUnassigned", statusId: "workHubUnassignedStatus", countId: "workHubUnassignedCount" },
    { key: "recent", listId: "workHubRecent", statusId: "workHubRecentStatus", countId: "workHubRecentCount" }
  ]);

  function normalizeWorkHubItem(raw) {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const sourceType = value.sourceType === "feedback" || value.sourceType === "worktask" ? value.sourceType : "";
    const sourceId = Number(value.sourceId);
    if (!sourceType || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
    const project = value.project && typeof value.project === "object" && Number.isSafeInteger(Number(value.project.id)) && Number(value.project.id) > 0
      ? { id: Number(value.project.id), name: typeof value.project.name === "string" ? value.project.name.slice(0, 120) : "" }
      : null;
    return {
      sourceType,
      sourceId,
      title: typeof value.title === "string" ? value.title : "",
      type: typeof value.type === "string" ? value.type : "",
      status: typeof value.status === "string" ? value.status : "",
      priority: typeof value.priority === "string" ? value.priority : "",
      assignee: typeof value.assignee === "string" ? value.assignee : "",
      scheduledAt: typeof value.scheduledAt === "string" ? value.scheduledAt : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
      project
    };
  }

  function workHubSourceLabel(sourceType) {
    return sourceType === "worktask" ? "WorkTask" : "反馈";
  }

  function workHubItemTime(item, sectionKey) {
    if (sectionKey === "overdue" || sectionKey === "upcoming") {
      return item.scheduledAt ? `计划：${formatDateTimeDisplay(item.scheduledAt)}` : "计划：未设置";
    }
    return item.updatedAt ? `更新：${formatDateTimeDisplay(item.updatedAt)}` : "更新：未知";
  }

  function renderWorkHubItem(item, sectionKey) {
    const sourceType = escapeHtml(item.sourceType);
    const sourceId = escapeHtml(item.sourceId);
    const sourceLabel = escapeHtml(workHubSourceLabel(item.sourceType));
    const project = item.project && item.project.id > 0 ? item.project : null;
    const worktaskMeta = item.sourceType === "worktask"
      ? `<span>优先级：${escapeHtml(worktaskPriorityLabel(item.priority))}</span><span>负责人：${escapeHtml(item.assignee || "未分配")}</span>`
      : "";
    return `<article class="work-hub-item">
      <div class="work-hub-item-head"><span class="work-hub-source">${sourceLabel} #${sourceId}</span><span class="work-hub-native-status">${escapeHtml(item.sourceType === "worktask" ? worktaskStatusLabel(item.status) : feedbackStatusLabel(item.status))}</span></div>
      <h4>${escapeHtml(item.title || "无标题")}</h4>
      <div class="work-hub-item-meta"><span>类型：${escapeHtml(item.type || "未标注")}</span>${worktaskMeta}<span>${escapeHtml(workHubItemTime(item, sectionKey))}</span><span>项目：${escapeHtml(project ? project.name : "未归属")}</span></div>
      <div class="work-hub-item-actions">
        <button type="button" class="secondary" data-action="work-hub-open-item" data-source-type="${sourceType}" data-source-id="${sourceId}">查看条目</button>
        ${project ? `<button type="button" class="secondary" data-action="work-hub-open-project" data-project-id="${escapeHtml(project.id)}">查看项目</button>` : ""}
      </div>
    </article>`;
  }

  function renderWorkHubSection(sectionConfig, rawSection) {
    const list = document.getElementById(sectionConfig.listId);
    const status = document.getElementById(sectionConfig.statusId);
    const count = document.getElementById(sectionConfig.countId);
    if (!list || !status || !count) return;
    const section = rawSection && typeof rawSection === "object" ? rawSection : {};
    const items = Array.isArray(section.items) ? section.items.map(normalizeWorkHubItem).filter(Boolean) : [];
    count.textContent = String(items.length);
    list.setAttribute("aria-busy", "false");
    if (section.status === "error") {
      status.className = "work-hub-status is-error";
      status.innerHTML = '<span>该分区暂时无法加载。</span> <button type="button" class="secondary" data-action="work-hub-retry">重试 Work Hub</button>';
      list.innerHTML = '<p class="empty-state">暂时没有可显示的记录。</p>';
      return;
    }
    if (section.status === "partial") {
      status.className = "work-hub-status is-partial";
      status.textContent = "部分来源暂时不可用，以下为当前可用记录。";
    } else {
      status.className = "work-hub-status";
      status.textContent = "";
    }
    list.innerHTML = items.length
      ? items.map((item) => renderWorkHubItem(item, sectionConfig.key)).join("")
      : '<p class="empty-state">当前没有符合条件的记录。</p>';
  }

  function renderWorkHubLoading() {
    for (const section of workHubSections) {
      const list = document.getElementById(section.listId);
      const status = document.getElementById(section.statusId);
      const count = document.getElementById(section.countId);
      if (list) {
        list.setAttribute("aria-busy", "true");
        list.innerHTML = '<p class="empty-state">正在加载…</p>';
      }
      if (status) {
        status.className = "work-hub-status";
        status.textContent = "正在读取…";
      }
      if (count) count.textContent = "-";
    }
  }

  function renderWorkHub(data) {
    const value = data && typeof data === "object" ? data : {};
    state.workHub.data = value;
    for (const section of workHubSections) {
      renderWorkHubSection(section, value.sections && value.sections[section.key]);
    }
    const sources = value.sources && typeof value.sources === "object" ? value.sources : {};
    const allFailed = [sources.feedback, sources.worktask].every((source) => source && source.status === "error");
    if (allFailed) {
      showMessage(workHubMsg, "error", "Work Hub 暂时无法读取任何来源，请重试。 ");
      workHubMsg.innerHTML = 'Work Hub 暂时无法读取任何来源，请重试。 <button type="button" class="secondary" data-action="work-hub-retry">重试 Work Hub</button>';
    } else if (sources.feedback && sources.feedback.status === "error" || sources.worktask && sources.worktask.status === "error") {
      showMessage(workHubMsg, "error", "部分来源暂时不可用，已在对应分区标注。 ");
      workHubMsg.innerHTML = '部分来源暂时不可用，已在对应分区标注。 <button type="button" class="secondary" data-action="work-hub-retry">重试 Work Hub</button>';
    } else {
      clearMessage(workHubMsg);
    }
    if (value.generatedAt) {
      document.getElementById("globalLoadTime").textContent = `最近加载：${formatDateTimeDisplay(value.generatedAt)}`;
    }
  }

  async function loadWorkHub() {
    if (!moduleWorkHub) return;
    const requestId = state.workHub.requestId + 1;
    state.workHub.requestId = requestId;
    state.workHub.loading = true;
    clearMessage(workHubMsg);
    renderWorkHubLoading();
    try {
      const data = await api("/api/admin/work-hub/overview", null, { method: "GET" });
      if (requestId !== state.workHub.requestId) return;
      state.workHub.loaded = true;
      renderWorkHub(data);
    } catch (error) {
      if (requestId !== state.workHub.requestId) return;
      state.workHub.loaded = false;
      for (const section of workHubSections) {
        const list = document.getElementById(section.listId);
        const status = document.getElementById(section.statusId);
        if (list) {
          list.setAttribute("aria-busy", "false");
          list.innerHTML = '<p class="empty-state">Work Hub 请求失败。</p>';
        }
        if (status) {
          status.className = "work-hub-status is-error";
          status.textContent = "请求失败";
        }
      }
      showMessage(workHubMsg, "error", "Work Hub 加载失败，请检查登录状态后重试。");
      throw error;
    } finally {
      if (requestId === state.workHub.requestId) state.workHub.loading = false;
    }
  }

  function openWorkHubItem(button) {
    const sourceType = button.dataset.sourceType;
    const sourceId = Number(button.dataset.sourceId);
    if (!["feedback", "worktask"].includes(sourceType) || !Number.isSafeInteger(sourceId) || sourceId <= 0) return;
    if (sourceType === "feedback") {
      state.feedback.focusId = sourceId;
      state.feedback.page = 1;
      state.feedback.loaded = false;
      document.getElementById("feedbackStatusFilter").value = "";
      document.getElementById("feedbackKeyword").value = "";
      switchModule("feedback");
    } else {
      state.worktask.focusId = sourceId;
      state.worktask.page = 1;
      state.worktask.loaded = false;
      document.getElementById("worktaskStatusFilter").value = "";
      document.getElementById("worktaskPriorityFilter").value = "";
      document.getElementById("worktaskKeyword").value = "";
      switchModule("worktask");
    }
  }

  async function handleWorkHubAction(button) {
    const action = button.dataset.action;
    if (action === "work-hub-open-item") {
      openWorkHubItem(button);
      return;
    }
    if (action === "work-hub-open-project") {
      const id = Number(button.dataset.projectId);
      if (!Number.isSafeInteger(id) || id <= 0) return;
      window.location.hash = projectModel.projectHash(id).slice(1);
      switchModule("projects");
      try { await loadProjectDetail(id); } catch (error) { notify(projectMsg, "error", error.message); }
      return;
    }
    if (action === "work-hub-retry") {
      state.workHub.loaded = false;
      try { await loadWorkHub(); } catch (error) { notify(workHubMsg, "error", error.message); }
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

  function projectCompletionLabel(value) {
    return Number.isSafeInteger(value) ? `${value}%` : "未设置";
  }

  function projectStatusLabel(status) {
    return status === "archived" ? "已归档" : "活跃";
  }

  function projectPublicLabel(publicBasic) {
    return publicBasic ? "公开" : "未公开";
  }

  function projectSourceMessage(sourceType) {
    return sourceType === "worktask" ? worktaskMsg : feedbackMsg;
  }

  function projectSourceMilestoneOptions(detail, selectedId) {
    const selected = selectedId === null || selectedId === undefined ? "" : String(selectedId);
    const milestones = detail && Array.isArray(detail.milestones)
      ? detail.milestones.filter((item) => item && item.status === "active")
      : [];
    return `<option value="">不关联里程碑</option>${milestones.map((item) => `<option value="${escapeHtml(item.id)}"${String(item.id) === selected ? " selected" : ""}>${escapeHtml(item.title || `里程碑 ${item.id}`)}</option>`).join("")}`;
  }

  function projectSourceProjectOptions(projects, selectedId) {
    const selected = selectedId === null || selectedId === undefined ? "" : String(selectedId);
    return `<option value="">选择活跃项目</option>${projects.map((item) => `<option value="${escapeHtml(item.id)}"${String(item.id) === selected ? " selected" : ""}>${escapeHtml(item.name || `项目 ${item.id}`)}</option>`).join("")}`;
  }

  function renderProjectSourceControl(container, relation, projects, currentDetail) {
    const panel = container && container.querySelector(".project-source-panel");
    if (!panel) return;
    const sourceType = container.dataset.sourceType;
    const sourceId = Number(container.dataset.sourceId);
    if (relation && Number.isSafeInteger(Number(relation.projectId)) && Number(relation.projectId) > 0) {
      const project = currentDetail && currentDetail.project
        ? currentDetail.project
        : projects.find((item) => Number(item.id) === Number(relation.projectId));
      const projectName = project && project.name ? project.name : `项目 #${relation.projectId}`;
      const status = project && project.status === "archived" ? "已归档" : "活跃";
      panel.innerHTML = `<div class="project-source-current"><span>当前项目：<strong>${escapeHtml(projectName)}</strong> · ${escapeHtml(status)}</span><button type="button" data-action="project-source-open" data-project-id="${escapeHtml(relation.projectId)}">打开项目</button></div>
        <div class="project-source-edit"><label>里程碑<select data-action-field="project-source-milestone">${projectSourceMilestoneOptions(currentDetail, relation.milestoneId)}</select></label><button type="button" data-action="project-source-save" data-project-id="${escapeHtml(relation.projectId)}">保存里程碑</button><button type="button" class="danger" data-action="project-source-unassign">解绑</button></div>`;
      container._projectSource = { relation, projects, detail: currentDetail };
      return;
    }
    panel.innerHTML = `<div class="project-source-edit"><label>项目<select data-action-field="project-source-project">${projectSourceProjectOptions(projects, "")}</select></label><label>里程碑<select data-action-field="project-source-milestone" disabled><option value="">选择项目后加载</option></select></label><button type="button" class="primary" data-action="project-source-bind">绑定</button></div><p class="meta">来源目前未归类；移动到其他项目需先解绑原归属。</p>`;
    container._projectSource = { relation: null, projects, detail: null };
    void sourceType;
    void sourceId;
  }

  async function loadProjectSourceMilestones(container, projectId) {
    const parsedId = Number(projectId);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) return;
    const detail = await api(`/api/admin/project/${parsedId}`, null, { method: "GET" });
    const sourceState = container._projectSource || { relation: null, projects: [] };
    sourceState.detail = detail;
    sourceState.selectedProjectId = parsedId;
    container._projectSource = sourceState;
    const select = container.querySelector('[data-action-field="project-source-milestone"]');
    if (select) {
      select.disabled = false;
      select.innerHTML = projectSourceMilestoneOptions(detail, sourceState.relation ? sourceState.relation.milestoneId : null);
    }
  }

  async function loadProjectSourceControl(container, trigger) {
    if (!container) return;
    const sourceType = container.dataset.sourceType;
    const sourceId = Number(container.dataset.sourceId);
    if (!projectModel || !["feedback", "worktask"].includes(sourceType) || !Number.isSafeInteger(sourceId) || sourceId <= 0) return;
    const run = async () => {
      const relationData = await api(`/api/admin/project/item?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`, null, { method: "GET" });
      const relation = relationData && relationData.sourceType ? relationData : null;
      const projectList = await api("/api/admin/project/list", { status: "active", page: 1, pageSize: 100 });
      const projects = Array.isArray(projectList.items) ? projectList.items.map(projectModel.normalizeProjectSummary) : [];
      let currentDetail = null;
      if (relation && relation.projectId) {
        try {
          currentDetail = await api(`/api/admin/project/${Number(relation.projectId)}`, null, { method: "GET" });
        } catch (_) {
          currentDetail = null;
        }
      }
      renderProjectSourceControl(container, relation, projects, currentDetail);
    };
    await withButtonBusy(trigger || container.querySelector('[data-action="project-source-load"]'), "加载中…", run);
  }

  async function handleProjectSourceAction(button) {
    const container = button.closest("[data-project-source-control]");
    if (!container) return;
    const sourceType = container.dataset.sourceType;
    const sourceId = Number(container.dataset.sourceId);
    if (button.dataset.action === "project-source-load") {
      await loadProjectSourceControl(container, button);
      return;
    }
    if (button.dataset.action === "project-source-open") {
      const projectId = Number(button.dataset.projectId);
      window.location.hash = projectModel.projectHash(projectId).slice(1);
      switchModule("projects");
      await loadProjectDetail(projectId);
      return;
    }
    const sourceState = container._projectSource || {};
    const relation = sourceState.relation;
    const panel = container.querySelector(".project-source-panel");
    if (button.dataset.action === "project-source-bind") {
      const projectSelect = panel && panel.querySelector('[data-action-field="project-source-project"]');
      const milestoneSelect = panel && panel.querySelector('[data-action-field="project-source-milestone"]');
      const projectId = Number(projectSelect && projectSelect.value);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("请先选择活跃项目");
      await withButtonBusy(button, "绑定中…", async () => {
        await api("/api/admin/project/item/assign", { projectId, sourceType, sourceId, milestoneId: milestoneSelect && milestoneSelect.value ? Number(milestoneSelect.value) : null });
        await loadProjectSourceControl(container);
      });
      notify(projectSourceMessage(sourceType), "ok", "来源已绑定到项目");
      return;
    }
    if (!relation || !relation.projectId) return;
    if (button.dataset.action === "project-source-save") {
      const milestoneSelect = panel && panel.querySelector('[data-action-field="project-source-milestone"]');
      await withButtonBusy(button, "保存中…", async () => {
        await api("/api/admin/project/item/update", { projectId: Number(relation.projectId), sourceType, sourceId, milestoneId: milestoneSelect && milestoneSelect.value ? Number(milestoneSelect.value) : null });
        await loadProjectSourceControl(container);
      });
      notify(projectSourceMessage(sourceType), "ok", "来源里程碑已保存");
      return;
    }
    if (button.dataset.action === "project-source-unassign") {
      if (!confirm("确认解除该来源的项目归属吗？")) return;
      await withButtonBusy(button, "解绑中…", async () => {
        await api("/api/admin/project/item/unassign", { projectId: Number(relation.projectId), sourceType, sourceId });
        await loadProjectSourceControl(container);
      });
      notify(projectSourceMessage(sourceType), "ok", "来源已解除项目归属");
    }
  }

  async function handleProjectSourceChange(event) {
    const select = event.target.closest('[data-action-field="project-source-project"]');
    if (!select) return;
    const container = select.closest("[data-project-source-control]");
    if (!container) return;
    try {
      await loadProjectSourceMilestones(container, select.value);
    } catch (error) {
      notify(projectSourceMessage(container.dataset.sourceType), "error", error.message);
    }
  }

  function renderProjectList(data) {
    if (!projectList) return;
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      projectList.innerHTML = '<p class="empty-state">暂无项目，请新建项目或调整筛选条件。</p>';
    } else {
      projectList.innerHTML = items.map((raw) => {
        const item = projectModel.normalizeProjectSummary(raw);
        return `<article class="project-list-item">
          <div class="project-list-main">
            <h3>${escapeHtml(item.name || "未命名项目")}</h3>
            <p class="meta">${escapeHtml(item.description || "暂无说明")}</p>
            <p class="meta">${escapeHtml(projectStatusLabel(item.status))} · ${escapeHtml(projectPublicLabel(item.publicBasic))} · ${escapeHtml(projectCompletionLabel(item.completion))} · ${escapeHtml(item.itemCount)} 个工作项 · 更新于 ${escapeHtml(formatDateTimeDisplay(item.updatedAt))}</p>
          </div>
          <button type="button" class="secondary" data-action="project-open" data-id="${item.id}">查看详情</button>
        </article>`;
      }).join("");
    }
    const page = Number(data && data.page) || 1;
    const totalPages = Number(data && data.totalPages) || 1;
    state.projects.page = page;
    state.projects.totalPages = totalPages;
    state.projects.total = Number(data && data.total) || 0;
    document.getElementById("projectCount").textContent = `${state.projects.total} 个项目`;
    document.getElementById("projectPageText").textContent = `第 ${page} / ${totalPages} 页 · 总计 ${state.projects.total} 个`;
    document.getElementById("projectPrevBtn").disabled = page <= 1;
    document.getElementById("projectNextBtn").disabled = page >= totalPages;
  }

  async function loadProjects() {
    if (!projectList) return;
    clearMessage(projectMsg);
    projectList.setAttribute("aria-busy", "true");
    try {
      const data = await api("/api/admin/project/list", {
        status: document.getElementById("projectListStatus").value,
        keyword: document.getElementById("projectListKeyword").value.trim(),
        page: state.projects.page,
        pageSize: state.projects.pageSize
      });
      state.projects.items = Array.isArray(data.items) ? data.items.map(projectModel.normalizeProjectSummary) : [];
      state.projects.loaded = true;
      renderProjectList(data);
    } finally {
      projectList.setAttribute("aria-busy", "false");
    }
  }

  function activeProjectMilestones() {
    return state.projects.detail && Array.isArray(state.projects.detail.milestones)
      ? state.projects.detail.milestones.filter((item) => item.status === "active")
      : [];
  }

  function milestoneOptions(selectedId) {
    const selected = selectedId === null || selectedId === undefined ? "" : String(selectedId);
    return `<option value="">不关联里程碑</option>${activeProjectMilestones().map((item) => `<option value="${item.id}"${String(item.id) === selected ? " selected" : ""}>${escapeHtml(item.title || `里程碑 ${item.id}`)}</option>`).join("")}`;
  }

  function renderProjectMilestones(milestones) {
    const container = document.getElementById("projectMilestoneList");
    if (!container) return;
    if (!milestones.length) {
      container.innerHTML = '<p class="empty-state">暂无里程碑。</p>';
      return;
    }
    container.innerHTML = milestones.map((item) => `<div class="project-milestone-row ${item.status === "revoked" ? "is-revoked" : ""}">
      <div class="project-milestone-fields">
        <input data-milestone-field="title" data-id="${item.id}" value="${escapeHtml(item.title)}" maxlength="160" aria-label="里程碑标题">
        <textarea data-milestone-field="description" data-id="${item.id}" maxlength="2000" rows="2" aria-label="里程碑说明">${escapeHtml(item.description)}</textarea>
        <input data-milestone-field="targetDate" data-id="${item.id}" type="date" value="${escapeHtml(item.targetDate)}" aria-label="目标日期">
        <input data-milestone-field="sortOrder" data-id="${item.id}" type="number" min="0" max="100000" value="${item.sortOrder}" aria-label="排序">
        <label><input data-milestone-field="isCompleted" data-id="${item.id}" type="checkbox"${item.isCompleted ? " checked" : ""}> 完成</label>
      </div>
      <div class="meta">${item.status === "revoked" ? "已撤销" : "有效"} · ${escapeHtml(item.description || "无说明")}</div>
      <div class="ops">
        ${item.status === "revoked"
          ? `<button type="button" data-action="project-milestone-restore" data-id="${item.id}">恢复</button>`
          : `<button type="button" class="primary" data-action="project-milestone-save" data-id="${item.id}">保存</button><button type="button" class="danger" data-action="project-milestone-revoke" data-id="${item.id}">撤销</button>`}
      </div>
    </div>`).join("");
  }

  function renderProjectLane(targetId, items) {
    const container = document.getElementById(targetId);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-state">暂无归属工作项。</p>';
      return;
    }
    container.innerHTML = items.map((item) => `<article class="project-lane-item">
      <div><strong>${escapeHtml(item.title || "无标题")}</strong><span class="meta"> · ${escapeHtml(item.status || "未知状态")}${item.priority ? ` · 优先级 ${escapeHtml(item.priority)}` : ""}</span></div>
      <div class="meta">来源 #${escapeHtml(item.sourceId)} · 更新于 ${escapeHtml(formatDateTimeDisplay(item.updatedAt))}</div>
      <div class="project-item-visibility">
        <label><input data-action-field="public-visible" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${item.sourceId}" type="checkbox"${item.publicVisible ? " checked" : ""}> 公开此项</label>
        <button type="button" data-action="project-item-visibility-save" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${item.sourceId}">保存公开状态</button>
      </div>
      <div class="ops">
        <select data-action-field="milestone" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${item.sourceId}" aria-label="选择里程碑">${milestoneOptions(item.milestoneId)}</select>
        <button type="button" class="primary" data-action="project-item-save" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${item.sourceId}">保存里程碑</button>
        <button type="button" class="danger" data-action="project-item-unassign" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${item.sourceId}">解绑</button>
      </div>
    </article>`).join("");
  }

  function projectKanbanStatusOptions(sourceType, selectedStatus) {
    const statuses = projectModel && projectModel.KANBAN_STATUS_COLUMNS && Array.isArray(projectModel.KANBAN_STATUS_COLUMNS[sourceType])
      ? projectModel.KANBAN_STATUS_COLUMNS[sourceType]
      : [];
    const knownStatus = statuses.includes(selectedStatus);
    const placeholder = knownStatus || !statuses.length
      ? ""
      : '<option value="" selected disabled>未知状态（请选择）</option>';
    return placeholder + statuses.map((status) => `<option value="${escapeHtml(status)}"${status === selectedStatus ? " selected" : ""}>${escapeHtml(projectKanbanStatusLabels[sourceType][status] || status)}</option>`).join("");
  }

  function renderProjectKanbanCard(item, archived) {
    const sourceLabel = projectKanbanSourceLabels[item.sourceType] || "工作项";
    const statusLabel = projectKanbanStatusLabels[item.sourceType] && projectKanbanStatusLabels[item.sourceType][item.status]
      ? projectKanbanStatusLabels[item.sourceType][item.status]
      : "未知状态";
    const worktaskSummary = item.sourceType === "worktask"
      ? `<div class="project-kanban-summary">
          ${item.priority ? `<span>优先级：${escapeHtml(item.priority)}</span>` : ""}
          ${item.assignee ? `<span>负责人：${escapeHtml(item.assignee)}</span>` : ""}
          ${item.scheduledAt ? `<span>计划：${escapeHtml(formatDateTimeDisplay(item.scheduledAt))}</span>` : ""}
          ${item.expectedAt ? `<span>期望：${escapeHtml(formatDateTimeDisplay(item.expectedAt))}</span>` : ""}
        </div>`
      : "";
    return `<article class="project-kanban-card" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${escapeHtml(item.sourceId)}">
      <div class="project-kanban-card-head"><span class="project-kanban-source">${escapeHtml(sourceLabel)}</span><span class="project-kanban-status-label">${escapeHtml(statusLabel)}</span></div>
      <h6 class="project-kanban-card-title">${escapeHtml(item.title || "无标题")}</h6>
      <div class="project-kanban-card-time">更新时间：${escapeHtml(formatDateTimeDisplay(item.updatedAt))}</div>
      ${worktaskSummary}
      <div class="project-kanban-card-actions">
        <label>状态<select data-action-field="project-kanban-status" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${escapeHtml(item.sourceId)}" aria-label="${escapeHtml(sourceLabel)}状态"${archived ? " disabled" : ""}>${projectKanbanStatusOptions(item.sourceType, item.status)}</select></label>
        <button type="button" class="primary" data-action="project-kanban-status-save" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${escapeHtml(item.sourceId)}"${archived ? " disabled" : ""}>保存状态</button>
      </div>
    </article>`;
  }

  function renderProjectKanban(detail) {
    if (!projectKanbanBoard || !projectModel) return;
    const project = detail && detail.project ? detail.project : {};
    const archived = project.status === "archived";
    const lanes = projectModel.buildKanbanLanes(detail && Array.isArray(detail.items) ? detail.items : []);
    projectKanbanBoard.innerHTML = ["feedback", "worktask"].map((sourceType) => {
      const lane = lanes[sourceType] || { columns: [], unknown: [] };
      const columns = lane.columns.map((column) => `<section class="project-kanban-column">
        <div class="project-kanban-column-head"><h6>${escapeHtml(projectKanbanStatusLabels[sourceType][column.status] || column.status)}</h6><span>${column.items.length}</span></div>
        <div class="project-kanban-column-items">${column.items.length ? column.items.map((item) => renderProjectKanbanCard(item, archived)).join("") : '<p class="project-kanban-empty">此列暂无工作项。</p>'}</div>
      </section>`);
      columns.push(`<section class="project-kanban-column is-unknown">
        <div class="project-kanban-column-head"><h6>未知状态</h6><span>${lane.unknown.length}</span></div>
        <div class="project-kanban-column-items">${lane.unknown.length ? lane.unknown.map((item) => renderProjectKanbanCard(item, archived)).join("") : '<p class="project-kanban-empty">此列暂无工作项。</p>'}</div>
      </section>`);
      return `<section class="project-kanban-lane" aria-labelledby="project-kanban-${sourceType}-title">
        <div class="project-kanban-lane-head"><h5 id="project-kanban-${sourceType}-title">${escapeHtml(sourceType === "feedback" ? "反馈" : "WorkTask")} 分区</h5><span>${lane.columns.reduce((count, column) => count + column.items.length, 0) + lane.unknown.length} 个工作项</span></div>
        <div class="project-kanban-lane-scroll"><div class="project-kanban-lane-grid" data-source-type="${escapeHtml(sourceType)}">${columns.join("")}</div></div>
      </section>`;
    }).join("");
  }

  function setProjectView(view) {
    const nextView = view === "kanban" ? "kanban" : "relations";
    state.projects.projectView = nextView;
    const isRelations = nextView === "relations";
    if (projectRelationsView) {
      projectRelationsView.hidden = !isRelations;
      projectRelationsView.classList.toggle("hidden", !isRelations);
    }
    if (projectKanbanView) {
      projectKanbanView.hidden = isRelations;
      projectKanbanView.classList.toggle("hidden", isRelations);
    }
    if (projectRelationsViewBtn) {
      projectRelationsViewBtn.classList.toggle("active", isRelations);
      projectRelationsViewBtn.setAttribute("aria-pressed", String(isRelations));
    }
    if (projectKanbanViewBtn) {
      projectKanbanViewBtn.classList.toggle("active", !isRelations);
      projectKanbanViewBtn.setAttribute("aria-pressed", String(!isRelations));
    }
    if (!isRelations && state.projects.detail) renderProjectKanban(state.projects.detail);
  }

  function renderProjectDetail(data) {
    const detail = projectModel.normalizeProjectDetail(data);
    state.projects.detail = detail;
    const project = detail.project;
    document.getElementById("projectDetailTitle").textContent = project.name || "项目详情";
    document.getElementById("projectDetailMeta").textContent = `${projectStatusLabel(project.status)} · 完成度 ${projectCompletionLabel(project.completion)} · ${project.itemCount} 个工作项 · 创建于 ${formatDateTimeDisplay(project.createdAt)}`;
    document.getElementById("projectName").value = project.name;
    document.getElementById("projectDescription").value = project.description;
    document.getElementById("projectPublicBasic").checked = project.publicBasic;
    document.getElementById("projectPublicMilestones").checked = project.publicMilestones;
    document.getElementById("projectPublicUpdatedAt").checked = project.publicUpdatedAt;
    document.getElementById("projectPublicCompletion").checked = project.publicCompletion;
    document.getElementById("projectPublicItems").checked = project.publicItems;
    document.getElementById("projectCompletionMode").value = project.completionMode;
    document.getElementById("projectCustomCompletion").value = project.customCompletion === null ? "" : String(project.customCompletion);
    document.getElementById("projectCompletionText").textContent = projectCompletionLabel(project.completion);
    const archiveButton = document.getElementById("projectArchiveBtn");
    const restoreButton = document.getElementById("projectRestoreBtn");
    archiveButton.classList.toggle("hidden", project.status === "archived");
    restoreButton.classList.toggle("hidden", project.status !== "archived");
    const publicLink = document.getElementById("projectPublicLink");
    if (project.publicBasic && project.publicKey) {
      publicLink.href = `/project/?key=${encodeURIComponent(project.publicKey)}`;
      publicLink.classList.remove("hidden");
    } else {
      publicLink.removeAttribute("href");
      publicLink.classList.add("hidden");
    }
    renderProjectMilestones(detail.milestones);
    const lanes = projectModel.splitProjectItems(detail.items);
    renderProjectLane("projectFeedbackLane", lanes.feedback);
    renderProjectLane("projectWorktaskLane", lanes.worktask);
    renderProjectKanban(detail);
    projectDetail.classList.remove("hidden");
    setProjectView(state.projects.projectView);
  }

  async function loadProjectDetail(id) {
    const parsedId = Number(id);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) return;
    if (state.projects.detailId !== null && state.projects.detailId !== parsedId) {
      state.projects.projectView = "relations";
    }
    clearMessage(projectMsg);
    try {
      const data = await api(`/api/admin/project/${parsedId}`, null, { method: "GET" });
      state.projects.detailId = parsedId;
      renderProjectDetail(data);
    } catch (error) {
      state.projects.detail = null;
      state.projects.detailId = null;
      state.projects.projectView = "relations";
      setProjectView("relations");
      projectDetail.classList.add("hidden");
      throw error;
    }
  }

  async function reloadProjectDetail() {
    if (state.projects.detailId) await loadProjectDetail(state.projects.detailId);
    state.projects.loaded = false;
    await loadProjects();
  }

  async function projectWrite(pathname, payload, message, busyButton) {
    const button = busyButton || (document.activeElement && document.activeElement.tagName === "BUTTON" ? document.activeElement : null);
    await withButtonBusy(button || document.getElementById("projectSearchBtn"), "保存中…", async () => {
      await api(pathname, payload);
      await reloadProjectDetail();
    });
    notify(projectMsg, "ok", message);
  }

  async function loadProjectCandidates(sourceType) {
    const target = document.getElementById(sourceType === "feedback" ? "projectFeedbackCandidates" : "projectWorktaskCandidates");
    if (!target || !state.projects.detailId) return;
    target.classList.remove("hidden");
    target.innerHTML = '<p class="meta">正在加载候选工作项…</p>';
    const data = await api("/api/admin/project/item-candidates", { sourceType, page: 1, pageSize: 20 });
    const items = Array.isArray(data.items) ? data.items : [];
    target.innerHTML = items.length ? items.map((item) => `<div class="project-candidate-row">
      <span><strong>${escapeHtml(item.title || "无标题")}</strong><span class="meta"> · #${escapeHtml(item.sourceId)} · ${escapeHtml(item.status || "")}</span></span>
      ${item.projectId && item.projectId !== state.projects.detailId
        ? '<span class="meta">已归属其他项目，请先解绑</span>'
        : item.projectId ? '<span class="meta">已在当前项目</span>' : `<button type="button" class="primary" data-action="project-candidate-assign" data-source-type="${escapeHtml(sourceType)}" data-source-id="${item.sourceId}">绑定</button>`}
    </div>`).join("") : '<p class="empty-state">暂无可绑定候选项。</p>';
  }

  async function handleProjectAction(button) {
    const action = button.dataset.action;
    const projectId = state.projects.detailId;
    if (!projectId) return;
    if (action === "project-milestone-save") {
      const id = Number(button.dataset.id);
      const fields = projectDetail.querySelectorAll(`[data-milestone-field][data-id="${id}"]`);
      const payload = { id };
      fields.forEach((field) => {
        const name = field.dataset.milestoneField;
        payload[name] = field.type === "checkbox" ? field.checked : field.value;
      });
      await projectWrite("/api/admin/project/milestone/update", payload, "里程碑已保存");
    } else if (action === "project-milestone-revoke" || action === "project-milestone-restore") {
      const id = Number(button.dataset.id);
      if (action === "project-milestone-revoke" && !confirm("撤销该里程碑并解除其工作项关联吗？")) return;
      await projectWrite(`/api/admin/project/milestone/${action.endsWith("revoke") ? "revoke" : "restore"}`, { id }, action.endsWith("revoke") ? "里程碑已撤销" : "里程碑已恢复");
    } else if (action === "project-item-save") {
      const sourceType = button.dataset.sourceType;
      const sourceId = Number(button.dataset.sourceId);
      const select = projectDetail.querySelector(`[data-action-field="milestone"][data-source-type="${sourceType}"][data-source-id="${sourceId}"]`);
      await projectWrite("/api/admin/project/item/update", { projectId, sourceType, sourceId, milestoneId: select && select.value ? Number(select.value) : null }, "工作项里程碑已保存");
    } else if (action === "project-item-visibility-save") {
      const sourceType = button.dataset.sourceType;
      const sourceId = Number(button.dataset.sourceId);
      const row = button.closest(".project-lane-item");
      const checkbox = row && row.querySelector('[data-action-field="public-visible"]');
      await projectWrite("/api/admin/project/item/visibility", {
        projectId,
        sourceType,
        sourceId,
        publicVisible: Boolean(checkbox && checkbox.checked)
      }, "工作项公开状态已保存", button);
    } else if (action === "project-item-unassign") {
      if (!confirm("确认解绑该工作项吗？")) return;
      await projectWrite("/api/admin/project/item/unassign", { projectId, sourceType: button.dataset.sourceType, sourceId: Number(button.dataset.sourceId) }, "工作项已解绑");
    } else if (action === "project-candidate-assign") {
      await projectWrite("/api/admin/project/item/assign", { projectId, sourceType: button.dataset.sourceType, sourceId: Number(button.dataset.sourceId) }, "工作项已绑定");
    } else if (action === "project-kanban-status-save") {
      const sourceType = button.dataset.sourceType;
      const sourceId = Number(button.dataset.sourceId);
      const select = button.closest(".project-kanban-card") && button.closest(".project-kanban-card").querySelector('[data-action-field="project-kanban-status"]');
      const status = select ? select.value : "";
      if (!status) {
        notify(projectMsg, "error", "请先选择有效状态");
        return;
      }
      await projectWrite("/api/admin/project/item/status", { projectId, sourceType, sourceId, status }, "工作项状态已保存", button);
    }
  }

  async function syncProjectHash() {
    const parsed = projectModel.parseProjectHash(window.location.hash);
    if (!window.location.hash.startsWith("#projects")) return;
    if (state.active !== "projects") switchModule("projects");
    if (parsed.id) {
      await loadProjectDetail(parsed.id);
    } else {
      projectDetail.classList.add("hidden");
      state.projects.detailId = null;
      state.projects.detail = null;
      state.projects.projectView = "relations";
      setProjectView("relations");
    }
  }

  function switchModule(module) {
    state.active = module;
    const isInbox = module === "inbox";
    const isFeedback = module === "feedback";
    const isWorktask = module === "worktask";
    const isWorkHub = module === "workHub";
    const isWorktaskCreate = module === "worktaskCreate";
    const isProjects = module === "projects";
    const isKnowledge = module === "knowledge";
    const isSettings = module === "settings";
    tabInbox.classList.toggle("active", isInbox);
    tabFeedback.classList.toggle("active", isFeedback);
    tabWorktask.classList.toggle("active", isWorktask);
    tabWorkHub.classList.toggle("active", isWorkHub);
    tabWorktaskCreate.classList.toggle("active", isWorktaskCreate);
    tabProjects.classList.toggle("active", isProjects);
    tabKnowledge.classList.toggle("active", isKnowledge);
    tabSettings.classList.toggle("active", isSettings);
    tabInbox.setAttribute("aria-selected", String(isInbox));
    tabFeedback.setAttribute("aria-selected", String(isFeedback));
    tabWorktask.setAttribute("aria-selected", String(isWorktask));
    tabWorkHub.setAttribute("aria-selected", String(isWorkHub));
    tabWorktaskCreate.setAttribute("aria-selected", String(isWorktaskCreate));
    tabProjects.setAttribute("aria-selected", String(isProjects));
    tabKnowledge.setAttribute("aria-selected", String(isKnowledge));
    tabSettings.setAttribute("aria-selected", String(isSettings));
    moduleInbox.classList.toggle("hidden", !isInbox);
    moduleFeedback.classList.toggle("hidden", !isFeedback);
    moduleWorktask.classList.toggle("hidden", !isWorktask);
    moduleWorkHub.classList.toggle("hidden", !isWorkHub);
    moduleWorktaskCreate.classList.toggle("hidden", !isWorktaskCreate);
    moduleProjects.classList.toggle("hidden", !isProjects);
    moduleKnowledge.classList.toggle("hidden", !isKnowledge);
    moduleSettings.classList.toggle("hidden", !isSettings);

    if (isInbox && !state.inbox.loaded && !state.inbox.loading) {
      loadInbox().catch((err) => showMessage(inboxMsg, "error", err.message));
    }
    if (isFeedback && !state.feedback.loaded) {
      loadFeedback().catch((err) => showMessage(globalMsg, "error", err.message));
    }
    if (isWorktask && !state.worktask.loaded) {
      loadWorktask().catch((err) => showMessage(globalMsg, "error", err.message));
    }
    if (isWorkHub && !state.workHub.loaded && !state.workHub.loading) {
      loadWorkHub().catch((err) => showMessage(workHubMsg, "error", err.message));
    }
    if (isProjects && !state.projects.loaded && !state.projects.loading) {
      state.projects.loading = true;
      loadProjects()
        .catch((err) => showMessage(projectMsg, "error", err.message))
        .finally(() => { state.projects.loading = false; });
    }
    if (isKnowledge && !state.knowledge.loaded && !state.knowledge.loading) {
      state.knowledge.loading = true;
      Promise.all([loadKnowledgeStatus(), loadKnowledgeHistory()])
        .catch((err) => showMessage(knowledgeStatusMsg, "error", err.message))
        .finally(() => { state.knowledge.loading = false; });
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
      await loadAiMetrics().catch((err) => notify(aiMetricsMsg, "error", err.message));
      await loadKnowledgeStatus().catch((err) => notify(knowledgeStatusMsg, "error", err.message));
      if (projectModel && window.location.hash.startsWith("#projects")) {
        switchModule("projects");
        syncProjectHash().catch((err) => notify(projectMsg, "error", err.message));
      } else {
        switchModule("inbox");
      }
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
      await loadAiMetrics().catch((err) => notify(aiMetricsMsg, "error", err.message));
      await loadKnowledgeStatus().catch((err) => notify(knowledgeStatusMsg, "error", err.message));
      if (projectModel && window.location.hash.startsWith("#projects")) {
        switchModule("projects");
        syncProjectHash().catch((err) => notify(projectMsg, "error", err.message));
      } else {
        switchModule("inbox");
      }
    } catch (_) {
      loginCard.classList.remove("hidden");
      adminPanel.classList.add("hidden");
    }
  }

  document.getElementById("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    login();
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
      state.feedback.focusId = null;
      state.worktask.loaded = false;
      state.worktask.focusId = null;
      state.workHub.loaded = false;
      state.workHub.loading = false;
      state.workHub.requestId += 1;
      state.workHub.data = null;
      state.projects.loaded = false;
      state.projects.items = [];
      state.projects.detail = null;
      state.projects.detailId = null;
      state.projects.projectView = "relations";
      setProjectView("relations");
      if (projectList) projectList.innerHTML = "";
      if (projectDetail) projectDetail.classList.add("hidden");
      resetWorktaskCreateForm();
      clearMessage(worktaskCreateMsg);
      clearMessage(smtpTestMsg);
      clearMessage(webhookTestMsg);
      clearMessage(statusSettingsMsg);
      clearMessage(aiStatusMsg);
      clearMessage(aiDiagnosticMsg);
      clearMessage(aiMetricsMsg);
      state.ai.enabled = false;
      state.ai.available = false;
      state.ai.reason = "";
      state.ai.activeProfile = null;
      state.ai.profiles = [];
      state.ai.suggestions = {};
      state.ai.diagnostics = {};
      state.ai.metrics = null;
      if (aiDiagnosticsList) aiDiagnosticsList.innerHTML = '<span class="meta">选择 AI 配置后点击“诊断”</span>';
      if (aiMetricsSummary) aiMetricsSummary.innerHTML = '<span class="meta">尚未加载指标</span>';
      resetAiProfileForm();
      state.knowledge.loaded = false;
      state.knowledge.loading = false;
      state.knowledge.available = false;
      state.knowledge.reason = "";
      state.knowledge.roots = [];
      state.knowledge.answer = null;
      state.knowledge.history = { page: 1, pageSize: 10, totalPages: 0, total: 0, items: [] };
      knowledgeAnswerCard.classList.add("hidden");
      knowledgeHistoryList.innerHTML = "";
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
      else if (state.active === "workHub") {
        state.workHub.loaded = false;
        await loadWorkHub();
      }
      else if (state.active === "projects") {
        state.projects.loaded = false;
        await loadProjects();
        if (state.projects.detailId) await loadProjectDetail(state.projects.detailId);
      }
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

  document.getElementById("aiProfileProtocol").addEventListener("change", updateAiProtocolHint);

  document.getElementById("aiMetricsRefreshBtn").addEventListener("click", async () => {
    try {
      await loadAiMetrics();
    } catch (error) {
      notify(aiMetricsMsg, "error", error.message);
    }
  });

  aiProfilesList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    try {
      if (btn.dataset.action === "ai-edit-profile") {
        editAiProfile(btn.dataset.id);
      } else if (btn.dataset.action === "ai-activate-profile") {
        await activateAiProfile(btn.dataset.id);
      } else if (btn.dataset.action === "ai-diagnose-profile") {
        await withButtonBusy(btn, "诊断中…", () => diagnoseAiProfile(btn.dataset.id, btn));
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
  tabWorkHub.addEventListener("click", () => switchModule("workHub"));
  tabWorktaskCreate.addEventListener("click", () => switchModule("worktaskCreate"));
  tabProjects.addEventListener("click", () => {
    window.location.hash = "projects";
    switchModule("projects");
  });
  tabKnowledge.addEventListener("click", () => switchModule("knowledge"));
  tabSettings.addEventListener("click", () => switchModule("settings"));

  document.getElementById("projectCreateBtn").addEventListener("click", () => {
    document.getElementById("projectCreateForm").classList.toggle("hidden");
    document.getElementById("projectCreateName").focus();
  });
  document.getElementById("projectCreateCancelBtn").addEventListener("click", () => {
    document.getElementById("projectCreateForm").reset();
    document.getElementById("projectCreateForm").classList.add("hidden");
  });
  document.getElementById("projectCreateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    try {
      await withButtonBusy(button, "创建中…", async () => {
        const data = await api("/api/admin/project/create", {
          name: document.getElementById("projectCreateName").value.trim(),
          description: document.getElementById("projectCreateDescription").value.trim(),
          publicBasic: document.getElementById("projectCreatePublicBasic").checked,
          publicItems: document.getElementById("projectCreatePublicItems").checked
        });
        form.reset();
        form.classList.add("hidden");
        await loadProjects();
        window.location.hash = projectModel.projectHash(data.id).slice(1);
        await loadProjectDetail(data.id);
      });
      notify(projectMsg, "ok", "项目已创建");
    } catch (error) {
      notify(projectMsg, "error", error.message);
    }
  });
  document.getElementById("projectSearchBtn").addEventListener("click", async () => {
    state.projects.page = 1;
    state.projects.loaded = false;
    try { await loadProjects(); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectPrevBtn").addEventListener("click", async () => {
    if (state.projects.page <= 1) return;
    state.projects.page -= 1;
    try { await loadProjects(); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectNextBtn").addEventListener("click", async () => {
    if (state.projects.page >= state.projects.totalPages) return;
    state.projects.page += 1;
    try { await loadProjects(); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  projectList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action=\"project-open\"]");
    if (!button) return;
    const id = Number(button.dataset.id);
    window.location.hash = projectModel.projectHash(id).slice(1);
    try { await loadProjectDetail(id); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectEditForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.projects.detailId) return;
    try {
      await projectWrite("/api/admin/project/update", {
        id: state.projects.detailId,
        name: document.getElementById("projectName").value.trim(),
        description: document.getElementById("projectDescription").value.trim(),
        publicBasic: document.getElementById("projectPublicBasic").checked,
        publicMilestones: document.getElementById("projectPublicMilestones").checked,
        publicUpdatedAt: document.getElementById("projectPublicUpdatedAt").checked,
        publicCompletion: document.getElementById("projectPublicCompletion").checked,
        publicItems: document.getElementById("projectPublicItems").checked,
        completionMode: document.getElementById("projectCompletionMode").value,
        customCompletion: document.getElementById("projectCustomCompletion").value === "" ? null : Number(document.getElementById("projectCustomCompletion").value)
      }, "项目设置已保存");
    } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectArchiveBtn").addEventListener("click", async (event) => {
    if (!state.projects.detailId || !confirm("归档该项目吗？已有工作项关系会保留。")) return;
    try { await projectWrite("/api/admin/project/archive", { id: state.projects.detailId }, "项目已归档"); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectRestoreBtn").addEventListener("click", async () => {
    if (!state.projects.detailId) return;
    try { await projectWrite("/api/admin/project/restore", { id: state.projects.detailId }, "项目已恢复"); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectMilestoneForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.projects.detailId) return;
    try {
      await projectWrite("/api/admin/project/milestone/create", {
        projectId: state.projects.detailId,
        title: document.getElementById("projectMilestoneTitle").value.trim(),
        description: document.getElementById("projectMilestoneDescription").value.trim(),
        targetDate: document.getElementById("projectMilestoneTargetDate").value,
        sortOrder: Number(document.getElementById("projectMilestoneSortOrder").value || 0)
      }, "里程碑已新增");
      event.currentTarget.reset();
      document.getElementById("projectMilestoneSortOrder").value = "0";
    } catch (error) { notify(projectMsg, "error", error.message); }
  });
  document.getElementById("projectMilestoneList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    try { await withButtonBusy(button, "处理中…", () => handleProjectAction(button)); } catch (error) { notify(projectMsg, "error", error.message); }
  });
  if (projectRelationsViewBtn) projectRelationsViewBtn.addEventListener("click", () => setProjectView("relations"));
  if (projectKanbanViewBtn) projectKanbanViewBtn.addEventListener("click", () => setProjectView("kanban"));
  if (projectKanbanBoard) {
    projectKanbanBoard.addEventListener("click", async (event) => {
      const actionButton = event.target.closest('button[data-action="project-kanban-status-save"]');
      if (!actionButton) return;
      try {
        await handleProjectAction(actionButton);
      } catch (error) {
        notify(projectMsg, "error", error.message);
      }
    });
  }
  for (const sourceType of ["feedback", "worktask"]) {
    const button = document.getElementById(sourceType === "feedback" ? "projectFeedbackCandidatesBtn" : "projectWorktaskCandidatesBtn");
    button.addEventListener("click", async () => {
      try { await loadProjectCandidates(sourceType); } catch (error) { notify(projectMsg, "error", error.message); }
    });
    const lane = document.getElementById(sourceType === "feedback" ? "projectFeedbackLane" : "projectWorktaskLane");
    lane.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("button[data-action]");
      if (!actionButton) return;
      try { await withButtonBusy(actionButton, "处理中…", () => handleProjectAction(actionButton)); } catch (error) { notify(projectMsg, "error", error.message); }
    });
    const candidates = document.getElementById(sourceType === "feedback" ? "projectFeedbackCandidates" : "projectWorktaskCandidates");
    candidates.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("button[data-action=\"project-candidate-assign\"]");
      if (!actionButton) return;
      try { await withButtonBusy(actionButton, "绑定中…", () => handleProjectAction(actionButton)); } catch (error) { notify(projectMsg, "error", error.message); }
    });
  }
  window.addEventListener("hashchange", () => {
    if (!state.projects.detailId && !window.location.hash.startsWith("#projects")) return;
    syncProjectHash().catch((error) => notify(projectMsg, "error", error.message));
  });

  document.getElementById("knowledgeReindexBtn").addEventListener("click", async () => {
    try {
      await reindexKnowledge();
    } catch (error) {
      notify(knowledgeStatusMsg, "error", error.message);
    }
  });
  document.getElementById("knowledgeAskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await askKnowledgeQuestion();
    } catch (error) {
      notify(knowledgeAskMsg, "error", error.message);
    }
  });
  document.getElementById("knowledgeClearBtn").addEventListener("click", () => {
    document.getElementById("knowledgeQuestion").value = "";
    clearMessage(knowledgeAskMsg);
    document.getElementById("knowledgeQuestion").focus();
  });
  document.getElementById("knowledgeCleanupBtn").addEventListener("click", async () => {
    try {
      await cleanupKnowledgeHistory();
    } catch (error) {
      notify(knowledgeHistoryMsg, "error", error.message);
    }
  });
  document.getElementById("knowledgeSettingsSaveBtn").addEventListener("click", async () => {
    try {
      await saveKnowledgeSettings();
    } catch (error) {
      notify(knowledgeHistoryMsg, "error", error.message);
    }
  });
  knowledgeHistoryList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action=\"knowledge-history-delete\"]");
    if (!button) return;
    try {
      await deleteKnowledgeHistory(button.dataset.id, button);
    } catch (error) {
      notify(knowledgeHistoryMsg, "error", error.message);
    }
  });
  document.getElementById("knowledgeHistoryPrevBtn").addEventListener("click", async () => {
    if (state.knowledge.history.page <= 1) return;
    state.knowledge.history.page -= 1;
    try {
      await loadKnowledgeHistory();
    } catch (error) {
      notify(knowledgeHistoryMsg, "error", error.message);
    }
  });
  document.getElementById("knowledgeHistoryNextBtn").addEventListener("click", async () => {
    if (!state.knowledge.history.totalPages || state.knowledge.history.page >= state.knowledge.history.totalPages) return;
    state.knowledge.history.page += 1;
    try {
      await loadKnowledgeHistory();
    } catch (error) {
      notify(knowledgeHistoryMsg, "error", error.message);
    }
  });

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
    try { state.feedback.page = 1; state.feedback.focusId = null; await loadFeedback(); } catch (error) { notify(feedbackMsg, "error", error.message); }
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
    try { state.worktask.page = 1; state.worktask.focusId = null; await loadWorktask(); } catch (error) { notify(worktaskMsg, "error", error.message); }
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
      if (btn.dataset.action && btn.dataset.action.startsWith("project-source-")) {
        await handleProjectSourceAction(btn);
        return;
      }
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
      if (btn.dataset.action && btn.dataset.action.startsWith("project-source-")) {
        await handleProjectSourceAction(btn);
        return;
      }
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

  document.getElementById("feedbackList").addEventListener("change", handleProjectSourceChange);
  document.getElementById("worktaskList").addEventListener("change", handleProjectSourceChange);

  if (workHubRefreshBtn) {
    workHubRefreshBtn.addEventListener("click", async () => {
      try {
        state.workHub.loaded = false;
        await withButtonBusy(workHubRefreshBtn, "刷新中…", loadWorkHub);
      } catch (error) {
        notify(workHubMsg, "error", error.message);
      }
    });
  }

  if (moduleWorkHub) {
    moduleWorkHub.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || !moduleWorkHub.contains(button)) return;
      try {
        await handleWorkHubAction(button);
      } catch (error) {
        notify(workHubMsg, "error", error.message || "Work Hub 操作失败");
      }
    });
  }

  (async () => {
    resetWorktaskCreateForm();
    await loadDisplaySettings();
    await checkLogin();
  })();
})();
