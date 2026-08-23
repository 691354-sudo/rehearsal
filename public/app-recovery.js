(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const baseUrl = new URL("./", script.src);
  const recoveryKey = "echo:asset-recovery";

  const recover = async () => {
    if (window.sessionStorage.getItem(recoveryKey)) return;
    window.sessionStorage.setItem(recoveryKey, "1");
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find((candidate) => candidate.scope === baseUrl.href);
        await registration?.unregister();
      }
    } catch {
      // A network reload still recovers when service-worker inspection is unavailable.
    } finally {
      window.location.reload();
    }
  };

  window.addEventListener("load", () => {
    window.setTimeout(() => {
      if (document.getElementById("root")?.childElementCount) window.sessionStorage.removeItem(recoveryKey);
    }, 0);
  }, { once: true });
  window.addEventListener("error", (event) => {
    const target = event.target;
    const assetUrl = target instanceof HTMLScriptElement ? target.src
      : target instanceof HTMLLinkElement && target.rel === "stylesheet" ? target.href : "";
    if (!assetUrl || !assetUrl.startsWith(new URL("assets/", baseUrl).href)) return;
    void recover();
  }, true);
})();
