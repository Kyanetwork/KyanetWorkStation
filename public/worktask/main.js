const form = document.getElementById("worktaskForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const accountBox = document.getElementById("accountBox");

const titleInput = document.getElementById("title");
const contentInput = document.getElementById("content");
const contactInput = document.getElementById("contact");
const tagsInput = document.getElementById("tags");

function updateCounters() {
  document.getElementById("titleCount").textContent = `${titleInput.value.length}/100`;
  document.getElementById("contentCount").textContent = `${contentInput.value.length}/3000`;
  document.getElementById("contactCount").textContent = `${contactInput.value.length}/100`;
  document.getElementById("tagsCount").textContent = `${tagsInput.value.length}/200`;
}

titleInput.addEventListener("input", updateCounters);
contentInput.addEventListener("input", updateCounters);
contactInput.addEventListener("input", updateCounters);
tagsInput.addEventListener("input", updateCounters);
updateCounters();

function showMessage(kind, text) {
  messageEl.className = `msg ${kind}`;
  messageEl.textContent = text;
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function accountLoginHref() {
  return `/auth/account/start?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

async function refreshAccountState() {
  try {
    const response = await fetch("/api/account/me");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error("not signed in");
    }
    const user = data.data || {};
    const name = user.displayName || user.email || "KyanetAccount 用户";
    accountBox.innerHTML = `已登录 KyanetAccount：<strong>${escapeHtml(name)}</strong>`;
  } catch (_) {
    accountBox.innerHTML = `提交前请先登录 KyanetAccount。<a href="${accountLoginHref()}">前往登录</a>`;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  showMessage("", "");

  const payload = {
    type: form.type.value,
    title: form.title.value.trim(),
    content: form.content.value.trim(),
    contact: form.contact.value.trim(),
    priority: form.priority.value,
    expectedAt: form.expectedAt.value ? new Date(form.expectedAt.value).toISOString() : "",
    tags: form.tags.value.trim()
  };

  try {
    const response = await fetch("/api/worktask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data && data.error && data.error.message ? data.error.message : "提交失败，请稍后重试");
    }

    form.reset();
    document.getElementById("type").value = "WorkTask提交";
    document.getElementById("priority").value = "medium";
    updateCounters();
    showMessage("ok", "WorkTask 提交成功，管理员会在统一面板进行安排与状态更新。");
  } catch (error) {
    showMessage("error", error && error.message ? error.message : "提交失败，请稍后重试");
  } finally {
    submitBtn.disabled = false;
  }
});

refreshAccountState();
