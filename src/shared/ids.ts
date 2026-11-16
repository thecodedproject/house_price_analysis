/**
 * ID generation and address normalisation. Matching Land Registry and Zoopla records
 * depends entirely on these producing identical output for the same address.
 */

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

/** "sw1p  3ng" -> "SW1P 3NG". Returns the trimmed upper-cased input if it isn't a full postcode. */
export function normalisePostcode(postcode: string): string {
  const compact = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = compact.replace(/\s/g, '').match(POSTCODE_RE);
  return m ? `${m[1]} ${m[2]}` : compact;
}

/** "SW1P 3NG" -> "SW1P3NG" */
export function postcodeKey(postcode: string): string {
  return normalisePostcode(postcode).replace(/\s/g, '');
}

/** "sw1p 3ng" -> "sw1p-3ng" (Zoopla URL style) */
export function postcodeSlug(postcode: string): string {
  return normalisePostcode(postcode).toLowerCase().replace(/\s/g, '-');
}

/** Lower-case, `&` -> and, anything non-alphanumeric -> single underscore. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Only applied to the final word of a street name, so "St Johns Road" keeps its "St".
const STREET_SUFFIXES: Record<string, string> = {
  rd: 'road',
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  ln: 'lane',
  cl: 'close',
  gdns: 'gardens',
  gdn: 'garden',
  sq: 'square',
  ter: 'terrace',
  terr: 'terrace',
  cres: 'crescent',
  pl: 'place',
  dr: 'drive',
  ct: 'court',
  gr: 'grove',
  pk: 'park',
};

export function normaliseStreet(street: string): string {
  const parts = slug(street).split('_').filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    parts[parts.length - 1] = STREET_SUFFIXES[last] ?? last;
  }
  return parts.join('_');
}

/** "12" / "12A" / "Rose Cottage" -> slug */
export function normalisePaon(paon: string): string {
  return slug(paon);
}

/** "FLAT A" / "Apartment a" / "Flat a," -> "flat_a"; "FIRST FLOOR FLAT" -> "first_floor_flat" */
export function normaliseSaon(saon: string): string {
  return slug(saon).replace(/^(apartment|apt|unit)_/, 'flat_');
}

export interface AddressParts {
  postcode: string;
  street: string;
  paon: string;
  saon?: string;
}

export function propertyId(a: AddressParts): string {
  const parts = [postcodeKey(a.postcode), normaliseStreet(a.street), normalisePaon(a.paon)];
  if (a.saon && a.saon.trim()) parts.push(normaliseSaon(a.saon));
  return parts.join('_');
}

/** Month precision part of a date: "2024-03-15" -> "2024-03" */
export function yearMonth(date: string): string {
  return date.slice(0, 7);
}

export function listingId(
  propId: string,
  listingType: 'sale' | 'rent',
  date: string,
  price: number,
): string {
  return `${propId}_${listingType}_${yearMonth(date)}_${price}`;
}

export function zooplaSaleId(propId: string, date: string): string {
  return `zoopla_${propId}_${yearMonth(date)}`;
}

/**
 * Best-effort split of a free-text address (as Zoopla gives them) into PAON/SAON/street.
 *
 *   "Flat A, 12 Barton Street, London SW1P 3NG" -> { saon: "Flat A", paon: "12", street: "Barton Street" }
 *   "12a Barton Street, London, SW1P 3NG"       -> { paon: "12a", street: "Barton Street" }
 *   "Rose Cottage, Barton Street, London"     -> { paon: "Rose Cottage", street: "Barton Street" }
 *
 * Returns undefined if no street could be identified.
 */
export function parseFreeAddress(
  address: string,
  postcode?: string,
): Omit<AddressParts, 'postcode'> | undefined {
  let text = address.replace(/\s+/g, ' ').trim();
  // strip the postcode (given or any trailing full postcode)
  if (postcode) {
    const pc = normalisePostcode(postcode);
    text = text.replace(new RegExp(pc.replace(' ', '\\s*'), 'i'), '');
  }
  text = text.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '');

  const segments = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return undefined;

  // Find the first segment of the form "<number><letter?> <street words>"
  const numberedStreet = /^(\d+[A-Z]?(?:\s*-\s*\d+[A-Z]?)?)\s+(.+)$/i;
  for (let i = 0; i < segments.length; i++) {
    const m = segments[i].match(numberedStreet);
    if (m) {
      const before = segments.slice(0, i).join(', ');
      return { paon: m[1].replace(/\s/g, ''), street: m[2], saon: before || undefined };
    }
  }

  // Named house: "Rose Cottage, Barton Street, London"
  if (segments.length >= 2) {
    return { paon: segments[0], street: segments[1] };
  }
  return undefined;
}
