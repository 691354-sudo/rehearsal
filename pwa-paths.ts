const normalizeBase = (configuredBase: string) => {
  const withLeadingSlash = configuredBase.startsWith("/") ? configuredBase : `/${configuredBase}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
};

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const pwaPathPatterns = (configuredBase: string) => {
  const base = normalizeBase(configuredBase);
  const escapedBase = escapePattern(base);
  return {
    base,
    privatePathPattern: new RegExp(`^${escapedBase}(?:api(?:/|$)|health$)`),
    privateUrlPattern: new RegExp(`^https?://[^/]+${escapedBase}(?:api(?:/|$)|health(?:[?#]|$))`),
    recoveryPathPattern: new RegExp(`^${escapedBase}recover$`),
  };
};
