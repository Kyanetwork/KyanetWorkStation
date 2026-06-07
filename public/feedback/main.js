const form = document.getElementById("feedbackForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const accountBox = document.getElementById("accountBox");

const titleInput = document.getElementById("title");
const contentInput = document.getElementById("content");
const contactInput = document.getElementById("contact");

function updateCounters() {
  document.getElementById("titleCount").textContent = `${titleInput.value.length}/80`;
  document.getElementById("contentCount").textContent = `${contentInput.value.length}/2000`;
  document.getElementById("contactCount").textContent = `${contactInput.value.length}/100`;
}

titleInput.addEventListener("input", updateCounters);
contentInput.addEventListener("input", updateCounters);
contactInput.addEventListener("input", updateCounters);
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
    images: []
  };

  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data && data.error && data.error.message ? data.error.message : "提交失败，请稍后重试");
    }

    form.reset();
    document.getElementById("type").value = "Bug";
    updateCounters();
    showMessage("ok", "提交成功，感谢反馈。我会尽快查看。若需补充信息可再次提交。");
  } catch (error) {
    showMessage("error", error && error.message ? error.message : "提交失败，请稍后重试");
  } finally {
    submitBtn.disabled = false;
  }
});

refreshAccountState();
