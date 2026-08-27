const form = document.getElementById("feedbackForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");

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
