export const telegramWebApp = () => window.Telegram?.WebApp || null;

export const telegramInitData = () => telegramWebApp()?.initData.trim() || "";

export const isTelegramMiniApp = () => Boolean(telegramInitData());

const syncSafeAreas = () => {
  const webApp = telegramWebApp();
  if (!webApp) return;
  const root = document.documentElement;
  const safe = webApp.safeAreaInset;
  const content = webApp.contentSafeAreaInset;
  root.style.setProperty("--echo-viewport-height", `${webApp.viewportHeight || window.innerHeight}px`);
  for (const side of ["top", "right", "bottom", "left"] as const) {
    root.style.setProperty(`--tg-safe-area-inset-${side}`, `${safe?.[side] || 0}px`);
    root.style.setProperty(`--tg-content-safe-area-inset-${side}`, `${content?.[side] || 0}px`);
  }
};

export const initializeTelegramMiniApp = () => {
  const webApp = telegramWebApp();
  if (!webApp?.initData) return;
  document.documentElement.classList.add("telegram-mini-app");
  syncSafeAreas();
  webApp.onEvent("safeAreaChanged", syncSafeAreas);
  webApp.onEvent("contentSafeAreaChanged", syncSafeAreas);
  webApp.onEvent("viewportChanged", syncSafeAreas);
  webApp.onEvent("deactivated", () => window.dispatchEvent(new Event("telegram-deactivated")));
  webApp.onEvent("activated", () => window.dispatchEvent(new Event("telegram-activated")));
  webApp.ready();
  webApp.expand();
};

export const configureTelegramBackButton = (canGoBack: boolean) => {
  const webApp = telegramWebApp();
  if (!webApp?.initData) return () => undefined;
  const goBack = () => window.history.back();
  if (canGoBack) {
    webApp.BackButton.show();
    webApp.BackButton.onClick(goBack);
  } else {
    webApp.BackButton.hide();
  }
  return () => webApp.BackButton.offClick(goBack);
};
