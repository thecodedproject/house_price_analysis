/**
 * Minimal file storage abstraction, rooted at the data/ directory.
 * Implemented by NodeStorage (scripts) and FsAccessStorage (browser).
 * Paths are always relative and `/`-separated, e.g. "images/abc/1.jpg".
 */
export interface Storage {
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** In-memory storage, used by tests. */
export class MemoryStorage implements Storage {
  files = new Map<string, string | Uint8Array>();

  async readText(path: string): Promise<string | undefined> {
    const v = this.files.get(path);
    return typeof v === 'string' ? v : undefined;
  }
  async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }
  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}
