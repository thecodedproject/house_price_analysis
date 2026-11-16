/**
 * Pure HTML -> data extraction for Zoopla pages. No browser dependency, so it can be unit
 * tested and re-run over saved pages in data/raw/zoopla/.
 *
 * Zoopla's markup changes often, so extraction is layered:
 *   1. embedded JSON (Next.js `__NEXT_DATA__`, RSC `self.__next_f.push` chunks, ld+json),
 *      walked heuristically for known-looking keys;
 *   2. regexes over the visible page text as a fallback.
 * When something isn't picked up, inspect the saved raw HTML and tighten the rules here.
 */

import { ZOOPLA } from './urls';

export interface HistoryEvent {
  kind: 'sale' | 'listing';
  listingType?: 'sale' | 'rent';
  /** Raw event label, e.g. "Sold", "Listed for sale", "Price reduced" */
  label: string;
  /** `yyyy-mm` or `yyyy-mm-dd` */
  date: string;
  datePrecision: 'month' | 'day';
  price: number;
  /** For listings that came with their own snapshot (property page `historicListings`) */
  listing?: ListingRef & PropertyDetails & { imageUrls: string[]; floorplanUrls: string[] };
}

/** A Zoopla listing we can visit: a live `/for-sale/details/<id>/` or archived `/property-history/.../<id>/` page */
export interface ListingRef {
  id: string;
  listingType: 'sale' | 'rent';
  url: string;
}

export interface PropertyDetails {
  bedrooms?: number;
  bathrooms?: number;
  receptions?: number;
  floorAreaSqm?: number;
}

export interface PropertyPage extends PropertyDetails {
  uprn?: string;
  address?: string;
  history: HistoryEvent[];
  listings: ListingRef[];
}

export interface ListingPage extends PropertyDetails {
  listingId?: string;
  listingType?: 'sale' | 'rent';
  price?: number;
  title?: string;
  /** Plain text (HTML stripped) */
  description?: string;
  features: string[];
  /** e.g. "Chain free", "Freehold" */
  tags: string[];
  /** e.g. "Sold subject to contract" */
  status?: string;
  agent?: string;
  epcRating?: string;
  /** `yyyy-mm-dd` */
  publishedOn?: string;
  /** Absolute image URLs, largest variant of each */
  imageUrls: string[];
  floorplanUrls: string[];
}

// ---------------------------------------------------------------- generic helpers

export function isChallengePage(html: string): boolean {
  return /<title>\s*(Just a moment|Attention Required)/i.test(html) || /_cf_chl_opt/.test(html);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', pound: '£' };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}

/** Visible-ish text: scripts/styles removed, tags turned into line breaks. */
export function pageText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|section|article|span)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n');
}

export function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decodeEntities(v) : undefined;
}

export function parsePrice(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v !== 'string') return undefined;
  const m = v.replace(/,/g, '').match(/£?\s*(\d+(?:\.\d+)?)\s*(k|m)?/i);
  if (!m) return undefined;
  const mult = m[2]?.toLowerCase() === 'm' ? 1e6 : m[2]?.toLowerCase() === 'k' ? 1e3 : 1;
  return Math.round(Number(m[1]) * mult);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Mar 2024" | "March 2024" | "15th Mar 2024" | "2024-03-15" | "2024-03" -> date + precision */
export function parseLooseDate(v: unknown): { date: string; precision: 'month' | 'day' } | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) return m[3] ? { date: `${m[1]}-${m[2]}-${m[3]}`, precision: 'day' } : { date: `${m[1]}-${m[2]}`, precision: 'month' };
  m = s.match(/(?:(?<![\d,.])(\d{1,2})(?:st|nd|rd|th)?\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi < 0) return undefined;
    const mm = String(mi + 1).padStart(2, '0');
    return m[1]
      ? { date: `${m[3]}-${mm}-${m[1].padStart(2, '0')}`, precision: 'day' }
      : { date: `${m[3]}-${mm}`, precision: 'month' };
  }
  return undefined;
}

// ---------------------------------------------------------------- embedded JSON

