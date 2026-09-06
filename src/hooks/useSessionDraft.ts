import { useState, type SetStateAction } from "react";

// Save to the owning key at the edit, before a route can replace the component.
export function useSessionDraft(key: string) {
  const read = () => window.sessionStorage.getItem(key) || "";
  const [draft, setDraft] = useState(() => ({ key, value: read() }));
  if (draft.key !== key) setDraft({ key, value: read() });
  const update = (next: SetStateAction<string>) => {
    const value = typeof next === "function" ? next(read()) : next;
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
    setDraft({ key, value });
  };
  return [draft.key === key ? draft.value : read(), update] as const;
}
