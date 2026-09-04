(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KwsProjectModel = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SOURCE_TYPES = new Set(["feedback", "worktask"]);
  const STATUSES = new Set(["active", "archived"]);

  function text(value, maxLength) {
    return typeof value === "string" ? Array.from(value).slice(0, maxLength).join("") : "";
  }

  function integer(value, fallback = 0) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function nullableInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = integer(value, -1);
    return parsed >= 0 ? parsed : null;
  }

  function boolean(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizeProjectSummary(input) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const completion = nullableInteger(raw.completion);
    const customCompletion = nullableInteger(raw.customCompletion);
    return {
      id: integer(raw.id),
      publicKey: text(raw.publicKey, 64),
      name: text(raw.name, 120),
      description: text(raw.description, 2000),
      status: STATUSES.has(raw.status) ? raw.status : "active",
      publicBasic: boolean(raw.publicBasic),
      publicMilestones: boolean(raw.publicMilestones),
      publicUpdatedAt: boolean(raw.publicUpdatedAt),
      publicCompletion: boolean(raw.publicCompletion),
      completionMode: raw.completionMode === "custom" ? "custom" : "auto",
      customCompletion,
      completion,
      milestoneCount: integer(raw.milestoneCount),
      activeMilestoneCount: integer(raw.activeMilestoneCount),
      itemCount: integer(raw.itemCount),
      createdAt: text(raw.createdAt, 40),
      updatedAt: text(raw.updatedAt, 40)
    };
  }

  function normalizeMilestone(input) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    return {
      id: integer(raw.id),
      projectId: integer(raw.projectId),
      title: text(raw.title, 160),
      description: text(raw.description, 2000),
      targetDate: text(raw.targetDate, 10),
      isCompleted: boolean(raw.isCompleted),
      sortOrder: integer(raw.sortOrder),
      status: raw.status === "revoked" ? "revoked" : "active",
      createdAt: text(raw.createdAt, 40),
      updatedAt: text(raw.updatedAt, 40)
    };
  }

  function normalizeItem(input) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (!SOURCE_TYPES.has(raw.sourceType)) return null;
    return {
      id: integer(raw.id),
      projectId: integer(raw.projectId),
      sourceType: raw.sourceType,
      sourceId: integer(raw.sourceId),
      milestoneId: nullableInteger(raw.milestoneId),
      title: text(raw.title, 255),
      type: text(raw.type, 64),
      status: text(raw.status, 32),
      priority: text(raw.priority, 32),
      assignee: text(raw.assignee, 100),
      scheduledAt: text(raw.scheduledAt, 40),
      expectedAt: text(raw.expectedAt, 40),
      updatedAt: text(raw.updatedAt, 40),
      createdAt: text(raw.createdAt, 40)
    };
  }

  function normalizeProjectDetail(input) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const milestones = Array.isArray(raw.milestones) ? raw.milestones.map(normalizeMilestone) : [];
    milestones.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
    const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [];
    return {
      project: normalizeProjectSummary(raw.project),
      milestones,
      items
    };
  }

  function splitProjectItems(items) {
    const lanes = { feedback: [], worktask: [] };
    for (const item of Array.isArray(items) ? items : []) {
      if (item && SOURCE_TYPES.has(item.sourceType)) lanes[item.sourceType].push(item);
    }
    return lanes;
  }

  function projectHash(id) {
    const parsed = integer(id, 0);
    return parsed > 0 ? `#projects/${parsed}` : "#projects";
  }

  function parseProjectHash(hash) {
    const value = typeof hash === "string" ? hash : "";
    const match = value.match(/^#projects(?:\/(\d+))?$/u);
    if (!match) return { id: null };
    if (!match[1]) return { id: null };
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? { id } : { id: null };
  }

  return {
    normalizeProjectSummary,
    normalizeProjectDetail,
    normalizeMilestone,
    normalizeItem,
    splitProjectItems,
    projectHash,
    parseProjectHash
  };
}));
