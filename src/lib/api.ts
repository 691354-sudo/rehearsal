export const apiPath = (path: string) => {
  const relative = path.replace(/^\//, "");
  const configuredBase = String(import.meta.env.VITE_API_BASE || "").trim();
  if (configuredBase) return `${configuredBase.replace(/\/$/, "")}/${relative}`;
  return `${import.meta.env.BASE_URL}${relative}`;
};