/** All JSON blobs we can find in the page. */
export function extractEmbeddedJson(html: string): unknown[] {
  const out: unknown[] = [];
  const tryParse = (s: string) => {
    try {
      out.push(JSON.parse(s));
    } catch {
      /* ignore */
    }
  };

  for (const m of html.matchAll(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) tryParse(m[1]);
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) tryParse(m[1]);

  // Next.js app-router RSC payload: self.__next_f.push([1,"<js string>"])
  let rsc = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      rsc += JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  if (rsc) {
    const rows = parseRscRows(rsc);
    for (const value of rows.json.values()) out.push(resolveRscText(value, rows.text));
  }
  return out;
}

export interface RscRows {
  json: Map<string, unknown>;
  text: Map<string, string>;
}

/**
 * Parse a React Server Components payload. Rows are `<id>:<json>\n`, except text rows,
 * `<id>:T<hex byte length>,<text>`, which have no terminator - the next row starts
 * immediately after `length` UTF-8 bytes. Unparseable rows (I/HL/... directives) are skipped.
 */
export function parseRscRows(rsc: string): RscRows {
  const bytes = new TextEncoder().encode(rsc);
  const decoder = new TextDecoder();
  const json = new Map<string, unknown>();
  const text = new Map<string, string>();
  let pos = 0;
  const COLON = 0x3a;
  const NEWLINE = 0x0a;
  while (pos < bytes.length) {
    const colon = bytes.indexOf(COLON, pos);
    if (colon < 0) break;
    const id = decoder.decode(bytes.subarray(pos, colon));
    if (!/^[0-9a-z]+$/i.test(id)) {
      // not at a row boundary (shouldn't happen) - resync at the next newline
      const nl = bytes.indexOf(NEWLINE, pos);
      if (nl < 0) break;
      pos = nl + 1;
      continue;
    }
    if (bytes[colon + 1] === 0x54 /* T */) {
      const comma = bytes.indexOf(0x2c, colon);
      const len = parseInt(decoder.decode(bytes.subarray(colon + 2, comma)), 16);
      if (Number.isNaN(len)) break;
      text.set(id, decoder.decode(bytes.subarray(comma + 1, comma + 1 + len)));
      pos = comma + 1 + len;
      continue;
    }
    let end = bytes.indexOf(NEWLINE, colon);
    if (end < 0) end = bytes.length;
    const body = decoder.decode(bytes.subarray(colon + 1, end));
    if (body.startsWith('{') || body.startsWith('[')) {
      try {
        json.set(id, JSON.parse(body));
      } catch {
        /* ignore */
      }
    }
    pos = end + 1;
  }
  return { json, text };
}

/** Replace `"$<id>"` references to text rows with the text itself. */
function resolveRscText(value: unknown, text: Map<string, string>, depth = 0): unknown {
  if (depth > 80) return value;
  if (typeof value === 'string') {
    const m = value.match(/^\$([0-9a-z]+)$/i);
    return m && text.has(m[1]) ? text.get(m[1]) : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRscText(v, text, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRscText(v, text, depth + 1)]));
  }
  return value;
}

export function walk(value: unknown, visit: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 60 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit, depth + 1);
    return;
  }
  visit(value as Record<string, unknown>);
  for (const v of Object.values(value)) walk(v, visit, depth + 1);
}

const DETAIL_KEYS: [keyof PropertyDetails, RegExp][] = [
  ['bedrooms', /^(num_?)?bed(room)?s$|^numberOfBedrooms$/i],
  ['bathrooms', /^(num_?)?bath(room)?s$|^numberOfBathroomsTotal$/i],
  ['receptions', /^(num_?)?(reception|living)(room)?s$/i],
];

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  if (v && typeof v === 'object' && 'value' in v) return toNumber((v as { value: unknown }).value);
  return undefined;
}

function floorAreaFrom(obj: Record<string, unknown>): number | undefined {
  for (const [k, v] of Object.entries(obj)) {
    if (!/floor_?area|floorSize|internal_?area/i.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const value = toNumber(o.value ?? o.size ?? o.amount);
      // ld+json uses unitCode MTK (m²) / FTK (ft²); Zoopla uses e.g. units "sq_metres" / "sq_feet" or unitsLabel "sq. ft"
      const unit = String(o.unitText ?? o.unitCode ?? o.units ?? o.unitsLabel ?? o.unit ?? '').toLowerCase();
      if (value) return /ft|feet|foot/.test(unit) ? sqftToSqm(value) : round1(value);
    }
    const n = toNumber(v);
    // a bare number: the unit is in the key name, e.g. Zoopla's `floorAreaSqM`; assume m² otherwise
    if (n) return /sq_?f(ee)?t|ft2$/i.test(k) ? sqftToSqm(n) : round1(n);
  }
  return undefined;
}

