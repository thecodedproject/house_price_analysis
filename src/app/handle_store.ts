/**
 * Persists the picked data folder handle in IndexedDB (handles are structured-cloneable),
 * so a reload only needs a one-click permission re-grant rather than re-picking the folder.
 */
const DB_NAME = 'house-price-analysis';
const STORE = 'handles';
const KEY = 'dataDir';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function loadHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await tx<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY));
  } catch {
    return undefined;
  }
}

export async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(handle, KEY));
  } catch {
    /* non-fatal: user just has to pick the folder again next time */
  }
}

export async function clearHandle(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch {
    /* ignore */
  }
}
