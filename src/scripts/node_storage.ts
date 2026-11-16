import { mkdir, readFile, writeFile, access } from 'fs/promises';
import * as path from 'path';
import { Storage } from '../shared/storage';

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');

/** Storage over the local filesystem, rooted at data/. */
export class NodeStorage implements Storage {
  constructor(readonly root: string = DATA_DIR) {}

  private resolve(p: string): string {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(path.resolve(this.root))) throw new Error(`Path escapes data root: ${p}`);
    return full;
  }

  async readText(p: string): Promise<string | undefined> {
    try {
      return await readFile(this.resolve(p), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async writeText(p: string, text: string): Promise<void> {
    const full = this.resolve(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }

  async writeBinary(p: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async exists(p: string): Promise<boolean> {
    try {
      await access(this.resolve(p));
      return true;
    } catch {
      return false;
    }
  }
}
