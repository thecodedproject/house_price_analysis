import { Storage } from './storage';
import { Listing, Property, Sale, TABLE_NAMES, TableName, Tables } from './types';

/** Fields that don't count as a "change" when comparing an upsert against the stored row. */
const VOLATILE_FIELDS = new Set(['firstSeen', 'updatedAt']);

export type UpsertResult = 'inserted' | 'updated' | 'unchanged';

type Row = { id: string; firstSeen: string; updatedAt: string };
/** What callers pass to upsert: timestamps are managed by the Db. */
export type Upsert<T extends Row> = Omit<T, 'firstSeen' | 'updatedAt'>;

export interface UpsertStats {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** JSON with recursively sorted object keys, so repeated saves produce clean diffs. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

function withoutVolatile(row: object): string {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!VOLATILE_FIELDS.has(k) && v !== undefined) copy[k] = v;
  }
  return stableStringify(copy);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export class Db {
  tables: Tables = { properties: {}, sales: {}, listings: {} };
  private dirty = new Set<TableName>();
  /**
   * Final status of each row touched since load, so a row upserted several times in one run
   * (e.g. a property with many sales) is counted once: inserted > updated > unchanged.
   */
  private touched: Record<TableName, Map<string, UpsertResult>> = {
    properties: new Map(),
    sales: new Map(),
    listings: new Map(),
  };

  /** Distinct rows inserted / updated / left unchanged since this Db was loaded. */
  get stats(): Record<TableName, UpsertStats> {
    const count = (m: Map<string, UpsertResult>): UpsertStats => {
      const s: UpsertStats = { inserted: 0, updated: 0, unchanged: 0 };
      for (const r of m.values()) s[r]++;
      return s;
    };
    return { properties: count(this.touched.properties), sales: count(this.touched.sales), listings: count(this.touched.listings) };
  }

  private record(table: TableName, id: string, result: UpsertResult): void {
    const prev = this.touched[table].get(id);
    if (prev === 'inserted' || (prev === 'updated' && result === 'unchanged')) return;
    this.touched[table].set(id, result);
  }

  constructor(private storage: Storage, private now: () => string = () => new Date().toISOString()) {}

  static async load(storage: Storage, now?: () => string): Promise<Db> {
    const db = new Db(storage, now);
    for (const name of TABLE_NAMES) {
      const text = await storage.readText(`${name}.json`);
      if (text) (db.tables as unknown as Record<string, unknown>)[name] = JSON.parse(text);
    }
    return db;
  }

  get properties(): Record<string, Property> {
    return this.tables.properties;
  }
  get sales(): Record<string, Sale> {
    return this.tables.sales;
  }
  get listings(): Record<string, Listing> {
    return this.tables.listings;
  }

  /**
   * Insert or merge a row. Fields that are undefined in `row` keep their stored value,
   * so a partial update (e.g. from a second source) never wipes data.
   */
  upsert<N extends TableName>(table: N, row: Upsert<Tables[N][string]>): UpsertResult {
    const rows = this.tables[table] as Record<string, Row>;
    const existing = rows[row.id];
    const now = this.now();
    let result: UpsertResult;
    if (!existing) {
      rows[row.id] = { ...stripUndefined(row), firstSeen: now, updatedAt: now } as Row;
      result = 'inserted';
    } else {
      const merged = { ...existing, ...stripUndefined(row) } as Row;
      if (withoutVolatile(merged) === withoutVolatile(existing)) {
        result = 'unchanged';
      } else {
        rows[row.id] = { ...merged, updatedAt: now };
        result = 'updated';
      }
    }
    this.record(table, row.id, result);
    if (result !== 'unchanged') this.dirty.add(table);
    return result;
  }

  /** Mark a table as changed after mutating rows directly. */
  touch(table: TableName): void {
    this.dirty.add(table);
  }

  salesFor(propId: string): Sale[] {
    return Object.values(this.sales)
      .filter((s) => s.propertyId === propId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  listingsFor(propId: string): Listing[] {
    return Object.values(this.listings)
      .filter((l) => l.propertyId === propId)
      .sort((a, b) => a.listedDate.localeCompare(b.listedDate) || b.price - a.price);
  }

  findPropertyByUprn(uprn: string): Property | undefined {
    return Object.values(this.properties).find((p) => p.uprn === uprn);
  }

  /** Write changed tables (or all, with `force`). Returns the tables written. */
  async save(force = false): Promise<TableName[]> {
    const written: TableName[] = [];
    for (const name of TABLE_NAMES) {
      if (force || this.dirty.has(name)) {
        await this.storage.writeText(`${name}.json`, stableStringify(this.tables[name]));
        written.push(name);
      }
    }
    this.dirty.clear();
    return written;
  }
}
