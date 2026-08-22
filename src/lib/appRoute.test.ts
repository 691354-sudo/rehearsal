import { describe, expect, it } from "vitest";
import { defaultLibraryRoute, parseAppRoute, serializeAppRoute, type AppRoute } from "./appRoute";

const location = (pathname: string, search = "") => ({ pathname, search }) as Location;

describe("app routes", () => {
  it.each([
    ["/practice/recall", "practice", "recall"],
    ["/practice/listen", "practice", "listen"],
    ["/tutor/chat", "tutor", "chat"],
    ["/tutor/notebook", "tutor", "notebook"],
    ["/library", "library", "cards"],
    ["/library/topics", "library", "topics"],
  ])("parses %s", (pathname, section, view) => {
    const route = parseAppRoute(location(pathname, "?lang=en"), "/");
    expect(route.section).toBe(section);
    expect(route.section === "practice" || route.section === "tutor" ? route.mode : route.view).toBe(view);
  });

  it("parses stable practice state and a manual review", () => {
    expect(parseAppRoute(location("/rehearsal/practice/recall", "?lang=lv&scope=library&topic=t1&cards=20&review=c1&settings=1"), "/rehearsal/")).toEqual({
      section: "practice", mode: "recall", scope: "library", topic: "t1", cards: "20", review: "c1", language: "lv", settings: true,
    });
  });

  it("defaults Listen & Repeat to Library while preserving an explicit recommended scope", () => {
    expect(parseAppRoute(location("/practice/listen", "?lang=en"), "/"))
      .toMatchObject({ section: "practice", mode: "listen", scope: "library" });
    expect(parseAppRoute(location("/practice/listen", "?lang=en&scope=due"), "/"))
      .toMatchObject({ section: "practice", mode: "listen", scope: "due" });
  });

  it("parses Library state and discards invalid values", () => {
    expect(parseAppRoute(location("/library", "?lang=en&q=nature&status=learning&topic=t1&sort=due&page=3&panel=import&edit=c1"), "/")).toEqual({
      section: "library", view: "cards", query: "nature", status: "learning", topic: "t1", sort: "due", page: 3,
      panel: "import", edit: "c1", language: "en", settings: false,
    });
    expect(parseAppRoute(location("/library", "?status=nope&sort=nope&page=-2"), "/")).toMatchObject({ status: "all", sort: "recent", page: 1 });
  });

  it("uses the configured base path and preserves Tutor threads", () => {
    const route: AppRoute = { section: "tutor", mode: "chat", thread: "thread one", language: "en", settings: false };
    expect(serializeAppRoute(route, "/rehearsal")).toBe("/rehearsal/tutor/chat?lang=en&thread=thread+one");
    expect(parseAppRoute(location("/rehearsal/tutor/chat", "?lang=en&thread=thread+one"), "/rehearsal/")).toEqual(route);
  });

  it("round-trips every route family", () => {
    const routes: AppRoute[] = [
      { section: "practice", mode: "listen", scope: "library", topic: "topic", cards: "50", review: null, language: "en", settings: true },
      { section: "practice", mode: "listen", scope: "due", topic: "", cards: "all", review: null, language: "en", settings: false },
      { section: "tutor", mode: "notebook", thread: null, language: "lv", settings: false },
      { ...defaultLibraryRoute("en"), view: "topics", topic: "topic", page: 2, panel: "create", edit: null },
    ];
    routes.forEach((route) => {
      const href = new URL(serializeAppRoute(route, "/rehearsal/"), "https://example.test");
      expect(parseAppRoute(location(href.pathname, href.search), "/rehearsal/")).toEqual(route);
    });
  });

  it("canonicalizes Latvian listening to Recall", () => {
    expect(parseAppRoute(location("/practice/listen", "?lang=lv"), "/")).toMatchObject({ section: "practice", mode: "recall", language: "lv" });
  });

  it("supports Vietnamese listening and rejects a disabled deep link before data loads", () => {
    expect(parseAppRoute(location("/practice/listen", "?lang=vi"), "/", "en", ["en", "lv", "vi"]))
      .toMatchObject({ section: "practice", mode: "listen", language: "vi" });
    expect(parseAppRoute(location("/library", "?lang=vi"), "/", "lv", ["en", "lv"]))
      .toMatchObject({ section: "library", language: "lv" });
    expect(parseAppRoute(location("/library", "?lang=toString"), "/", "en", ["en", "lv"]))
      .toMatchObject({ section: "library", language: "en" });
  });
});
