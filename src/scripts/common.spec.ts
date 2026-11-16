import { AreaFile, loadArea, withZooplaUrl } from './common';

const URL_A = 'https://www.zoopla.co.uk/house-prices/london/barton-street/sw1p-3ng/?view_type=list';

describe('withZooplaUrl', () => {
  it('upgrades a plain string entry, matching postcodes loosely', () => {
    const file: AreaFile = { postcodes: ['sw1p3ng', 'SW1A 0AA'] };
    const { file: out, changed } = withZooplaUrl(file, 'SW1P 3NG', URL_A);
    expect(changed).toBe(true);
    expect(out.postcodes).toEqual([{ postcode: 'sw1p3ng', zooplaUrl: URL_A }, 'SW1A 0AA']);
    expect(file.postcodes[0]).toBe('sw1p3ng'); // input not mutated
  });

  it('fills an object entry missing the url and keeps other fields', () => {
    const file: AreaFile = { note: 'mine', postcodes: [{ postcode: 'SW1P 3NG' }] };
    const { file: out, changed } = withZooplaUrl(file, 'SW1P 3NG', URL_A);
    expect(changed).toBe(true);
    expect(out).toEqual({ note: 'mine', postcodes: [{ postcode: 'SW1P 3NG', zooplaUrl: URL_A }] });
  });

  it('never overwrites an existing url', () => {
    const file: AreaFile = { postcodes: [{ postcode: 'SW1P 3NG', zooplaUrl: 'https://hand-edited' }] };
    expect(withZooplaUrl(file, 'SW1P 3NG', URL_A)).toEqual({ file, changed: false });
  });

  it('does not add unconfigured postcodes', () => {
    const file: AreaFile = { postcodes: ['SW1A 0AA'] };
    expect(withZooplaUrl(file, 'SW1P 3NG', URL_A).changed).toBe(false);
  });

  it('round-trips through loadArea', () => {
    const { file } = withZooplaUrl({ postcodes: ['sw1p3ng'] }, 'SW1P 3NG', URL_A);
    expect(loadArea(file)).toEqual([{ postcode: 'SW1P 3NG', zooplaUrl: URL_A }]);
  });
});

describe('loadArea', () => {
  it('drops duplicate postcodes (however they are written) with a warning', () => {
    const warnings: string[] = [];
    const area = loadArea({ postcodes: ['SW1P 3BU', { postcode: 'sw1p3bu', zooplaUrl: 'u' }, 'SW1P 3LA'] }, (m) => warnings.push(m));
    expect(area).toEqual([{ postcode: 'SW1P 3BU', zooplaUrl: 'u' }, { postcode: 'SW1P 3LA' }]);
    expect(warnings).toEqual(['config/area.json lists SW1P 3BU more than once; using the first entry']);
  });
});
