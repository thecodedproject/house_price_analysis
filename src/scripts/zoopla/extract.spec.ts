/**
 * The first tests use small synthetic pages; the later ones use trimmed real pages in
 * __fixtures__/. NEVER copy pages from data/raw/ into __fixtures__/: real fixtures may
 * only be Westminster properties near the Houses of Parliament - see AGENTS.md.
 */
import {
  parseRscRows,
  dedupeHistory,
  detailsFromJson,
  detailsFromText,
  extractHousePricesResults,
  sqftToSqm,
  extractImageUrls,
  extractListingIds,
  extractListingPage,
  extractPropertyPage,
  extractUprnLinks,
  historyFromText,
  isChallengePage,
  parseLooseDate,
  parsePrice,
} from './extract';

describe('primitives', () => {
  it('parsePrice', () => {
    expect(parsePrice('£650,000')).toBe(650000);
    expect(parsePrice('£1.2m')).toBe(1200000);
    expect(parsePrice(425000)).toBe(425000);
    expect(parsePrice('POA')).toBeUndefined();
  });

  it('parseLooseDate', () => {
    expect(parseLooseDate('Mar 2024')).toEqual({ date: '2024-03', precision: 'month' });
    expect(parseLooseDate('September 2021')).toEqual({ date: '2021-09', precision: 'month' });
    expect(parseLooseDate('15th Mar 2024')).toEqual({ date: '2024-03-15', precision: 'day' });
    expect(parseLooseDate('2024-03-15T00:00:00Z')).toEqual({ date: '2024-03-15', precision: 'day' });
    expect(parseLooseDate('soon')).toBeUndefined();
  });

  it('isChallengePage', () => {
    expect(isChallengePage('<html><head><title>Just a moment...</title>')).toBe(true);
    expect(isChallengePage('<html><head><title>12 Barton Street</title>')).toBe(false);
  });
});

describe('house prices page', () => {
  it('collects unique UPRNs', () => {
    const html = `<a href="/property/uprn/6001/">12</a><a href="/property/uprn/6002/">14</a><a href="https://www.zoopla.co.uk/property/uprn/6001/">again</a>`;
    expect(extractUprnLinks(html)).toEqual(['6001', '6002']);
  });
});

describe('property page', () => {
  const nextData = {
    props: {
      pageProps: {
        property: {
          attributes: { bedrooms: 3, bathrooms: 1, livingRooms: 2, floorArea: { value: 92, unitsLabel: 'sq. metres', units: 'sq_metres' } },
          history: [
            { eventType: 'Sold', date: '2019-06-14', price: 610000 },
            { eventType: 'Listed for sale', date: 'Jan 2024', priceValue: 725000 },
            { eventType: 'Price reduced', date: 'Mar 2024', priceValue: 699950 },
          ],
        },
      },
    },
  };
  const html = `<html><head><title>12 Barton Street - Zoopla</title></head><body>
    <h1>12 Barton Street, London SW1P 3NG</h1>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
    <div>Property history</div>
    <div>Listed for sale <span>£725,000</span> <span>Jan 2024</span></div>
    <a href="/for-sale/details/66012345/">current listing</a>
    <a href="/to-rent/details/55000111/">old rental</a>
  </body></html>`;

  const page = extractPropertyPage(html, 'https://www.zoopla.co.uk/property/uprn/6001/');

  it('gets uprn, address and details', () => {
    expect(page.uprn).toBe('6001');
    expect(page.address).toBe('12 Barton Street, London SW1P 3NG');
    expect(page.bedrooms).toBe(3);
    expect(page.bathrooms).toBe(1);
    expect(page.receptions).toBe(2);
    expect(page.floorAreaSqm).toBe(92);
  });

  it('gets deduplicated history from JSON and text', () => {
    expect(page.history).toEqual([
      { kind: 'sale', label: 'Sold', date: '2019-06-14', datePrecision: 'day', price: 610000 },
      { kind: 'listing', listingType: 'sale', label: 'Listed for sale', date: '2024-01', datePrecision: 'month', price: 725000 },
      { kind: 'listing', listingType: 'sale', label: 'Price reduced', date: '2024-03', datePrecision: 'month', price: 699950 },
    ]);
  });

  it('finds linked listings', () => {
    expect(page.listings).toEqual([
      { id: '66012345', listingType: 'sale', url: 'https://www.zoopla.co.uk/for-sale/details/66012345/' },
      { id: '55000111', listingType: 'rent', url: 'https://www.zoopla.co.uk/to-rent/details/55000111/' },
    ]);
    expect(extractListingIds('')).toEqual([]);
  });
});

