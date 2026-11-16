/** Pure helpers for Zoopla URLs (no browser), so they can be unit tested. */
import { postcodeSlug } from '../../shared/ids';

export const ZOOPLA = 'https://www.zoopla.co.uk';

/** Query params that are per-visit noise rather than part of a postcode's results URL. */
const TRANSIENT_PARAMS = ['pn', 'search_source', 'orig_q', 'identifier', '__cf_chl_tk', '__cf_chl_rt_tk'];

/** First guess at the house-prices URL. Zoopla may redirect it to the canonical slug. */
export function defaultHousePricesUrl(postcode: string): string {
  const q = encodeURIComponent(postcode.toLowerCase()).replace(/%20/g, '+');
  return `${ZOOPLA}/house-prices/${postcodeSlug(postcode)}/?q=${q}&view_type=list`;
}

/**
 * Is `url` a house-prices results page for exactly this postcode? The canonical form is
 * `/house-prices/<town>/<street>/<postcode-slug>/`, so the last path segment must be the
 * postcode slug (e.g. `sw1p-3ng`) - that rules out district pages, search pages and 404 redirects.
 */
export function isHousePricesUrlFor(url: string, postcode: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/(^|\.)zoopla\.co\.uk$/.test(u.hostname)) return false;
  const segments = u.pathname.split('/').filter(Boolean);
  return segments[0] === 'house-prices' && segments.length >= 2 && segments[segments.length - 1] === postcodeSlug(postcode);
}

/** Strip pagination/tracking params and make sure the list view is used. */
export function canonicalHousePricesUrl(url: string): string {
  const u = new URL(url);
  for (const p of TRANSIENT_PARAMS) u.searchParams.delete(p);
  u.searchParams.set('view_type', 'list');
  u.hash = '';
  return u.toString();
}