const SQFT_PER_SQM = 10.7639;
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Floor areas are stored in square metres, to 1 decimal place. */
export const sqftToSqm = (sqft: number) => round1(sqft / SQFT_PER_SQM);

export function detailsFromJson(blobs: unknown[]): PropertyDetails {
  const d: PropertyDetails = {};
  for (const blob of blobs) {
    walk(blob, (obj) => {
      for (const [field, re] of DETAIL_KEYS) {
        if (d[field] !== undefined) continue;
        for (const [k, v] of Object.entries(obj)) {
          const n = re.test(k) ? toNumber(v) : undefined;
          if (n !== undefined && n >= 0 && n < 50) {
            d[field] = n;
            break;
          }
        }
      }
      if (d.floorAreaSqm === undefined) d.floorAreaSqm = floorAreaFrom(obj);
    });
  }
  return d;
}

export function detailsFromText(text: string): PropertyDetails {
  const num = (re: RegExp) => {
    const m = text.match(re);
    return m ? Number(m[1].replace(/,/g, '')) : undefined;
  };
  const sqft = num(/([\d,]+)\s*sq\.?\s*ft/i);
  const sqm = num(/([\d,.]+)\s*(?:sq\.?\s*m|m²)/i);
  return {
    bedrooms: num(/(\d+)\s*bed(?:room)?s?\b/i),
    bathrooms: num(/(\d+)\s*bath(?:room)?s?\b/i),
    receptions: num(/(\d+)\s*reception(?:\s*room)?s?\b/i),
    floorAreaSqm: sqm !== undefined ? round1(sqm) : sqft !== undefined ? sqftToSqm(sqft) : undefined,
  };
}

function mergeDetails(a: PropertyDetails, b: PropertyDetails): PropertyDetails {
  return {
    bedrooms: a.bedrooms ?? b.bedrooms,
    bathrooms: a.bathrooms ?? b.bathrooms,
    receptions: a.receptions ?? b.receptions,
    floorAreaSqm: a.floorAreaSqm ?? b.floorAreaSqm,
  };
}

// ---------------------------------------------------------------- history

function classify(label: string): Pick<HistoryEvent, 'kind' | 'listingType'> | undefined {
  const l = label.toLowerCase();
  if (/\bsold\b|sale_?completed|^sale$/.test(l)) return { kind: 'sale' };
  if (/rent|let\b|to_let/.test(l)) return { kind: 'listing', listingType: 'rent' };
  if (/listed|reduc|increase|for.?sale|price.?change|marketed|added/.test(l)) return { kind: 'listing', listingType: 'sale' };
  return undefined;
}

const PRICE_KEYS = ['price', 'priceValue', 'amount', 'salePrice', 'soldPrice', 'askingPrice', 'value'];
const DATE_KEYS = ['date', 'eventDate', 'saleDate', 'dateSold', 'soldDate', 'listingDate', 'firstPublishedDate', 'publishedOn', 'datetime'];
const LABEL_KEYS = ['eventType', 'event', 'type', 'title', 'label', 'description', 'status', 'transactionType'];

export function historyFromJson(blobs: unknown[]): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  for (const blob of blobs) {
    walk(blob, (obj) => {
      const price = PRICE_KEYS.map((k) => parsePrice(obj[k])).find((p) => p !== undefined && p > 1000);
      if (price === undefined) return;
      const d = DATE_KEYS.map((k) => parseLooseDate(obj[k])).find(Boolean);
      if (!d) return;
      const label = LABEL_KEYS.map((k) => obj[k]).find((v) => typeof v === 'string') as string | undefined;
      const c = label ? classify(label) : undefined;
      if (!c || !label) return;
      events.push({ ...c, label, date: d.date, datePrecision: d.precision, price });
    });
  }
  return events;
}

const TEXT_LABEL_RE = /^(Sold|Listed for sale|Listed to rent|Price reduced|Price increased|Reduced|Added)\b/i;
const TEXT_PRICE_RE = /^£[\d,]+(?:\.\d+)?[km]?\b/i;
const TEXT_DATE_RE = /(?:(?<![\d,.])\d{1,2}(?:st|nd|rd|th)?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}/i;

