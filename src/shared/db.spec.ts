import { Db, stableStringify } from './db';
import { MemoryStorage } from './storage';

const property = {
  id: 'SW1P3NG_barton_street_12',
  postcode: 'SW1P 3NG',
  paon: '12',
  street: 'BARTON STREET',
};

function clock() {
  let t = 0;
  return () => `2026-01-01T00:00:0${t++}.000Z`;
}

describe('Db', () => {
  it('upsert is idempotent and keeps firstSeen/updatedAt for unchanged rows', async () => {
    const db = new Db(new MemoryStorage(), clock());
    expect(db.upsert('properties', property)).toBe('inserted');
    const first = { ...db.properties[property.id] };
    expect(db.upsert('properties', property)).toBe('unchanged');
    expect(db.properties[property.id]).toEqual(first);
  });

  it('merges partial updates without wiping existing fields', () => {
    const db = new Db(new MemoryStorage(), clock());
    db.upsert('properties', { ...property, propertyType: 'T' });
    expect(db.upsert('properties', { ...property, uprn: '123', propertyType: undefined })).toBe('updated');
    const row = db.properties[property.id];
    expect(row.propertyType).toBe('T');
    expect(row.uprn).toBe('123');
    expect(row.updatedAt).not.toBe(row.firstSeen);
  });

  it('saves only dirty tables and round-trips through storage', async () => {
    const storage = new MemoryStorage();
    const db = new Db(storage, clock());
    db.upsert('properties', property);
    expect(await db.save()).toEqual(['properties']);
    expect(await db.save()).toEqual([]);

    const loaded = await Db.load(storage);
    expect(loaded.properties).toEqual(db.properties);
    loaded.upsert('properties', property);
    expect(await loaded.save()).toEqual([]);
  });

  it('stats count distinct rows, not upsert calls', () => {
    const storage = new MemoryStorage();
    const db = new Db(storage, clock());
    // one property with 3 sales: the scraper upserts the property once per sale
    for (const [i, locality] of [undefined, 'LONDON', undefined].entries()) {
      db.upsert('properties', { ...property, locality });
      db.upsert('sales', { id: `S${i}`, propertyId: property.id, date: `200${i}-01-01`, price: 1, status: 'final', source: 'land_registry' });
    }
    // the same postcode processed twice in a run
    db.upsert('sales', { id: 'S0', propertyId: property.id, date: '2000-01-01', price: 1, status: 'final', source: 'land_registry' });
    expect(db.stats.properties).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect(db.stats.sales).toEqual({ inserted: 3, updated: 0, unchanged: 0 });
  });

  it('stats: a pre-existing row is updated if any upsert changed it, else unchanged', async () => {
    const storage = new MemoryStorage();
    const first = new Db(storage, clock());
    first.upsert('properties', property);
    first.upsert('properties', { ...property, id: 'other' });
    await first.save();

    const db = await Db.load(storage, clock());
    db.upsert('properties', { ...property, uprn: '1' });
    db.upsert('properties', property); // unchanged after the update: still counts as updated
    db.upsert('properties', { ...property, id: 'other' });
    db.upsert('properties', { ...property, id: 'other' });
    expect(db.stats.properties).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
  });

  it('stableStringify sorts keys and drops undefined', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: 2 } })).toBe('{\n  "a": {\n    "c": 2\n  },\n  "b": 1\n}\n');
  });
});
