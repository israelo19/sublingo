/** Tiny IndexedDB key-value store (no dependencies). Used for cached audio clips. */
const DB_NAME = 'sublingo';
const DB_VERSION = 1;
const STORES = ['tts'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = undefined));
  }
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> => run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbSet = (store: StoreName, key: string, value: unknown): Promise<unknown> => run(store, 'readwrite', (s) => s.put(value, key));
export const idbDelete = (store: StoreName, key: string): Promise<unknown> => run(store, 'readwrite', (s) => s.delete(key));
export const idbCount = (store: StoreName): Promise<number> => run(store, 'readonly', (s) => s.count());
export const idbClear = (store: StoreName): Promise<unknown> => run(store, 'readwrite', (s) => s.clear());