/**
 * Fallback for when there's no structured data: the page's timeline rows, e.g.
 * `Sold | May 2025 | £635,000 | +£90,000 (17%)`. Each label line starts a row; its date and
 * price are taken from the following few lines, never crossing into the next row.
 * (Change amounts like "+£90,000" don't count as prices because they don't start with £.)
 */
export function historyFromText(text: string): HistoryEvent[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const events: HistoryEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].match(TEXT_LABEL_RE)?.[1];
    const c = label ? classify(label) : undefined;
    if (!label || !c) continue;
    let date: ReturnType<typeof parseLooseDate>;
    let price: number | undefined;
    // the label line itself may hold the rest of the row ("Sold £610,000 Jun 2019")
    const rest = [lines[i].slice(label.length), ...lines.slice(i + 1, i + 4)];
    for (const [j, line] of rest.entries()) {
      if (j > 0 && TEXT_LABEL_RE.test(line)) break;
      date ??= parseLooseDate(line.match(TEXT_DATE_RE)?.[0]);
      price ??= parsePrice(line.match(TEXT_PRICE_RE)?.[0] ?? line.match(/(?:^|\s)(£[\d,]+(?:\.\d+)?[km]?)/i)?.[1]);
    }
    if (date && price) events.push({ ...c, label, date: date.date, datePrecision: date.precision, price });
  }
  return events;
}

/** The `property` object of a property page's `__NEXT_DATA__` (has `history.historicSales`). */
function findPropertyObject(blobs: unknown[]): Record<string, any> | undefined {
  let found: Record<string, any> | undefined;
  for (const blob of blobs) {
    walk(blob, (obj) => {
      const h = obj.history as Record<string, unknown> | undefined;
      if (!found && h && typeof h === 'object' && (Array.isArray(h.historicSales) || Array.isArray(h.historicListings))) {
        found = obj;
      }
    });
    if (found) break;
  }
  return found;
}

/** Full-size Zoopla image URL for a bare filename (as used in `ListingData.propertyImage`). */
export function zoocdnUrl(filename: string): string {
  return `https://lid.zoocdn.com/u/1024/768/${filename}`;
}

/** `[{thumbnail, medium, large}]` or `[{filename}]` -> largest URLs */
function mediaUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => {
      if (typeof m === 'string') return m;
      const o = (m ?? {}) as Record<string, unknown>;
      const url = o.original ?? o.large ?? o.medium ?? o.url ?? (typeof o.filename === 'string' ? zoocdnUrl(o.filename) : undefined);
      return typeof url === 'string' ? url : undefined;
    })
    .filter((u): u is string => !!u);
}

/**
 * A `historicListings` / `liveListings` item. Seen shape (historic):
 * `{ date, price, priceType, attributes: {bedrooms, bathrooms, livingRooms}, images: [{thumbnail, medium, large}], floorplans: [...], uri: "/property-history/<addr>/<listingId>" }`.
 * Other keys are read generically in case live listings differ.
 */
