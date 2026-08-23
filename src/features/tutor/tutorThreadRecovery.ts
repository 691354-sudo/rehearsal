export function clearMissingTutorThread(
  storage: Pick<Storage, "getItem" | "removeItem">,
  storageKey: string,
  threadId: string,
) {
  if (storage.getItem(storageKey) === threadId) storage.removeItem(storageKey);
}
