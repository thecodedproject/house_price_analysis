import { Db } from '../../shared/db';
import { MemoryStorage } from '../../shared/storage';
import { ingestHistory, ingestHousePricesResult, ingestListingPage, resolveProperty } from './ingest';

const P = 'SW1P3NG_barton_street_12';

function newDb() {
  const db = new Db(new MemoryStorage(), () => '2026-01-01T00:00:00.000Z');
  db.upsert('properties', { id: P, postcode: 'SW1P 3NG', paon: '12', street: 'BARTON STREET', propertyType: 'T' });
  db.upsert('sales', { id: 'LR-1', propertyId: P, date: '2019-06-14', price: 610000, status: 'final', source: 'land_registry' });
  return db;
}

describe('resolveProperty', () => {
  it('matches an existing Land Registry property by address and records the UPRN', () => {
    const db = newDb();
    const id = resolveProperty(
      db,
      { uprn: '6001', address: '12 Barton Street, London SW1P 3NG' },
      'SW1P 3NG',
      'https://www.zoopla.co.uk/property/uprn/6001/',
    );
    expect(id).toBe(P);
    expect(db.properties[P]).toMatchObject({ uprn: '6001', street: 'BARTON STREET', propertyType: 'T' });
    expect(Object.keys(db.properties)).toHaveLength(1);
  });

  it('matches by UPRN even when the address text differs', () => {
    const db = newDb();
    db.upsert('properties', { ...db.properties[P], uprn: '6001' });
    const id = resolveProperty(db, { uprn: '6001', address: '12, Barton St' }, 'SW1P 3NG', 'u');
    expect(id).toBe(P);
  });

  it('creates a new property when unknown', () => {
    const db = newDb();
    const id = resolveProperty(db, { uprn: '6002', address: 'Flat 1, 20 Barton Street' }, 'SW1P 3NG', 'u');
    expect(id).toBe('SW1P3NG_barton_street_20_flat_1');
    expect(db.properties[id]).toMatchObject({ paon: '20', saon: 'Flat 1', uprn: '6002' });
  });
});

describe('ingestHistory', () => {
  it('skips sales already in Land Registry, adds provisional ones and listings', () => {
    const db = newDb();
    ingestHistory(
      db,
      P,
      [
        { kind: 'sale', label: 'Sold', date: '2019-06', datePrecision: 'month', price: 610000 },
        {
          kind: 'listing',
          listingType: 'sale',
          label: 'Listed',
          date: '2025-01-10',
          datePrecision: 'day',
          price: 725000,
          listing: { id: '39308585', listingType: 'sale', url: 'https://z/property-history/x/39308585', bedrooms: 3, imageUrls: [], floorplanUrls: [] },
        },
        { kind: 'sale', label: 'Sold', date: '2025-08', datePrecision: 'month', price: 700000 },
      ],
    );
    const sales = db.salesFor(P);
    expect(sales.map((s) => [s.id, s.status])).toEqual([
      ['LR-1', 'final'],
      [`zoopla_${P}_2025-08`, 'provisional'],
    ]);
    const listing = db.listings[`${P}_sale_2025-01_725000`];
    // the listing keeps its own snapshot and Zoopla id
    expect(listing).toMatchObject({ price: 725000, bedrooms: 3, zooplaListingId: '39308585', images: [] });
  });
});

