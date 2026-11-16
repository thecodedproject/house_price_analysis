import { canonicalHousePricesUrl, defaultHousePricesUrl, isHousePricesUrlFor } from './urls';

describe('defaultHousePricesUrl', () => {
  it('builds the slug guess', () => {
    expect(defaultHousePricesUrl('SW1P 3NG')).toBe('https://www.zoopla.co.uk/house-prices/sw1p-3ng/?q=sw1p+3ng&view_type=list');
  });
});

describe('isHousePricesUrlFor', () => {
  it.each([
    ['https://www.zoopla.co.uk/house-prices/london/barton-street/sw1p-3ng/?q=sw1p+3ng', true],
    ['https://www.zoopla.co.uk/house-prices/sw1p-3ng/', true],
    ['https://www.zoopla.co.uk/house-prices/london/barton-street/sw1a-0aa/', false], // neighbouring postcode
    ['https://www.zoopla.co.uk/house-prices/london/sw1p/', false], // district page
    ['https://www.zoopla.co.uk/house-prices/', false],
    ['https://www.zoopla.co.uk/search/?q=sw1p-3ng', false],
    ['https://evil.example.com/house-prices/sw1p-3ng/', false],
    ['not a url', false],
  ])('%s -> %p', (url, expected) => {
    expect(isHousePricesUrlFor(url, 'sw1p 3ng')).toBe(expected);
  });
});

describe('canonicalHousePricesUrl', () => {
  it('drops pagination and tracking params, forces list view', () => {
    expect(
      canonicalHousePricesUrl(
        'https://www.zoopla.co.uk/house-prices/london/barton-street/sw1p-3ng/?new_homes=include&q=sw1p+3ng&pn=2&search_source=home#top',
      ),
    ).toBe('https://www.zoopla.co.uk/house-prices/london/barton-street/sw1p-3ng/?new_homes=include&q=sw1p+3ng&view_type=list');
  });
});