describe('text fallback', () => {
  it('reads history lines from page text', () => {
    const events = historyFromText('Sold £610,000 Jun 2019\nPrice reduced to £699,950 Mar 2024');
    expect(dedupeHistory(events).map((e) => [e.kind, e.date, e.price])).toEqual([
      ['sale', '2019-06', 610000],
      ['listing', '2024-03', 699950],
    ]);
  });
});

describe('listing page', () => {
  const ld = {
    '@type': 'Product',
    offers: { price: 699950, priceCurrency: 'GBP' },
  };
  const html = `<html><head>
    <meta property="og:title" content="3 bed terraced house for sale in Barton Street, London SW1P - &pound;699,950" />
    <meta property="og:description" content="A charming Victorian terrace, recently renovated." />
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
    </head><body>
    <img src="https://lid.zoocdn.com/645/430/abc123.jpg" />
    <img src="https://lid.zoocdn.com/u/1024/768/abc123.jpg" />
    <script>self.__next_f.push([1,"5:{\\"features\\":[\\"Garden\\",\\"Loft conversion\\"],\\"img\\":\\"https:\\\\/\\\\/lid.zoocdn.com\\\\/1024\\\\/768\\\\/def456.jpg\\"}\\n"])</script>
    </body></html>`;

  const lp = extractListingPage(html, 'https://www.zoopla.co.uk/for-sale/details/66012345/');

  it('gets price, details and features', () => {
    expect(lp).toMatchObject({
      listingId: '66012345',
      listingType: 'sale',
      price: 699950,
      bedrooms: 3,
      description: 'A charming Victorian terrace, recently renovated.',
      features: ['Garden', 'Loft conversion'],
    });
  });

  it('keeps the largest variant of each image', () => {
    expect(lp.imageUrls.sort()).toEqual([
      'https://lid.zoocdn.com/1024/768/def456.jpg',
      'https://lid.zoocdn.com/u/1024/768/abc123.jpg',
    ]);
    expect(extractImageUrls('')).toEqual([]);
  });
});

// The real-page fixtures below are trimmed Zoopla pages for Westminster properties near the
// Houses of Parliament (SW1P 3BU). See AGENTS.md: fixtures must never come from anywhere else.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = (name: string): string => require('fs').readFileSync(require('path').join(__dirname, '__fixtures__', name), 'utf8');

describe('house prices results (real page structure)', () => {
  const html = fixture('house_prices_sw1p3bu.html');

  it('reads structured rows, keeping floor area in m²', () => {
    const parsed = extractHousePricesResults(html);
    expect(parsed?.hasNextPage).toBe(false);
    expect(parsed?.results).toEqual([
      {
        uprn: '10033626957',
        address: 'Second Floor and Third Floor Maisonette, 40 Great Smith Street, London, SW1P 3BU',
        postcode: 'SW1P 3BU',
        latitude: 51.4971783,
        longitude: -0.1296165,
        propertyType: 'Semi-Detached House',
        tenure: 'Leasehold',
        bedrooms: 1,
        bathrooms: 2,
        receptions: 1,
        floorAreaSqm: 93,
        lastSale: { date: '2020-12-01', price: 2550000 },
      },
      expect.objectContaining({ uprn: '100022757796', address: 'Flat 3, 42 Great Smith Street, London, SW1P 3BU', floorAreaSqm: 126 }),
    ]);
  });

  it('returns undefined for pages without results data', () => {
    expect(extractHousePricesResults('<html><title>Just a moment...</title></html>')).toBeUndefined();
  });
});

describe('floor area units', () => {
  it('converts sq ft to m² and keeps m² as is', () => {
    expect(sqftToSqm(1076)).toBe(100);
    expect(detailsFromText('Approx. 1,076 sq ft').floorAreaSqm).toBe(100);
    expect(detailsFromText('92 sq. m').floorAreaSqm).toBe(92);
    expect(detailsFromJson([{ floorSize: { value: 1076, unitCode: 'FTK' } }]).floorAreaSqm).toBe(100);
    expect(detailsFromJson([{ floorAreaSqFt: 1076 }]).floorAreaSqm).toBe(100);
    expect(detailsFromJson([{ floorArea: { value: 1076, unitsLabel: 'sq. ft' } }]).floorAreaSqm).toBe(100);
  });
});

describe('property page (real page structure)', () => {
  const page = extractPropertyPage(fixture('property_200002813096.html'), 'https://www.zoopla.co.uk/property/uprn/200002813096/');

  it('reads historicSales with correctly paired dates and prices', () => {
    expect(page.history.map((e) => [e.kind, e.date, e.price])).toEqual([
      ['sale', '2000-12-04', 219200],
      ['sale', '2011-12-20', 500000],
    ]);
  });

  it('reads address and attributes', () => {
    expect(page).toMatchObject({ uprn: '200002813096', address: 'Flat 2, 28 Great Smith Street, London, SW1P 3BU', bedrooms: 1, receptions: 1, floorAreaSqm: 56 });
  });

  it("ignores listing links that aren't part of this property's data", () => {
    expect(page.listings).toEqual([]);
  });
});

