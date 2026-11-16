import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Db } from '../shared/db';
import { FsAccessStorage } from './fs_access_storage';
import { clearHandle, loadHandle, saveHandle } from './handle_store';

export type DataState =
  | { status: 'unsupported' }
  | { status: 'checking' }
  | { status: 'no-folder' }
  /** A folder was remembered but the browser needs a click to re-grant access */
  | { status: 'needs-permission'; handle: FileSystemDirectoryHandle }
  | { status: 'loading'; name: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; db: Db; storage: FsAccessStorage; name: string };

interface DataContextValue {
  state: DataState;
  pickFolder(): Promise<void>;
  regrant(): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

const MODE = { mode: 'readwrite' as const };

export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function DataProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<DataState>(isSupported() ? { status: 'checking' } : { status: 'unsupported' });
  const [handle, setHandle] = useState<FileSystemDirectoryHandle>();

  const load = useCallback(async (h: FileSystemDirectoryHandle) => {
    setState({ status: 'loading', name: h.name });
    try {
      const storage = new FsAccessStorage(h);
      if (!(await storage.exists('properties.json'))) {
        throw new Error(`"${h.name}" has no properties.json - pick the project's data/ folder (run yarn scrape:lr first).`);
      }
      const db = await Db.load(storage);
      setHandle(h);
      setState({ status: 'ready', db, storage, name: h.name });
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    if (!isSupported()) return;
    (async () => {
      const h = await loadHandle();
      if (!h) return setState({ status: 'no-folder' });
      if ((await h.queryPermission(MODE)) === 'granted') return load(h);
      setState({ status: 'needs-permission', handle: h });
    })();
  }, [load]);

  const pickFolder = useCallback(async () => {
    try {
      const h = await window.showDirectoryPicker!({ id: 'house-price-data', ...MODE });
      await saveHandle(h);
      await load(h);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setState({ status: 'error', message: (e as Error).message });
    }
  }, [load]);

  const regrant = useCallback(async () => {
    if (state.status !== 'needs-permission') return;
    if ((await state.handle.requestPermission(MODE)) === 'granted') await load(state.handle);
  }, [state, load]);

  const reload = useCallback(async () => {
    if (handle) await load(handle);
  }, [handle, load]);

  const close = useCallback(async () => {
    await clearHandle();
    setHandle(undefined);
    setState({ status: 'no-folder' });
  }, []);

  return (
    <DataContext.Provider value={{ state, pickFolder, regrant, reload, close }}>{children}</DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

/** For pages that only render once data is loaded. */
export function useDb(): { db: Db; storage: FsAccessStorage } {
  const { state } = useData();
  if (state.status !== 'ready') throw new Error('Data not loaded');
  return { db: state.db, storage: state.storage };
}
