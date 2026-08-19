import type { ProfileId } from "../../../contracts/api";
import type { Language } from "../../shared/contracts";

export type PendingRecording = {
  key: string;
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
  request.onsuccess = () => resolve(request.result);
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
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Local recording storage failed."));
    };
  });
};

export const loadPendingRecording = (profileId: ProfileId, language: Language) =>
  useStore<PendingRecording | undefined>("readonly", (store) => store.get(recordingKey(profileId, language)))
    .then((recording) => recording || null);

export const savePendingRecording = (
  profileId: ProfileId,
  language: Language,
  blob: Blob,
  filename: string,
) => {
  const recording: PendingRecording = {
    key: recordingKey(profileId, language),
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
