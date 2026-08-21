import { useCallback, useEffect, useRef, useState } from "react";
import { navigate, parseAppRoute, routeHistoryState, serializeAppRoute, type AppRoute, type HistoryMode } from "../lib/appRoute";
import type { Language } from "../shared/contracts";

const baseUrl = import.meta.env.BASE_URL;

export function useAppRoute(fallbackLanguage: Language, availableLanguages: readonly Language[]) {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(
    window.location, baseUrl, fallbackLanguage, availableLanguages,
  ));
  const routeRef = useRef(route);

  useEffect(() => { routeRef.current = route; }, [route]);

  useEffect(() => {
    const onRouteChange = () => setRoute(parseAppRoute(
      window.location, baseUrl, fallbackLanguage, availableLanguages,
    ));
    const onPopState = () => {
      const next = parseAppRoute(window.location, baseUrl, fallbackLanguage, availableLanguages);
      const beforeNavigate = new CustomEvent("app-before-navigate", { cancelable: true, detail: { route: next } });
      if (window.dispatchEvent(beforeNavigate)) {
        setRoute(next);
        return;
      }
      window.history.pushState(routeHistoryState(routeRef.current), "", serializeAppRoute(routeRef.current, baseUrl));
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("app-routechange", onRouteChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("app-routechange", onRouteChange);
    };
  }, [availableLanguages, fallbackLanguage]);

  useEffect(() => {
    const canonical = serializeAppRoute(route, baseUrl);
    if (`${window.location.pathname}${window.location.search}` !== canonical) {
      window.history.replaceState(window.history.state, "", canonical);
    }
  }, [route]);

  const goTo = useCallback((next: AppRoute, historyMode: HistoryMode = "push") => {
    navigate(next, historyMode, baseUrl);
  }, []);

  return { route, goTo };
}
