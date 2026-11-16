/**
 * Maps extracted Zoopla data onto DB rows. Pure (no browser), so it's unit tested.
 */
import { Db } from '../../shared/db';
import { listingId, normalisePostcode, parseFreeAddress, postcodeKey, propertyId, zooplaSaleId } from '../../shared/ids';
import { findMatchingFinal } from '../../shared/merge';
import { HistoryEvent, HousePricesResult, ListingPage, PropertyPage } from './extract';
import { ZOOPLA } from './urls';

/** What we need to identify a property: from a property page or a results row. */
type PropertyRef = Pick<PropertyPage, 'uprn' | 'address'> & { latitude?: number; longitude?: number };

/**
 * Find (or create) the Property for a Zoopla property page or results row:
 * by UPRN first, then by normalised address, else a new row.
 */
export function resolveProperty(db: Db, page: PropertyRef, postcode: string, url: string): string {
  const pc = normalisePostcode(postcode);
  const byUprn = page.uprn ? db.findPropertyByUprn(page.uprn) : undefined;
  const parts = page.address ? parseFreeAddress(page.address, pc) : undefined;

  let id: string;
  if (byUprn) id = byUprn.id;
  else if (parts) id = propertyId({ ...parts, postcode: pc });
  else if (page.uprn) id = `${postcodeKey(pc)}_uprn_${page.uprn}`;
  else throw new Error(`Cannot identify property at ${url} (no address or UPRN found)`);

  const existing = db.properties[id];
  db.upsert('properties', {
    id,
    postcode: existing?.postcode ?? pc,
    paon: existing?.paon ?? parts?.paon ?? '',
    saon: existing ? existing.saon : parts?.saon,
    street: existing?.street ?? parts?.street ?? '',
    uprn: page.uprn,
    zooplaUrl: url,
    latitude: page.latitude,
    longitude: page.longitude,
  });
  return id;
}

/**
 * Ingest one row of the house-prices results: the property itself, its last sale
 * (provisional unless Land Registry already has it) and its current attributes.
 * Returns the property id, or undefined if the row has no usable address/UPRN.
 */
export function ingestHousePricesResult(db: Db, r: HousePricesResult, postcode: string): string | undefined {
  if (!r.uprn) return undefined;
  const url = `${ZOOPLA}/property/uprn/${r.uprn}/`;
  const id = resolveProperty(db, r, r.postcode ?? postcode, url);
  const history: HistoryEvent[] = r.lastSale
    ? [{ kind: 'sale', label: 'Last sale', date: r.lastSale.date, datePrecision: r.lastSale.date.length > 7 ? 'day' : 'month', price: r.lastSale.price }]
    : [];
  ingestHistory(db, id, history);
  return id;
}

/** Upsert listing rows and provisional sales from the property's history. */
export function ingestHistory(db: Db, propId: string, history: HistoryEvent[]): void {
  for (const e of history) {
    if (e.kind === 'sale') {
      // Land Registry is authoritative; only record sales it doesn't know about yet
      if (findMatchingFinal(db, { propertyId: propId, date: e.date, price: e.price })) continue;
      db.upsert('sales', {
        id: zooplaSaleId(propId, e.date),
        propertyId: propId,
        date: e.date,
        price: e.price,
        status: 'provisional',
        source: 'zoopla',
      });
    } else {
      const type = e.listingType ?? 'sale';
      const id = listingId(propId, type, e.date, e.price);
      const l = e.listing;
      db.upsert('listings', {
        id,
        propertyId: propId,
        listedDate: e.date,
        datePrecision: e.datePrecision,
        price: e.price,
        listingType: type,
        event: e.label,
        zooplaListingId: l?.id,
        zooplaListingUrl: l?.url,
        // this listing's own snapshot (what was advertised at the time)
        bedrooms: l?.bedrooms,
        bathrooms: l?.bathrooms,
        receptions: l?.receptions,
        floorAreaSqm: l?.floorAreaSqm,
        images: db.listings[id]?.images ?? [],
      });
    }
  }
}

export interface ListingMedia {
  images: string[];
  floorplans: string[];
}

/**
 * Attach a listing page (details + downloaded media paths) to the matching Listing row:
 * same Zoopla listing id, else the latest listing at the same price, else a new row.
 */
export function ingestListingPage(
  db: Db,
  propId: string,
  lp: ListingPage & { url: string },
  media: ListingMedia,
  todayIso: string,
): string | undefined {
  const type = lp.listingType ?? 'sale';
  const listings = db.listingsFor(propId).filter((l) => l.listingType === type);
  let row =
    (lp.listingId ? listings.find((l) => l.zooplaListingId === lp.listingId) : undefined) ??
    [...listings].reverse().find((l) => !l.zooplaListingId && lp.price !== undefined && l.price === lp.price);

  if (!row) {
    if (lp.price === undefined) return undefined;
    const date = lp.publishedOn ?? todayIso;
    const id = listingId(propId, type, date, lp.price);
    db.upsert('listings', {
      id,
      propertyId: propId,
      listedDate: lp.publishedOn ?? todayIso.slice(0, 7),
      datePrecision: lp.publishedOn ? 'day' : 'month',
      price: lp.price,
      listingType: type,
      event: 'Seen on Zoopla',
      images: [],
    });
    row = db.listings[id];
  }

  db.upsert('listings', {
    ...row,
    zooplaListingId: lp.listingId ?? row.zooplaListingId,
    zooplaListingUrl: lp.url,
    // listing-page values are the most complete, but never wipe what's there
    bedrooms: lp.bedrooms ?? row.bedrooms,
    bathrooms: lp.bathrooms ?? row.bathrooms,
    receptions: lp.receptions ?? row.receptions,
    floorAreaSqm: lp.floorAreaSqm ?? row.floorAreaSqm,
    title: lp.title ?? row.title,
    description: lp.description ?? row.description,
    features: lp.features.length ? lp.features : row.features,
    tags: lp.tags.length ? lp.tags : row.tags,
    status: lp.status ?? row.status,
    agent: lp.agent ?? row.agent,
    epcRating: lp.epcRating ?? row.epcRating,
    images: media.images.length ? media.images : row.images,
    floorplans: media.floorplans.length ? media.floorplans : row.floorplans,
  });
  return row.id;
}
