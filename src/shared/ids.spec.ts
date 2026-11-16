import {
  listingId,
  normalisePostcode,
  normaliseSaon,
  normaliseStreet,
  parseFreeAddress,
  postcodeKey,
  postcodeSlug,
  propertyId,
} from './ids';

describe('postcodes', () => {
  it.each([
    ['sw1p 3ng', 'SW1P 3NG'],
    ['SW1P3NG', 'SW1P 3NG'],
    ['  sw1a   0aa ', 'SW1A 0AA'],
    ['SW1A', 'SW1A'],
  ])('normalisePostcode(%p) = %p', (input, expected) => {
    expect(normalisePostcode(input)).toBe(expected);
  });

  it('builds keys and slugs', () => {
    expect(postcodeKey('sw1p 3ng')).toBe('SW1P3NG');
    expect(postcodeSlug('SW1P3NG')).toBe('sw1p-3ng');
  });
});

describe('street & saon normalisation', () => {
  it('expands a trailing abbreviation only', () => {
    expect(normaliseStreet('Barton St')).toBe('barton_street');
    expect(normaliseStreet('BARTON STREET')).toBe('barton_street');
    expect(normaliseStreet('St Johns Rd')).toBe('st_johns_road');
    expect(normaliseStreet("St. John's Road")).toBe('st_johns_road');
  });

  it('treats flat/apartment the same', () => {
    expect(normaliseSaon('FLAT A')).toBe('flat_a');
    expect(normaliseSaon('Apartment a')).toBe('flat_a');
    expect(normaliseSaon('FIRST FLOOR FLAT')).toBe('first_floor_flat');
  });
});

describe('propertyId', () => {
  it('is identical for Land Registry and Zoopla spellings of the same address', () => {
    const lr = propertyId({ postcode: 'SW1P 3NG', street: 'BARTON STREET', paon: '12', saon: '' });
    const zoopla = propertyId({ postcode: 'sw1p3ng', street: 'Barton St', paon: '12' });
    expect(lr).toBe('SW1P3NG_barton_street_12');
    expect(zoopla).toBe(lr);
  });

  it('includes the saon for flats', () => {
    expect(propertyId({ postcode: 'SW1P 3NG', street: 'Barton Street', paon: '16A', saon: 'Flat 2' })).toBe(
      'SW1P3NG_barton_street_16a_flat_2',
    );
  });

  it('handles named houses', () => {
    expect(propertyId({ postcode: 'SW1P 3NG', street: 'Barton Street', paon: 'Rose Cottage' })).toBe(
      'SW1P3NG_barton_street_rose_cottage',
    );
  });
});

describe('parseFreeAddress', () => {
  it.each([
    ['12 Barton Street, London SW1P 3NG', { paon: '12', street: 'Barton Street', saon: undefined }],
    ['Flat A, 12 Barton Street, London SW1P 3NG', { paon: '12', street: 'Barton Street', saon: 'Flat A' }],
    ['16a Barton Street, London, SW1P 3NG', { paon: '16a', street: 'Barton Street', saon: undefined }],
    ['Rose Cottage, Barton Street, London', { paon: 'Rose Cottage', street: 'Barton Street' }],
  ])('%p', (address, expected) => {
    expect(parseFreeAddress(address, 'SW1P 3NG')).toEqual(expected);
  });

  it('returns undefined when there is no street', () => {
    expect(parseFreeAddress('London')).toBeUndefined();
  });
});

describe('listingId', () => {
  it('uses month precision', () => {
    expect(listingId('SW1P3NG_barton_street_12', 'sale', '2024-03-15', 650000)).toBe(
      'SW1P3NG_barton_street_12_sale_2024-03_650000',
    );
  });
});
