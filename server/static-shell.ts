const pathnameOf = (url: string) => {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?", 1)[0];
  }
};

export const shouldServeAppShell = (request: {
  method: string;
  url: string;
  accept?: string;
}) => {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = pathnameOf(request.url);
  if (pathname === "/health" || pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname.split("/").pop()?.includes(".")) return false;
  return !request.accept || request.accept.includes("text/html") || request.accept.includes("*/*");
};
