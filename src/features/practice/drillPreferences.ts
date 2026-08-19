import type { Language } from "../../shared/contracts";
import type { PracticeSort } from "../../lib/drillQueue";
import type { ProfileId } from "../../../contracts/api";

export type DrillPreferences = {
  order: string[];
  loopIds: string[];
  topics: string[];
  scope: "all" | "due";
  sort: PracticeSort;
};

const storageKey = (profileId: ProfileId, language: Language) => `rehearsal:${profileId}:drill:${language}`;

export const loadDrillPreferences = (profileId: ProfileId, language: Language): DrillPreferences => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(profileId, language)) || "{}") as Partial<DrillPreferences>;
    return {
      order: Array.isArray(saved.order) ? saved.order.map(String) : [],
      loopIds: Array.isArray(saved.loopIds) ? saved.loopIds.map(String) : [],
      topics: Array.isArray(saved.topics) ? saved.topics.map(String) : [],
      scope: saved.scope === "due" ? "due" : "all",
      sort: ["due-first", "new-first", "alphabetical"].includes(String(saved.sort))
        ? saved.sort as PracticeSort : "manual",
    };
  } catch {
    return { order: [], loopIds: [], topics: [], scope: "all", sort: "manual" };
  }
};

export const saveDrillPreferences = (profileId: ProfileId, language: Language, preferences: DrillPreferences) => {
  window.localStorage.setItem(storageKey(profileId, language), JSON.stringify(preferences));
};