function listingEventFrom(item: Record<string, unknown>, fallbackLabel: string): HistoryEvent | undefined {
  const price = PRICE_KEYS.map((k) => parsePrice(item[k])).find((p) => p !== undefined && p > 0);
  const d = DATE_KEYS.map((k) => parseLooseDate(item[k])).find(Boolean);
  if (price === undefined || !d) return undefined;
  const label = (LABEL_KEYS.map((k) => item[k]).find((v) => typeof v === 'string') as string | undefined) ?? fallbackLabel;
  const isRent = /rent|let/i.test(`${label} ${item.transactionType ?? ''} ${item.category ?? ''} ${item.uri ?? ''}`);
  const listingType = isRent ? 'rent' : 'sale';

  const uri = typeof item.uri === 'string' ? item.uri : typeof item.listingUris === 'string' ? item.listingUris : undefined;
  const id = String(item.listingId ?? uri?.match(/(\d+)\/?(?:[?#].*)?$/)?.[1] ?? '');
  const a = (item.attributes ?? {}) as Record<string, unknown>;
  const event: HistoryEvent = { kind: 'listing', listingType, label, date: d.date, datePrecision: d.precision, price };
  if (/^\d+$/.test(id)) {
    event.listing = {
      id,
      listingType,
      url: uri ? new URL(uri, ZOOPLA).toString() : `${ZOOPLA}/${isRent ? 'to-rent' : 'for-sale'}/details/${id}/`,
      bedrooms: toNumber(a.bedrooms),
      bathrooms: toNumber(a.bathrooms),
      receptions: toNumber(a.livingRooms),
      floorAreaSqm: floorAreaFrom(a),
      imageUrls: mediaUrls(item.images),
      floorplanUrls: mediaUrls(item.floorplans),
    };
  }
  return event;
}

const detailsUrl = (id: string, t: 'sale' | 'rent') => `${ZOOPLA}/${t === 'rent' ? 'to-rent' : 'for-sale'}/details/${id}/`;

/** Listing ids referenced *within* the given JSON (so links to other properties are ignored). */
function listingIdsIn(value: unknown): ListingRef[] {
  const out = new Map<string, 'sale' | 'rent'>();
  for (const m of JSON.stringify(value ?? null).matchAll(/\/(for-sale|to-rent)\/details\/(\d+)/g)) {
    if (!out.has(m[2])) out.set(m[2], m[1] === 'to-rent' ? 'rent' : 'sale');
  }
  walk(value, (obj) => {
    const id = obj.listingId ?? obj.listing_id;
    if ((typeof id === 'string' || typeof id === 'number') && /^\d+$/.test(String(id)) && !out.has(String(id))) {
      out.set(String(id), /rent|let/i.test(String(obj.transactionType ?? obj.category ?? '')) ? 'rent' : 'sale');
    }
  });
  return [...out].map(([id, listingType]) => ({ id, listingType, url: detailsUrl(id, listingType) }));
}

/** Structured property page data, or undefined if the page doesn't have it. */
export function propertyFromNextData(blobs: unknown[]): Omit<PropertyPage, 'uprn' | 'address'> & { uprn?: string; address?: string } | undefined {
  const p = findPropertyObject(blobs);
  if (!p) return undefined;
  const history: HistoryEvent[] = [];
  for (const s of (p.history.historicSales ?? []) as Record<string, unknown>[]) {
    const d = parseLooseDate(s.date);
    const price = parsePrice(s.price);
    if (d && price) history.push({ kind: 'sale', label: 'Sold', date: d.date, datePrecision: d.precision, price });
  }
  for (const l of (p.history.historicListings ?? []) as Record<string, unknown>[]) {
    const e = listingEventFrom(l, 'Listed');
    if (e) history.push(e);
  }
  for (const l of (p.liveListings ?? []) as Record<string, unknown>[]) {
    const e = listingEventFrom(l, 'Live listing');
    if (e) history.push(e);
  }
  const a = (p.attributes ?? {}) as Record<string, unknown>;
  return {
    uprn: p.address?.uprn ? String(p.address.uprn) : undefined,
    address: typeof p.address?.fullAddress === 'string' ? p.address.fullAddress : undefined,
    bedrooms: toNumber(a.bedrooms),
    bathrooms: toNumber(a.bathrooms),
    receptions: toNumber(a.livingRooms),
    floorAreaSqm: floorAreaFrom(a),
    history: dedupeHistory(history),
    listings: mergeListingRefs(
      history.flatMap((e) => (e.listing ? [{ id: e.listing.id, listingType: e.listing.listingType, url: e.listing.url }] : [])),
      listingIdsIn([p.liveListings, p.history.historicListings]),
    ),
  };
}

export function dedupeHistory(events: HistoryEvent[]): HistoryEvent[] {
  const seen = new Map<string, HistoryEvent>();
  for (const e of events) {
    const key = `${e.kind}|${e.listingType ?? ''}|${e.date.slice(0, 7)}|${e.price}`;
    const prev = seen.get(key);
    // prefer day precision when duplicates differ
    if (!prev || (prev.datePrecision === 'month' && e.datePrecision === 'day')) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- pages

/** One row of a house-prices results page (`pageProps.propertiesSearch.edges[].node`). */
export interface HousePricesResult extends PropertyDetails {
  uprn: string;
  address: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
  /** Zoopla's description, e.g. "Converted Flat", "Terraced house" */
  propertyType?: string;
  tenure?: string;
  lastSale?: { date: string; price: number };
}

export interface HousePricesResults {
  results: HousePricesResult[];
  hasNextPage: boolean;
}

/**
 * Structured results from the house-prices page's embedded `propertiesSearch` JSON.
 * Returns undefined if the page doesn't contain it (challenge/error page, or markup changed),
 * which callers use to tell a real results page from a failed one.
 */
export function extractHousePricesResults(html: string): HousePricesResults | undefined {
  let search: Record<string, unknown> | undefined;
  for (const blob of extractEmbeddedJson(html)) {
    walk(blob, (obj) => {
      if (!search && obj.propertiesSearch && typeof obj.propertiesSearch === 'object') {
        search = obj.propertiesSearch as Record<string, unknown>;
      }
    });
    if (search) break;
  }
  if (!search || !Array.isArray(search.edges)) return undefined;

  const results: HousePricesResult[] = [];
  for (const edge of search.edges as { node?: Record<string, any> }[]) {
    const n = edge?.node;
    const uprn = String(n?.uprn ?? n?.address?.uprn ?? '');
    const address = n?.address?.fullAddress;
    if (!n || !uprn || typeof address !== 'string') continue;
    const a = n?.attributes ?? {};
    const sold = n?.lastSale && parseLooseDate(n.lastSale.date);
    const soldPrice = parsePrice(n?.lastSale?.price);
    results.push({
      uprn,
      address,
      postcode: n.address.postcode,
      latitude: toNumber(n.address.latitude),
      longitude: toNumber(n.address.longitude),
      propertyType: a.propertyType ?? undefined,
      tenure: a.tenure ?? undefined,
      bedrooms: toNumber(a.bedrooms),
      bathrooms: toNumber(a.bathrooms),
      receptions: toNumber(a.livingRooms),
      floorAreaSqm: floorAreaFrom(a),
      lastSale: sold && soldPrice ? { date: sold.date, price: soldPrice } : undefined,
    });
  }
  const pageInfo = search.pageInfo as { hasNextPage?: boolean } | undefined;
  return { results, hasNextPage: pageInfo?.hasNextPage === true };
}

/** Links to /property/uprn/<uprn>/ pages on a house-prices results page. */
export function extractUprnLinks(html: string): string[] {
  const uprns = new Set<string>();
  for (const m of html.matchAll(/\/property\/uprn\/(\d+)/g)) uprns.add(m[1]);
  return [...uprns];
}

export function extractListingIds(html: string): ListingRef[] {
  const out = new Map<string, 'sale' | 'rent'>();
  for (const m of html.matchAll(/\/(for-sale|to-rent)\/details\/(\d+)/g)) {
    if (!out.has(m[2])) out.set(m[2], m[1] === 'to-rent' ? 'rent' : 'sale');
  }
  return [...out].map(([id, listingType]) => ({ id, listingType, url: detailsUrl(id, listingType) }));
}

/** First occurrence of each listing id wins. */
function mergeListingRefs(...lists: ListingRef[][]): ListingRef[] {
  const out = new Map<string, ListingRef>();
  for (const r of lists.flat()) if (!out.has(r.id)) out.set(r.id, r);
  return [...out.values()];
}

function h1Text(html: string): string | undefined {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : undefined;
  return t || undefined;
}

export function extractPropertyPage(html: string, url?: string): PropertyPage {
  const blobs = extractEmbeddedJson(html);
  const urlUprn = url?.match(/\/uprn\/(\d+)/)?.[1];

  // Preferred: the page's own structured data. Heuristics below are only a fallback.
  const structured = propertyFromNextData(blobs);
  if (structured) return { ...structured, uprn: structured.uprn ?? urlUprn };

  const text = pageText(html);
  const uprn = urlUprn;
  const address =
    h1Text(html) ?? metaContent(html, 'og:title')?.replace(/\s*[-|]\s*Zoopla.*$/i, '').trim();
  return {
    uprn,
    address,
    ...mergeDetails(detailsFromJson(blobs), detailsFromText(text)),
    history: dedupeHistory([...historyFromJson(blobs), ...historyFromText(text)]),
    listings: extractListingIds(html),
  };
}

/**
 * Zoopla image URLs look like https://lid.zoocdn.com/<w>/<h>/<hash>.jpg (sometimes with a
 * "u/" prefix). Keep the largest variant per hash.
 */
export function extractImageUrls(html: string): string[] {
  const best = new Map<string, { url: string; size: number }>();
  const re = /https?:(?:\\*\/){2}lid\.zoocdn\.com(?:\\*\/)[^"'\s)<>]+?\.(?:jpe?g|png|webp)/gi;
  for (const m of html.matchAll(re)) {
    const url = m[0].replace(/\\+\//g, '/');
    const parts = url.split('/');
    const file = parts[parts.length - 1];
    const dims = url.match(/\/(\d{2,4})\/(\d{2,4})\//);
    const size = dims ? Number(dims[1]) * Number(dims[2]) : 0;
    const prev = best.get(file);
    if (!prev || size > prev.size) best.set(file, { url, size });
  }
  return [...best.values()].map((v) => v.url);
}

/** HTML description -> readable plain text. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** The `ListingData` object embedded in listing pages (live and archived). */
function findListingData(blobs: unknown[]): Record<string, any> | undefined {
  let found: Record<string, any> | undefined;
  for (const blob of blobs) {
    walk(blob, (obj) => {
      if (!found && (obj.__typename === 'ListingData' || ('listingId' in obj && 'pricing' in obj && 'propertyImage' in obj))) found = obj;
    });
    if (found) break;
  }
  return found;
}

function listingPageFromData(d: Record<string, any>): ListingPage {
  const counts = (d.counts ?? {}) as Record<string, unknown>;
  const sqft = toNumber(d.ingested?.sizeSqft);
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.label)).filter((x): x is string => typeof x === 'string').map(decodeEntities) : []);
  return {
    listingId: d.listingId ? String(d.listingId) : undefined,
    listingType: /rent/i.test(String(d.section ?? '')) ? 'rent' : 'sale',
    price: parsePrice(d.pricing?.internalValue) ?? parsePrice(d.pricing?.label),
    title: typeof d.title === 'string' ? d.title : undefined,
    description: typeof d.detailedDescription === 'string' ? htmlToText(d.detailedDescription) : undefined,
    features: [...strings(d.features?.bullets), ...strings(d.features?.highlights)],
    tags: strings(d.tagsV2),
    status: d.statusSummary?.label ?? undefined,
    agent: d.branchV2?.branchName ?? undefined,
    epcRating: d.derivedEPC?.efficiencyRating ?? undefined,
    publishedOn: parseLooseDate(d.publishedOn)?.date,
    bedrooms: toNumber(counts.numBedrooms),
    // Zoopla uses 0 for "not stated" on these
    bathrooms: toNumber(counts.numBathrooms) || undefined,
    receptions: toNumber(counts.numLivingRooms) || undefined,
    floorAreaSqm: (d.floorArea && floorAreaFrom({ floorArea: d.floorArea })) ?? (sqft ? sqftToSqm(sqft) : undefined),
    imageUrls: mediaUrls(d.propertyImage),
    floorplanUrls: mediaUrls(d.floorPlan?.image),
  };
}

export function extractListingPage(html: string, url?: string): ListingPage {
  const blobs = extractEmbeddedJson(html);
  const data = findListingData(blobs);
  if (data) return listingPageFromData(data);

  // Fallback heuristics for pages without ListingData
  const title = metaContent(html, 'og:title') ?? h1Text(html);
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  const listingMatch = url?.match(/\/(for-sale|to-rent)\/details\/(\d+)/);

  let price: number | undefined;
  const features: string[] = [];
  for (const blob of blobs) {
    walk(blob, (obj) => {
      if (price === undefined && obj.offers && typeof obj.offers === 'object') {
        price = parsePrice((obj.offers as Record<string, unknown>).price);
      }
      if (price === undefined) {
        for (const k of ['price', 'askingPrice', 'priceValue']) {
          const p = parsePrice(obj[k]);
          if (p && p > 1000) {
            price = p;
            break;
          }
        }
      }
      for (const k of ['features', 'bullets', 'keyFeatures']) {
        const v = obj[k];
        if (Array.isArray(v)) for (const f of v) if (typeof f === 'string' && !features.includes(f)) features.push(f);
      }
    });
  }
  if (price === undefined) price = parsePrice(title?.match(/£[\d,]+/)?.[0]);

  const titleDetails = detailsFromText(`${title ?? ''} ${description ?? ''}`);
  return {
    listingId: listingMatch?.[2],
    listingType: listingMatch ? (listingMatch[1] === 'to-rent' ? 'rent' : 'sale') : undefined,
    price,
    title,
    description,
    features,
    tags: [],
    ...mergeDetails(detailsFromJson(blobs), mergeDetails(titleDetails, detailsFromText(pageText(html)))),
    imageUrls: extractImageUrls(html),
    floorplanUrls: [],
  };
}
