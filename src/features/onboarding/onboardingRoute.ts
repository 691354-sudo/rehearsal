import type { LanguageCode } from "../../../contracts/api";
import {
  defaultLibraryRoute,
  defaultPracticeRoute,
  defaultTutorRoute,
  parseAppRoute,
  serializeAppRoute,
  type AppRoute,
} from "../../lib/appRoute";

export const onboardingSteps = ["tutor", "notebook", "library", "practice"] as const;
export type OnboardingStep = typeof onboardingSteps[number];
export type OnboardingMode = "first_run" | "replay";

const normalizedBase = (baseUrl: string) => {
  const leading = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  return leading.endsWith("/") ? leading : `${leading}/`;
};

export const isWelcomeLocation = (
  location: Pick<Location, "pathname">,
  baseUrl = import.meta.env.BASE_URL,
) => location.pathname === `${normalizedBase(baseUrl)}welcome`;

export const isOnboardingLocation = (
  location: Pick<Location, "pathname" | "search">,
  baseUrl = import.meta.env.BASE_URL,
) => isWelcomeLocation(location, baseUrl)
  || ["first_run", "replay"].includes(new URLSearchParams(location.search).get("tour") || "");

export const parseOnboardingStep = (
  location: Pick<Location, "pathname" | "search">,
  baseUrl = import.meta.env.BASE_URL,
): OnboardingStep => {
  if (isWelcomeLocation(location, baseUrl)) {
    const requested = new URLSearchParams(location.search).get("step");
    return onboardingSteps.find((step) => step === requested) || "tutor";
  }
  const route = parseAppRoute(location, baseUrl);
  if (route.section === "tutor") return route.mode === "notebook" ? "notebook" : "tutor";
  return route.section;
};

export const parseOnboardingMode = (
  location: Pick<Location, "search">,
): OnboardingMode => {
  const params = new URLSearchParams(location.search);
  return params.get("tour") === "replay" || params.get("mode") === "replay" ? "replay" : "first_run";
};

export const onboardingRoute = (
  step: OnboardingStep,
  language: LanguageCode,
  mode: OnboardingMode,
  tutorThreadId?: string,
): AppRoute => {
  if (step === "tutor") return { ...defaultTutorRoute(language), thread: tutorThreadId || null, tour: mode };
  if (step === "notebook") return { ...defaultTutorRoute(language), mode: "notebook", tour: mode };
  if (step === "library") return { ...defaultLibraryRoute(language), tour: mode };
  return { ...defaultPracticeRoute(language), tour: mode };
};

export const onboardingHref = (
  step: OnboardingStep,
  language: LanguageCode,
  mode: OnboardingMode,
  baseUrl = import.meta.env.BASE_URL,
  tutorThreadId?: string,
) => serializeAppRoute(onboardingRoute(step, language, mode, tutorThreadId), baseUrl);
