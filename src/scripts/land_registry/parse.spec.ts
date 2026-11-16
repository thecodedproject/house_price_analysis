import { readFileSync } from 'fs';
import * as path from 'path';
import { LandRegistryRecord, parseCsv, parsePpdCsv, toProperties, toProperty, toSale } from './parse';

const fixture = readFileSync(path.join(__dirname, '__fixtures__', 'lr_sample.csv'), 'utf8');

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,,3\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '', '3'],
    ]);
  });
});

describe('Land Registry PPD CSV', () => {
  const records = parsePpdCsv(fixture);

  it('parses the real download format', () => {
    expect(records.length).toBe(7);
    expect(records[0]).toMatchObject({
      unique_id: '2E1F4E63-2903-4232-A7AB-B34CA40F6214',
      price_paid: '1750000',
      deed_date: '2000-06-19',
      postcode: 'SW1P 3NG',
      paon: '6',
      street: 'BARTON STREET',
    });
  });

  it('maps to Property and final Sale rows', () => {
    const p = toProperty(records[0]);
    expect(p).toMatchObject({ id: 'SW1P3NG_barton_street_6', postcode: 'SW1P 3NG', propertyType: 'T', tenure: 'F' });
    expect(p.saon).toBeUndefined();
    expect(toSale(records[0], p.id)).toMatchObject({
      id: '2E1F4E63-2903-4232-A7AB-B34CA40F6214',
      propertyId: 'SW1P3NG_barton_street_6',
      price: 1750000,
      date: '2000-06-19',
      status: 'final',
      source: 'land_registry',
      newBuild: false,
      ppdCategory: 'A',
      propertyType: 'T',
      tenure: 'F',
    });
  });

  it('includes the saon for flats and maps category B', () => {
    const flat = records[records.length - 1];
    expect(toProperty(flat)).toMatchObject({ id: 'SW1P3BU_great_smith_street_28_flat_2', saon: 'FLAT 2', propertyType: 'F', tenure: 'L' });
    expect(toSale(records[1], 'x')).toMatchObject({ ppdCategory: 'B', price: 3750000 });
  });

  it('merges one property per address across its sales', () => {
    expect(toProperties(records).map((p) => p.id).sort()).toEqual([
      'SW1P3BU_great_smith_street_28_flat_2',
      'SW1P3NG_barton_street_1',
      'SW1P3NG_barton_street_2',
      'SW1P3NG_barton_street_4',
      'SW1P3NG_barton_street_5',
      'SW1P3NG_barton_street_6',
    ]);
  });

  it('merges records per property: latest non-empty value wins, whatever the input order', () => {
    const base = records[0];
    const rec = (deed_date: string, property_type: string, estate_type: string, locality: string): LandRegistryRecord => ({
      ...base,
      deed_date,
      property_type,
      estate_type,
      locality,
    });
    // a terrace converted to a leasehold flat; the newest record has no locality
    const merged = toProperties([rec('2021-03-01', 'F', 'L', ''), rec('1997-05-01', 'T', 'F', 'LONDON'), rec('2005-01-01', 'T', 'F', 'LONDON')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ propertyType: 'F', tenure: 'L', locality: 'LONDON' });
  });

  it('rejects unexpected content', () => {
    expect(() => parsePpdCsv('<html>Just a moment...</html>')).toThrow(/Unexpected PPD CSV header/);
  });
});
