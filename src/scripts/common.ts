import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { normalisePostcode } from '../shared/ids';
import { Db } from '../shared/db';
import { PROJECT_ROOT } from './node_storage';

export interface AreaPostcode {
  postcode: string;
  /** Zoopla house-prices page for this postcode (the URL slug includes the town & street) */
  zooplaUrl?: string;
}

export const AREA_PATH = path.join(PROJECT_ROOT, 'config', 'area.json');
/** Personal settings (gitignored). See config/zoopla.example.json. */
export const ZOOPLA_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'zoopla.json');

export interface ZooplaConfig {
  /** Account to sign in with; omit to scrape signed out */
  zoopla_login_email?: string;
}

export function loadZooplaConfig(): ZooplaConfig {
  try {
    return JSON.parse(readFileSync(ZOOPLA_CONFIG_PATH, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Could not read ${ZOOPLA_CONFIG_PATH}: ${(e as Error).message}`);
  }
}

/** config/area.json as stored: entries may be plain strings or { postcode, zooplaUrl }. */
export interface AreaFile {
  postcodes: (string | AreaPostcode)[];
  [other: string]: unknown;
}

export function readAreaFile(): AreaFile {
  return JSON.parse(readFileSync(AREA_PATH, 'utf8'));
}

export function loadArea(file: AreaFile = readAreaFile(), warn: (msg: string) => void = console.warn): AreaPostcode[] {
  const out: AreaPostcode[] = [];
  for (const p of file.postcodes) {
    const entry = typeof p === 'string' ? { postcode: normalisePostcode(p) } : { ...p, postcode: normalisePostcode(p.postcode) };
    const dup = out.find((e) => e.postcode === entry.postcode);
    if (dup) {
      warn(`config/area.json lists ${entry.postcode} more than once; using the first entry`);
      dup.zooplaUrl ??= entry.zooplaUrl;
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Returns a copy of the area file with `zooplaUrl` filled in for `postcode`. Never overwrites
 * a URL that's already set (so hand-edited values win) and never adds postcodes that aren't
 * configured (e.g. an ad-hoc `--postcode`). `changed` is false when nothing needed doing.
 */
export function withZooplaUrl(file: AreaFile, postcode: string, url: string): { file: AreaFile; changed: boolean } {
  const pc = normalisePostcode(postcode);
  let changed = false;
  const postcodes = file.postcodes.map((entry) => {
    const entryPc = typeof entry === 'string' ? entry : entry.postcode;
    if (changed || normalisePostcode(entryPc) !== pc) return entry;
    if (typeof entry === 'string') {
      changed = true;
      return { postcode: entry, zooplaUrl: url };
    }
    if (entry.zooplaUrl) return entry;
    changed = true;
    return { ...entry, zooplaUrl: url };
  });
  return { file: { ...file, postcodes }, changed };
}

/** Record a discovered Zoopla URL in config/area.json. Returns true if the file was updated. */
export function saveZooplaUrl(postcode: string, url: string): boolean {
  const { file, changed } = withZooplaUrl(readAreaFile(), postcode, url);
  if (changed) writeFileSync(AREA_PATH, JSON.stringify(file, null, 2) + '\n', 'utf8');
  return changed;
}

/** Applies a `--postcode` CLI filter to the configured area (or uses it ad-hoc if not configured). */
export function selectPostcodes(area: AreaPostcode[], filter?: string): AreaPostcode[] {
  if (!filter) return area;
  const pc = normalisePostcode(filter);
  return area.filter((a) => a.postcode === pc).concat(area.some((a) => a.postcode === pc) ? [] : [{ postcode: pc }]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function printStats(db: Db): void {
  for (const [table, s] of Object.entries(db.stats)) {
    console.log(`  ${table.padEnd(10)} +${s.inserted} inserted, ~${s.updated} updated, ${s.unchanged} unchanged`);
  }
}
