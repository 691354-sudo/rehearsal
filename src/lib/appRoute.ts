import type { LibrarySort, LibraryStatus } from "./libraryView";
import type { Language } from "../shared/contracts";
import { isLanguageCode } from "../../contracts/api";
import { languageHasAudio } from "../shared/config";

export type PracticeCardCount = "all" | "10" | "20" | "50";
export type PracticeScopeRoute = "due" | "library";

type RouteBase = {
  language: Language;
  settings: boolean;
};

export type PracticeRoute = RouteBase & {
  section: "practice";
  mode: "recall" | "listen";
  scope: PracticeScopeRoute;
  topic: string;
  cards: PracticeCardCount;
  review: string | null;
};

export type TutorRoute = RouteBase & {
  section: "tutor";
  mode: "chat" | "notebook";
  thread: string | null;
};

export type LibraryRoute = RouteBase & {
  section: "library";
  view: "cards" | "topics";
  query: string;
  status: LibraryStatus;
  topic: string;
  sort: LibrarySort;
  page: number;
  panel: "import" | null;
  edit: string | null;
};

export type AppRoute = PracticeRoute | TutorRoute | LibraryRoute;
export type HistoryMode = "push" | "replace";

export type RouteHistoryState = {
  rehearsal: true;
  surface: "settings" | "import" | "editor" | null;
};

export function routeHistoryState(route: AppRoute): RouteHistoryState {
  const surface: RouteHistoryState["surface"] = route.settings ? "settings"
    : route.section === "library" && route.edit ? "editor"
      : route.section === "library" && route.panel === "import" ? "import"
        : null;
  return { rehearsal: true, surface };
}

const cardCounts = new Set<PracticeCardCount>(["all", "10", "20", "50"]);
const libraryStatuses = new Set<LibraryStatus>(["all", "new", "learning", "learned"]);
const librarySorts = new Set<LibrarySort>(["recent", "oldest", "due", "az"]);

const normalizeBaseUrl = (baseUrl: string) => {
  const withLeadingSlash = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
};

const routePath = (location: Pick<Location, "pathname">, baseUrl: string) => {
  const base = normalizeBaseUrl(baseUrl);
  const relative = location.pathname.startsWith(base)
    ? location.pathname.slice(base.length)
    : location.pathname.replace(/^\/+/, "");
  return relative.replace(/\/+$/, "");
};

const valueOrNull = (params: URLSearchParams, key: string) => params.get(key)?.trim() || null;

export function parseAppRoute(
  location: Pick<Location, "pathname" | "search">,
  baseUrl: string,
  fallbackLanguage: Language = "en",
  availableLanguages: readonly Language[] = ["en", "lv", "vi", "no"],
): AppRoute {
  const params = new URLSearchParams(location.search);
  const requestedLanguage = params.get("lang");
  const language: Language = isLanguageCode(requestedLanguage)
    && availableLanguages.includes(requestedLanguage) ? requestedLanguage : fallbackLanguage;
  const settings = params.get("settings") === "1";
  const path = routePath(location, baseUrl);

  if (path === "tutor/chat" || path === "tutor/notebook") {
    return {
      section: "tutor",
      mode: path.endsWith("notebook") ? "notebook" : "chat",
      thread: path.endsWith("chat") ? valueOrNull(params, "thread") : null,
      language,
      settings,
    };
  }

  if (path === "library" || path === "library/topics") {
    const rawPage = Number(params.get("page"));
    const status = params.get("status") as LibraryStatus;
    const sort = params.get("sort") as LibrarySort;
    return {
      section: "library",
      view: path.endsWith("topics") ? "topics" : "cards",
      query: params.get("q") || "",
      status: libraryStatuses.has(status) ? status : "all",
      topic: valueOrNull(params, "topic") || "all",
      sort: librarySorts.has(sort) ? sort : "recent",
      page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
      panel: path === "library" && params.get("panel") === "import" ? "import" : null,
      edit: valueOrNull(params, "edit"),
      language,
      settings,
    };
  }

  const count = params.get("cards") as PracticeCardCount;
  const review = valueOrNull(params, "review");
  return {
    section: "practice",
    mode: path === "practice/listen" && languageHasAudio(language) ? "listen" : "recall",
    scope: review || params.get("scope") === "library" ? "library" : "due",
    topic: valueOrNull(params, "topic") || "",
    cards: cardCounts.has(count) ? count : "all",
    review,
    language,
    settings,
  };
}

export function serializeAppRoute(route: AppRoute, baseUrl: string) {
  const base = normalizeBaseUrl(baseUrl);
  const params = new URLSearchParams({ lang: route.language });
  if (route.settings) params.set("settings", "1");
  let path: string;

  if (route.section === "practice") {
    path = `practice/${route.mode}`;
    if (route.scope !== "due") params.set("scope", route.scope);
    if (route.topic) params.set("topic", route.topic);
    if (route.cards !== "all") params.set("cards", route.cards);
    if (route.review) params.set("review", route.review);
  } else if (route.section === "tutor") {
    path = `tutor/${route.mode}`;
    if (route.mode === "chat" && route.thread) params.set("thread", route.thread);
  } else {
    path = route.view === "topics" ? "library/topics" : "library";
    if (route.query) params.set("q", route.query);
    if (route.status !== "all") params.set("status", route.status);
    if (route.topic !== "all") params.set("topic", route.topic);
    if (route.sort !== "recent") params.set("sort", route.sort);
    if (route.page > 1) params.set("page", String(route.page));
    if (route.view === "cards" && route.panel) params.set("panel", route.panel);
    if (route.edit) params.set("edit", route.edit);
  }

  return `${base}${path}?${params.toString()}`;
}

export function navigate(route: AppRoute, historyMode: HistoryMode = "push", baseUrl = import.meta.env.BASE_URL) {
  const beforeNavigate = new CustomEvent("app-before-navigate", { cancelable: true, detail: { route } });
  if (!window.dispatchEvent(beforeNavigate)) return false;
  const href = serializeAppRoute(route, baseUrl);
  const current = `${window.location.pathname}${window.location.search}`;
  const method = historyMode === "replace" || href === current ? "replaceState" : "pushState";
  window.history[method](routeHistoryState(route), "", href);
  window.dispatchEvent(new Event("app-routechange"));
  return true;
}

export const defaultPracticeRoute = (language: Language): PracticeRoute => ({
  section: "practice",
  mode: "recall",
  scope: "due",
  topic: "",
  cards: "all",
  review: null,
  language,
  settings: false,
});

export const defaultTutorRoute = (language: Language): TutorRoute => ({
  section: "tutor",
  mode: "chat",
  thread: null,
  language,
  settings: false,
});

export const defaultLibraryRoute = (language: Language): LibraryRoute => ({
  section: "library",
  view: "cards",
  query: "",
  status: "all",
  topic: "all",
  sort: "recent",
  page: 1,
  panel: null,
  edit: null,
  language,
  settings: false,
});
