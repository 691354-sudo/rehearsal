import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate, serializeAppRoute, type AppRoute, type HistoryMode } from "../lib/appRoute";

export function AppLink({ route, historyMode = "push", onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  route: AppRoute;
  historyMode?: HistoryMode;
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(route, historyMode);
  };

  return <a {...props} href={serializeAppRoute(route, import.meta.env.BASE_URL)} onClick={follow} />;
}
