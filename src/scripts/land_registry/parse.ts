import { normalisePostcode, propertyId } from '../../shared/ids';
import { Upsert } from '../../shared/db';
import { Property, PropertyType, Sale, Tenure } from '../../shared/types';

/** One row of the PPD CSV download (`/app/ppd/ppd_data.csv?...&header=true`). */
export interface LandRegistryRecord {
  unique_id: string;
  price_paid: string;
  deed_date: string;
  postcode: string;
  property_type: string;
  new_build: string;
  estate_type: string;
  saon: string;
  paon: string;
  street: string;
  locality: string;
  town: string;
  district: string;
  county: string;
  transaction_category: string;
  linked_data_uri: string;
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function parsePpdCsv(text: string): LandRegistryRecord[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || !header.includes('unique_id')) {
    throw new Error(`Unexpected PPD CSV header: ${header?.join(',')}`);
  }
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as unknown as LandRegistryRecord);
}

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

export function toProperty(r: LandRegistryRecord): Upsert<Property> {
  const address = { postcode: r.postcode, street: r.street, paon: r.paon, saon: opt(r.saon) };
  return {
    id: propertyId(address),
    postcode: normalisePostcode(r.postcode),
    paon: r.paon.trim(),
    saon: opt(r.saon),
    street: r.street.trim(),
    locality: opt(r.locality),
    town: opt(r.town),
    district: opt(r.district),
    county: opt(r.county),
    propertyType: (opt(r.property_type) as PropertyType) ?? undefined,
    tenure: (opt(r.estate_type) as Tenure) ?? undefined,
  };
}

export function toSale(r: LandRegistryRecord, propId: string): Upsert<Sale> {
  return {
    id: r.unique_id,
    propertyId: propId,
    date: r.deed_date,
    price: Number(r.price_paid),
    status: 'final',
    source: 'land_registry',
    newBuild: r.new_build === 'Y',
    ppdCategory: r.transaction_category === 'B' ? 'B' : 'A',
    propertyType: (opt(r.property_type) as PropertyType) ?? undefined,
    tenure: (opt(r.estate_type) as Tenure) ?? undefined,
  };
}

/**
 * One Property per address from all its records: later sales win for fields that differ
 * (e.g. property type after a conversion), and blanks never override a known value.
 */
export function toProperties(records: LandRegistryRecord[]): Upsert<Property>[] {
  const byId = new Map<string, Upsert<Property>>();
  const sorted = [...records].sort((a, b) => a.deed_date.localeCompare(b.deed_date));
  for (const r of sorted) {
    const p = toProperty(r);
    const prev = byId.get(p.id);
    byId.set(p.id, prev ? { ...prev, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } : p);
  }
  return [...byId.values()];
}
