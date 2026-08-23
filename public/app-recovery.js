(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const baseUrl = new URL("./", script.src);
  const recoveryUrl = new URL("recover", baseUrl);
  const recoveryKey = "echo:asset-recovery";
  const targetKey = "echo:asset-recovery-target";
  const root = () => document.getElementById("root");

  const readStorage = (key) => {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  };
  const writeStorage = (key, value) => {
    try { window.sessionStorage.setItem(key, value); } catch { /* The visible fallback still works. */ }
  };
  const clearStorage = (key) => {
    try { window.sessionStorage.removeItem(key); } catch { /* Nothing else to clear. */ }
  };
  const currentTarget = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const safeTarget = (raw) => {
    if (!raw) return baseUrl.pathname;
    try {
      const target = new URL(raw, baseUrl.origin);
      if (target.origin !== baseUrl.origin || !target.pathname.startsWith(baseUrl.pathname)
        || target.pathname === recoveryUrl.pathname) return baseUrl.pathname;
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return baseUrl.pathname;
    }
  };

  const restoreDeepLink = () => {
    if (window.location.pathname !== recoveryUrl.pathname) return;
    window.history.replaceState(window.history.state, "", safeTarget(readStorage(targetKey)));
  };

  const showFallback = () => {
    const container = root();
    if (!container || container.childElementCount) return;
    const main = document.createElement("main");
    main.className = "app-recovery-fallback";
    main.setAttribute("role", "alert");
    const card = document.createElement("section");
    card.className = "app-recovery-card";
    const brand = document.createElement("strong"); brand.textContent = "Echo";
    const heading = document.createElement("h1"); heading.textContent = "Echo could not open";
    const copy = document.createElement("p"); copy.textContent = "Your profile and saved work are untouched. Try a fresh reload or open Echo.";
    const actions = document.createElement("div");
    const reload = document.createElement("button"); reload.type = "button"; reload.textContent = "Reload Echo";
    reload.addEventListener("click", () => window.location.replace(`${recoveryUrl.href}?fresh=${Date.now()}`));
    const home = document.createElement("a"); home.href = baseUrl.href; home.textContent = "Open Echo";
    actions.append(reload, home); card.append(brand, heading, copy, actions); main.append(card);
    container.replaceChildren(main);
  };

  const recover = async () => {
    if (readStorage(recoveryKey)) { showFallback(); return; }
    writeStorage(recoveryKey, "1");
    writeStorage(targetKey, currentTarget());
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find((candidate) => candidate.scope === baseUrl.href);
        await registration?.unregister();
      }
    } catch {
      // The network-only recovery route remains available when service-worker inspection fails.
    } finally {
      window.location.replace(`${recoveryUrl.href}?fresh=${Date.now()}`);
    }
  };

  const verifyMount = () => {
    if (root()?.childElementCount) {
      clearStorage(recoveryKey);
      clearStorage(targetKey);
      return;
    }
    void recover();
  };

  restoreDeepLink();
  window.addEventListener("pageshow", restoreDeepLink);
  window.addEventListener("load", () => window.setTimeout(verifyMount, 1200), { once: true });
  window.addEventListener("error", (event) => {
    const target = event.target;
    const assetUrl = target instanceof HTMLScriptElement ? target.src
      : target instanceof HTMLLinkElement && target.rel === "stylesheet" ? target.href : "";
    if (assetUrl && assetUrl.startsWith(new URL("assets/", baseUrl).href)) {
      void recover();
      return;
    }
    if (!root()?.childElementCount) window.setTimeout(verifyMount, 0);
  }, true);
})();
