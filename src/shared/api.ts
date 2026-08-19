import { apiPath } from "./config";

let csrfToken = "";
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const setCsrfToken = (token: string) => {
  csrfToken = token;
};

export const apiFetch = (path: string, init: RequestInit = {}) => {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (stateChangingMethods.has(method)) {
    headers.set("X-Rehearsal-Client", "web");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(apiPath(path), {
    ...init,
    credentials: "same-origin",
    headers,
  });
};
