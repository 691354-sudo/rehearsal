export const onboardingSteps = ["intro", "tutor", "notebook", "library", "practice"] as const;
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

export const parseOnboardingStep = (
  location: Pick<Location, "search">,
): OnboardingStep => {
  const requested = new URLSearchParams(location.search).get("step");
  return onboardingSteps.find((step) => step === requested) || "intro";
};

export const parseOnboardingMode = (
  location: Pick<Location, "search">,
): OnboardingMode => new URLSearchParams(location.search).get("mode") === "replay" ? "replay" : "first_run";

export const onboardingHref = (
  step: OnboardingStep,
  mode: OnboardingMode,
  baseUrl = import.meta.env.BASE_URL,
) => {
  const params = new URLSearchParams({ step });
  if (mode === "replay") params.set("mode", "replay");
  return `${normalizedBase(baseUrl)}welcome?${params.toString()}`;
};
