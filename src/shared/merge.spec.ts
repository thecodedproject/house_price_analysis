import { Db } from './db';
import { chainListings, isSameSale, reconcileSales } from './merge';
import { MemoryStorage } from './storage';
import { Listing } from './types';

const P = 'SW1P3NG_barton_street_12';

function newDb() {
  const db = new Db(new MemoryStorage(), () => '2026-01-01T00:00:00.000Z');
  db.upsert('properties', { id: P, postcode: 'SW1P 3NG', paon: '12', street: 'BARTON STREET' });
  return db;
}

function listing(date: string, price: number): Omit<Listing, 'firstSeen' | 'updatedAt'> {
  return {
    id: `${P}_sale_${date}_${price}`,
    propertyId: P,
    listedDate: date,
    datePrecision: 'month',
    price,
    listingType: 'sale',
    images: [],
  };
}

describe('isSameSale', () => {
  it('matches close dates and prices', () => {
    expect(isSameSale({ date: '2025-03', price: 650000 }, { date: '2025-06-20', price: 650000 })).toBe(true);
    expect(isSameSale({ date: '2025-03', price: 650000 }, { date: '2025-06-20', price: 640000 })).toBe(true);
  });
  it('rejects distant dates or prices', () => {
    expect(isSameSale({ date: '2023-01', price: 650000 }, { date: '2025-06-20', price: 650000 })).toBe(false);
    expect(isSameSale({ date: '2025-03', price: 650000 }, { date: '2025-04-01', price: 500000 })).toBe(false);
  });
});

describe('reconcileSales', () => {
  it('supersedes a provisional sale once the Land Registry record arrives, leaving the final row alone', () => {
    const db = newDb();
    db.upsert('sales', { id: 'zoopla_x', propertyId: P, date: '2025-03', price: 650000, status: 'provisional', source: 'zoopla' });
    expect(reconcileSales(db)).toBe(0);

    db.upsert('sales', { id: 'LR-1', propertyId: P, date: '2025-05-02', price: 652000, status: 'final', source: 'land_registry' });
    const finalBefore = { ...db.sales['LR-1'] };
    expect(reconcileSales(db)).toBe(1);
    expect(db.sales['zoopla_x'].supersededBy).toBe('LR-1');
    expect(db.sales['LR-1']).toEqual(finalBefore);
    expect(reconcileSales(db)).toBe(0);
  });
});

describe('chainListings', () => {
  it('chains price reductions and breaks the chain across a sale', () => {
    const db = newDb();
    db.upsert('listings', listing('2023-01', 700000));
    db.upsert('listings', listing('2023-03', 675000));
    db.upsert('sales', { id: 'LR-1', propertyId: P, date: '2023-06-01', price: 660000, status: 'final', source: 'land_registry' });
    db.upsert('listings', listing('2023-09', 750000));

    chainListings(db);
    expect(db.listings[`${P}_sale_2023-03_675000`].previousListingId).toBe(`${P}_sale_2023-01_700000`);
    expect(db.listings[`${P}_sale_2023-09_750000`].previousListingId).toBeUndefined();
    expect(chainListings(db)).toBe(0);
  });
});