describe('ingestListingPage', () => {
  it('attaches the page to the listing with the same price', () => {
    const db = newDb();
    ingestHistory(db, P, [
      { kind: 'listing', listingType: 'sale', label: 'Listed for sale', date: '2025-01', datePrecision: 'month', price: 725000 },
      { kind: 'listing', listingType: 'sale', label: 'Price reduced', date: '2025-03', datePrecision: 'month', price: 699950 },
    ]);
    const id = ingestListingPage(
      db,
      P,
      { url: 'https://z/for-sale/details/66012345/', listingId: '66012345', listingType: 'sale', price: 699950, features: ['Garden'], tags: ['Freehold'], status: 'Sold STC', imageUrls: [], floorplanUrls: [], bedrooms: 3 },
      { images: ['images/x/01.jpg'], floorplans: ['images/x/floorplan_01.jpg'] },
      '2026-01-01',
    );
    expect(id).toBe(`${P}_sale_2025-03_699950`);
    expect(db.listings[id!]).toMatchObject({
      zooplaListingId: '66012345',
      bedrooms: 3,
      images: ['images/x/01.jpg'],
      floorplans: ['images/x/floorplan_01.jpg'],
      features: ['Garden'],
      tags: ['Freehold'],
      status: 'Sold STC',
    });
  });

  it('matches by Zoopla listing id before price', () => {
    const db = newDb();
    ingestHistory(db, P, [
      { kind: 'listing', listingType: 'sale', label: 'Listed', date: '2018-09-17', datePrecision: 'day', price: 800000, listing: { id: '111', listingType: 'sale', url: 'u1', imageUrls: [], floorplanUrls: [] } },
      { kind: 'listing', listingType: 'sale', label: 'Listed', date: '2022-01-19', datePrecision: 'day', price: 800000, listing: { id: '222', listingType: 'sale', url: 'u2', imageUrls: [], floorplanUrls: [] } },
    ]);
    const lp = { url: 'u1', listingId: '111', listingType: 'sale' as const, price: 800000, features: [], tags: [], imageUrls: [], floorplanUrls: [], description: 'old one' };
    expect(ingestListingPage(db, P, lp, { images: [], floorplans: [] }, '2026-01-01')).toBe(`${P}_sale_2018-09_800000`);
  });

  it('creates a listing when no history row matches', () => {
    const db = newDb();
    const id = ingestListingPage(db, P, { url: 'u', listingId: '1', listingType: 'sale', price: 800000, features: [], tags: [], imageUrls: [], floorplanUrls: [] }, { images: [], floorplans: [] }, '2026-11-15');
    expect(id).toBe(`${P}_sale_2026-11_800000`);
  });
});

describe('ingestHousePricesResult', () => {
  const row = {
    uprn: '100022724776',
    address: '6 Barton Street, London, SW1P 3NG',
    postcode: 'SW1P 3NG',
    latitude: 51.4972,
    longitude: -0.1272,
    floorAreaSqm: 82,
    lastSale: { date: '2025-09-01', price: 4650000 },
  };

  function dbWith6(withLrSale: boolean) {
    const db = new Db(new MemoryStorage(), () => '2026-01-01T00:00:00.000Z');
    db.upsert('properties', { id: 'SW1P3NG_barton_street_6', postcode: 'SW1P 3NG', paon: '6', street: 'BARTON STREET' });
    if (withLrSale) {
      db.upsert('sales', { id: 'LR-6', propertyId: 'SW1P3NG_barton_street_6', date: '2025-09-01', price: 4650000, status: 'final', source: 'land_registry' });
    }
    return db;
  }

  it('links to the Land Registry property and adds UPRN + coordinates, without duplicating the sale', () => {
    const db = dbWith6(true);
    expect(ingestHousePricesResult(db, row, 'SW1P 3NG')).toBe('SW1P3NG_barton_street_6');
    expect(db.properties['SW1P3NG_barton_street_6']).toMatchObject({
      uprn: '100022724776',
      latitude: 51.4972,
      zooplaUrl: 'https://www.zoopla.co.uk/property/uprn/100022724776/',
    });
    expect(Object.keys(db.properties)).toHaveLength(1);
    expect(Object.keys(db.sales)).toEqual(['LR-6']);
  });

  it('records a sale Land Registry has not published yet as provisional', () => {
    const db = dbWith6(false);
    ingestHousePricesResult(db, row, 'SW1P 3NG');
    expect(db.salesFor('SW1P3NG_barton_street_6')).toEqual([
      expect.objectContaining({ date: '2025-09-01', price: 4650000, status: 'provisional', source: 'zoopla' }),
    ]);
  });
});
