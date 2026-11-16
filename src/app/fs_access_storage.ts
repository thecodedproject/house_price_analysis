import { Storage } from '../shared/storage';

/** Storage over a directory the user picked with window.showDirectoryPicker(). */
export class FsAccessStorage implements Storage {
  private urlCache = new Map<string, string>();

  constructor(readonly root: FileSystemDirectoryHandle) {}

  private async dirFor(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name || parts.includes('..')) throw new Error(`Bad path: ${path}`);
    let dir = this.root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return [dir, name];
  }

  private async file(path: string): Promise<File | undefined> {
    try {
      const [dir, name] = await this.dirFor(path, false);
      return await (await dir.getFileHandle(name)).getFile();
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return undefined;
      throw e;
    }
  }

  async readText(path: string): Promise<string | undefined> {
    return (await this.file(path))?.text();
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.write(path, text);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    await this.write(path, new Blob([data as BlobPart]));
  }

  private async write(path: string, data: string | Blob): Promise<void> {
    const [dir, name] = await this.dirFor(path, true);
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(data);
    await writable.close();
  }

  async exists(path: string): Promise<boolean> {
    return (await this.file(path)) !== undefined;
  }

  /** An object URL for displaying a file (e.g. an image) - cached for the session. */
  async objectUrl(path: string): Promise<string | undefined> {
    const cached = this.urlCache.get(path);
    if (cached) return cached;
    const f = await this.file(path);
    if (!f) return undefined;
    const url = URL.createObjectURL(f);
    this.urlCache.set(path, url);
    return url;
  }
}
