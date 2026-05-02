(function () {
  const STORAGE_KEY = "kyanet_theme";

  function getPreferredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    const toggleBtn = document.getElementById("themeToggle");
    if (toggleBtn) {
      toggleBtn.textContent = theme === "dark" ? "切换浅色" : "切换深色";
    }
  }

  function toggleTheme() {
    const current = document.body.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  const initial = getPreferredTheme();
  applyTheme(initial);

  const toggleBtn = document.getElementById("themeToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleTheme);
  }
})();

