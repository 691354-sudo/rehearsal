import type { ProfileId } from "../../../contracts/api";
import type { Language } from "../../shared/contracts";

export type PendingRecording = {
  key: string;
  uploadId: string;
  profileId: ProfileId;
  language: Language;
  blob: Blob;
  filename: string;
  createdAt: string;
};

const databaseName = "rehearsal-local";
const storeName = "pending-recordings";
const databaseVersion = 1;
const recordingKey = (profileId: ProfileId, language: Language) => `${profileId}:${language}`;

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(databaseName, databaseVersion);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) {
      request.result.createObjectStore(storeName, { keyPath: "key" });
    }
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error || new Error("Local recording storage is unavailable."));
});

const useStore = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let result: T;
    let requestError: DOMException | null = null;
    let settled = false;
    const fail = (error: DOMException | Error | null) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error || new Error("Local recording storage failed."));
    };
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { requestError = request.error; };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onerror = () => fail(requestError || transaction.error);
    transaction.onabort = () => fail(requestError || transaction.error);
  });
};

export const loadPendingRecording = async (profileId: ProfileId, language: Language) => {
  const recording = await useStore<PendingRecording | undefined>(
    "readonly",
    (store) => store.get(recordingKey(profileId, language)),
  );
  if (!recording) return null;
  if (recording.uploadId) return recording;
  const migrated = { ...recording, uploadId: window.crypto.randomUUID() };
  await useStore<IDBValidKey>("readwrite", (store) => store.put(migrated));
  return migrated;
};

export const savePendingRecording = (
  profileId: ProfileId,
  language: Language,
  blob: Blob,
  filename: string,
) => {
  const recording: PendingRecording = {
    key: recordingKey(profileId, language),
    uploadId: window.crypto.randomUUID(),
    profileId,
    language,
    blob,
    filename,
    createdAt: new Date().toISOString(),
  };
  return useStore<IDBValidKey>("readwrite", (store) => store.put(recording)).then(() => recording);
};

export const deletePendingRecording = (profileId: ProfileId, language: Language) =>
  useStore<undefined>("readwrite", (store) => store.delete(recordingKey(profileId, language)));
