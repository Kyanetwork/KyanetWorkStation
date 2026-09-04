(function () {
  "use strict";

  const state = {
    publicKey: "",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    formatter: null
  };

  function getElement(id) {
    return document.getElementById(id);
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error((data && data.error && data.error.message) || "请求失败");
      error.status = response.status;
      error.code = data && data.error && data.error.code;
      throw error;
    }
    return data.data || {};
  }

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

  function setDisplaySettings(settings) {
    const data = settings && typeof settings === "object" ? settings : {};
    state.locale = typeof data.displayLocale === "string" && data.displayLocale ? data.displayLocale : "zh-CN";
    state.timezone = typeof data.displayTimezone === "string" && data.displayTimezone ? data.displayTimezone : "Asia/Shanghai";
    state.formatter = createFormatter(state.locale, state.timezone);
  }

  function formatDateTime(input) {
    if (!input) return "-";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return String(input);
    const formatter = state.formatter || createFormatter("zh-CN", "Asia/Shanghai");
    const parts = formatter.formatToParts(date);
    const values = {};
    for (const part of parts) values[part.type] = part.value;
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  function showOnly(id) {
    for (const elementId of ["projectLoading", "projectHeader", "projectError", "projectUnavailable", "projectContent"]) {
      const element = getElement(elementId);
      const keepHeaderWithContent = id === "projectContent" && elementId === "projectHeader";
      if (element) element.classList.toggle("hidden", elementId !== id && !keepHeaderWithContent);
    }
  }

  function appendTextElement(parent, tagName, className, value) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value == null ? "" : String(value);
    parent.appendChild(element);
    return element;
  }

  function hasValue(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== undefined;
  }

  function renderMilestones(milestones) {
    const section = getElement("projectMilestonesSection");
    const list = getElement("projectMilestoneList");
    if (!section || !list) return;

    section.classList.remove("hidden");
    list.replaceChildren();
    if (!milestones.length) {
      appendTextElement(list, "p", "empty", "暂无公开里程碑。");
      return;
    }

    for (const milestone of milestones) {
      if (!milestone || typeof milestone !== "object") continue;
      const item = document.createElement("article");
      item.className = "project-public-milestone";
      const head = document.createElement("div");
      head.className = "project-public-milestone-head";
      appendTextElement(head, "h3", "project-public-milestone-title", milestone.title || "未命名里程碑");
      appendTextElement(head, "span", milestone.isCompleted ? "state-pill is-complete" : "state-pill", milestone.isCompleted ? "已完成" : "进行中");
      item.appendChild(head);
      if (milestone.description) appendTextElement(item, "p", "project-public-milestone-description", milestone.description);
      if (milestone.targetDate) appendTextElement(item, "div", "project-public-milestone-date", `目标日期：${milestone.targetDate}`);
      list.appendChild(item);
    }
    if (!list.children.length) appendTextElement(list, "p", "empty", "暂无公开里程碑。");
  }

  function renderProject(project) {
    const data = project && typeof project === "object" && !Array.isArray(project) ? project : {};
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "公开项目";
    getElement("projectName").textContent = name;
    getElement("projectDescription").textContent = data.description || "暂无项目说明。";
    document.title = `${name} | Kyanetwork`;

    const updatedAt = getElement("projectUpdatedAt");
    if (hasValue(data, "updatedAt") && data.updatedAt) {
      updatedAt.textContent = `更新时间：${formatDateTime(data.updatedAt)}`;
      updatedAt.classList.remove("hidden");
    } else {
      updatedAt.textContent = "";
      updatedAt.classList.add("hidden");
    }

    const completionPanel = getElement("projectCompletionPanel");
    const completionValue = getElement("projectCompletionValue");
    const completionBar = getElement("projectCompletionBar");
    const completion = data.completion && typeof data.completion === "object" ? Number(data.completion.value) : NaN;
    if (Number.isInteger(completion) && completion >= 0 && completion <= 100) {
      completionPanel.classList.remove("hidden");
      completionValue.textContent = `${completion}%`;
      completionBar.style.width = `${completion}%`;
      completionBar.setAttribute("aria-valuenow", String(completion));
    } else {
      completionPanel.classList.add("hidden");
      completionValue.textContent = "";
      completionBar.style.width = "0%";
      completionBar.removeAttribute("aria-valuenow");
    }

    const milestonesSection = getElement("projectMilestonesSection");
    if (Array.isArray(data.milestones)) {
      renderMilestones(data.milestones);
    } else {
      milestonesSection.classList.add("hidden");
      getElement("projectMilestoneList").replaceChildren();
    }

    showOnly("projectContent");
  }

  function showUnavailable() {
    const title = document.querySelector("#projectUnavailable h2");
    if (title) title.textContent = "项目暂不可用";
    showOnly("projectUnavailable");
  }

  function showError() {
    const text = getElement("projectErrorText");
    if (text) text.textContent = "项目加载失败，请稍后重试。";
    showOnly("projectError");
  }

  async function loadProject() {
    showOnly("projectLoading");
    if (!state.publicKey) {
      showUnavailable();
      return;
    }
    try {
      const [data, settings] = await Promise.all([
        fetchJson(`/api/public/projects/${encodeURIComponent(state.publicKey)}`),
        fetchJson("/api/public/config").catch(() => ({}))
      ]);
      setDisplaySettings(settings);
      renderProject(data);
    } catch (error) {
      if (error && (error.status === 404 || error.code === "NOT_FOUND")) showUnavailable();
      else showError();
    }
  }

  const params = new URLSearchParams(window.location.search);
  state.publicKey = params.get("key") || "";
  const retryButton = getElement("projectRetryBtn");
  if (retryButton) retryButton.addEventListener("click", loadProject);
  loadProject();
}());