describe('timeline text fallback (real layout)', () => {
  it('pairs each row with its own date and price, ignoring change amounts', () => {
    const text = [
      'Property timeline',
      'Sold', 'December 2011', '£500,000', '+£280,800 (128%)',
      'Sold', 'December 2000', '£219,200',
      'Zoopla insights',
    ].join('\n');
    expect(historyFromText(text).map((e) => [e.date, e.price])).toEqual([
      ['2011-12', 500000],
      ['2000-12', 219200],
    ]);
  });
});

describe('RSC payload parsing', () => {
  it('reads byte-length text rows that run straight into the next row', () => {
    const text = 'Café – £900k'; // multi-byte characters: length is in UTF-8 bytes
    const len = new TextEncoder().encode(text).length.toString(16);
    const rows = parseRscRows(`1:T${len},${text}2:{"description":"$1","n":1}\n3:["$","div",null,{}]\n`);
    expect(rows.text.get('1')).toBe(text);
    expect(rows.json.get('2')).toEqual({ description: '$1', n: 1 });
    expect(rows.json.has('3')).toBe(true);
  });
});

describe('archived listing page (real page structure)', () => {
  const HISTORY = 'https://www.zoopla.co.uk/property-history/flat-3/42-great-smith-street/london/sw1p-3bu/';

  it('reads ListingData, with floor area given in sq ft and HTML entities in features', () => {
    const lp = extractListingPage(fixture('listing_39308585.html'), `${HISTORY}39308585`);
    expect(lp).toMatchObject({
      listingId: '39308585',
      listingType: 'sale',
      price: 1200000,
      title: '2 bed flat for sale',
      agent: 'Garton Jones - Westminster & Victoria',
      publishedOn: '2016-01-26',
      bedrooms: 2,
      bathrooms: 2,
      receptions: 1,
      floorAreaSqm: 125.9, // 1,355 sq ft
    });
    expect(lp.description).toMatch(/^A very spacious 2 double bedroom apartment/);
    expect(lp.features).toContain('Close to Local Shops & Restaurants');
    expect(lp.imageUrls).toHaveLength(14);
    expect(lp.imageUrls[0]).toBe('https://lid.zoocdn.com/u/1024/768/e016871d5468dc4fbf314f9bdf67a89b325136a0.jpg');
    expect(lp.floorplanUrls).toEqual(['https://lid.zoocdn.com/u/1024/768/193dcf6dbe9bbbcbdcce46b88b6596559bc25ed6.jpg']);
  });

  it('reads status, tags and EPC', () => {
    const lp = extractListingPage(fixture('listing_72560879.html'), 'https://www.zoopla.co.uk/property-history/flat-4/42-great-smith-street/london/sw1p-3bu/72560879');
    expect(lp).toMatchObject({
      listingId: '72560879',
      price: 995000,
      tags: ['Leasehold'],
      status: 'Sold subject to contract',
      agent: 'Prime Portfolio',
      epcRating: 'B',
      publishedOn: '2026-03-03',
      floorAreaSqm: 135.4,
    });
    expect(lp.imageUrls).toHaveLength(10);
    expect(lp.floorplanUrls).toEqual(['https://lid.zoocdn.com/u/1024/768/88a2b3ab1459e26e3ce298f2d956a62b3afb1293.png']);
  });
});

describe('property page with listing history (real page structure)', () => {
  const page = extractPropertyPage(fixture('property_100022757796.html'));

  it('gives each listing its own snapshot, media and archive URL', () => {
    const listings = page.history.filter((e) => e.kind === 'listing');
    expect(listings.map((e) => [e.date, e.price, e.listing?.id, e.listing?.bedrooms, e.listing?.imageUrls.length, e.listing?.floorplanUrls.length])).toEqual([
      ['2016-01-26', 1200000, '39308585', 2, 14, 1],
      ['2016-10-10', 1200000, '41880197', 2, 14, 1],
      ['2017-01-17', 1200000, '42692545', 2, 14, 1],
    ]);
    expect(page.history.filter((e) => e.kind === 'sale').map((e) => [e.date, e.price])).toEqual([['2017-04-19', 1050000]]);
    expect(page.listings.map((l) => l.url)).toContain('https://www.zoopla.co.uk/property-history/flat-3/42-great-smith-street/london/sw1p-3bu/39308585');
  });
});
