import { Db } from './db';
import { Listing, Sale } from './types';

/** How far apart (in months) a provisional and final sale can be and still be the same sale. */
export const MATCH_WINDOW_MONTHS = 9;
/** Relative price difference allowed between a provisional and final figure. */
export const MATCH_PRICE_TOLERANCE = 0.1;
/** Listings closer together than this are treated as one marketing campaign (price changes). */
export const LISTING_CHAIN_MONTHS = 12;

function monthIndex(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function monthsApart(a: string, b: string): number {
  return Math.abs(monthIndex(a) - monthIndex(b));
}

/** Is `final` plausibly the Land Registry record of the `provisional` Zoopla sale? */
export function isSameSale(provisional: Pick<Sale, 'date' | 'price'>, final: Pick<Sale, 'date' | 'price'>): boolean {
  if (monthsApart(provisional.date, final.date) > MATCH_WINDOW_MONTHS) return false;
  const diff = Math.abs(provisional.price - final.price) / Math.max(final.price, 1);
  return diff <= MATCH_PRICE_TOLERANCE;
}

/** The final sale (if any) that matches a provisional one for the same property. */
export function findMatchingFinal(db: Db, sale: Pick<Sale, 'propertyId' | 'date' | 'price'>): Sale | undefined {
  return db
    .salesFor(sale.propertyId)
    .find((s) => s.status === 'final' && isSameSale(sale, s));
}

/**
 * Links each provisional sale to the final sale that replaced it (sets `supersededBy`).
 * Final rows are never modified. Returns the number of newly superseded sales.
 */
export function reconcileSales(db: Db): number {
  let count = 0;
  for (const sale of Object.values(db.sales)) {
    if (sale.status !== 'provisional' || sale.supersededBy) continue;
    const match = findMatchingFinal(db, sale);
    if (match) {
      db.upsert('sales', { ...sale, supersededBy: match.id });
      count++;
    }
  }
  return count;
}

/**
 * Chains consecutive listings of the same property & type into price-change sequences by
 * setting `previousListingId`. A sale in between, or a long gap, starts a new chain.
 */
export function chainListings(db: Db): number {
  let count = 0;
  const byProperty = new Map<string, Listing[]>();
  for (const l of Object.values(db.listings)) {
    const key = `${l.propertyId}|${l.listingType}`;
    if (!byProperty.has(key)) byProperty.set(key, []);
    byProperty.get(key)!.push(l);
  }
  for (const listings of byProperty.values()) {
    // oldest first; within a month, higher price first (reductions go down)
    listings.sort((a, b) => a.listedDate.localeCompare(b.listedDate) || b.price - a.price);
    const sales = db.salesFor(listings[0].propertyId);
    for (let i = 1; i < listings.length; i++) {
      const prev = listings[i - 1];
      const cur = listings[i];
      const soldBetween = sales.some(
        (s) => s.date.slice(0, 7) >= prev.listedDate.slice(0, 7) && s.date.slice(0, 7) < cur.listedDate.slice(0, 7),
      );
      const linked = !soldBetween && monthsApart(prev.listedDate, cur.listedDate) <= LISTING_CHAIN_MONTHS;
      const previousListingId = linked ? prev.id : undefined;
      if (cur.previousListingId !== previousListingId) {
        db.upsert('listings', { ...cur, previousListingId });
        if (!previousListingId) {
          // upsert keeps old values for undefined fields, so clear explicitly
          delete db.listings[cur.id].previousListingId;
          db.touch('listings');
        }
        count++;
      }
    }
  }
  return count;
}
