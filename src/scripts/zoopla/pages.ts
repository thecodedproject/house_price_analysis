/**
 * Page-level scraping: fetch a Zoopla page in the browser, save the raw HTML, extract.
 */
import { BrowserContext, Page } from 'playwright';
import { postcodeKey } from '../../shared/ids';
import { Storage } from '../../shared/storage';
import { randomDelay } from '../common';
import { FetchedPage, getPage, waitForChallenge } from './browser';
import {
  HousePricesResult,
  ListingPage,
  ListingRef,
  PropertyPage,
  extractHousePricesResults,
  extractListingPage,
  extractPropertyPage,
  extractUprnLinks,
  isChallengePage,
} from './extract';
import { ZOOPLA, canonicalHousePricesUrl, defaultHousePricesUrl, isHousePricesUrlFor } from './urls';

export { ZOOPLA };

export interface Scraper {
  context: BrowserContext;
  page: Page;
  storage: Storage;
}

function withPage(url: string, pn: number): string {
  const u = new URL(url);
  if (pn > 1) u.searchParams.set('pn', String(pn));
  else u.searchParams.delete('pn');
  return u.toString();
}

// Zoopla's search box markup changes; try the likely candidates in order.
const SEARCH_INPUTS = [
  'input[name="q"]',
  'input[type="search"]',
  'input[placeholder*="postcode" i]',
  'input[aria-label*="search" i]',
  'input[aria-label*="location" i]',
];
const SUGGESTIONS = '[role="listbox"] [role="option"], [data-testid*="suggestion" i]';

/** Type the postcode into the house-prices search box and follow the result. */
async function searchForPostcode(page: Page, postcode: string): Promise<FetchedPage | undefined> {
  await getPage(page, `${ZOOPLA}/house-prices/`);
  for (const selector of SEARCH_INPUTS) {
    const input = page.locator(selector).first();
    if (!(await input.isVisible().catch(() => false))) continue;

    await input.fill('');
    await input.pressSequentially(postcode, { delay: 80 + Math.random() * 80 });
    // Prefer an autocomplete suggestion that names the postcode; otherwise just submit.
    const suggestion = page.locator(SUGGESTIONS).filter({ hasText: new RegExp(postcode.replace(' ', '\\s*'), 'i') }).first();
    const navigation = page.waitForURL((u) => !/\/house-prices\/?(\?|$)/.test(u.pathname + u.search), { timeout: 20_000 });
    if (await suggestion.isVisible({ timeout: 4000 }).catch(() => false)) await suggestion.click();
    else await input.press('Enter');
    await navigation.catch(() => undefined);
    await waitForChallenge(page);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    return { url: page.url(), status: 0, statuses: [], html: await page.content() };
  }
  console.warn('  could not find the Zoopla search box (see SEARCH_INPUTS in zoopla/pages.ts)');
  return undefined;
}

export interface ResolvedHousePrices {
  url: string;
  /** The already-fetched first results page, so it isn't requested twice */
  firstPage: FetchedPage;
  /** True when the URL was found this run (i.e. not taken from config) */
  discovered: boolean;
}

/**
 * Work out the house-prices results URL for a postcode: the configured one if given,
 * otherwise the guessed slug URL (following redirects), otherwise via the site search.
 * Returns undefined if none of these lands on a results page for that postcode.
 */
export async function resolveHousePricesUrl(
  s: Scraper,
  postcode: string,
  configured?: string,
): Promise<ResolvedHousePrices | undefined> {
  if (configured) {
    return { url: configured, firstPage: await getPage(s.page, configured, { delay: false }), discovered: false };
  }

  const guess = await getPage(s.page, defaultHousePricesUrl(postcode), { delay: false });
  if (isResultsPageFor(guess, postcode)) {
    return { url: canonicalHousePricesUrl(guess.url), firstPage: guess, discovered: true };
  }
  console.log(`  guessed URL didn't resolve (${describe(guess)}); trying Zoopla search`);

  await randomDelay(3000, 8000);
  const searched = await searchForPostcode(s.page, postcode);
  if (searched && isResultsPageFor(searched, postcode)) {
    return { url: canonicalHousePricesUrl(searched.url), firstPage: searched, discovered: true };
  }
  if (searched) console.warn(`  search landed on ${searched.url}, which isn't a results page for ${postcode}`);
  return undefined;
}

/** "403 -> 200 https://..." for log messages */
function describe(p: FetchedPage): string {
  return `${p.statuses.length ? p.statuses.join(' -> ') : p.status} ${p.url}`;
}

/**
 * A real results page for this postcode? Decided by URL + content, not HTTP status:
 * Zoopla can serve a working page after (or even with) a 403.
 */
function isResultsPageFor(p: FetchedPage, postcode: string): boolean {
  return isHousePricesUrlFor(p.url, postcode) && !isChallengePage(p.html) && extractHousePricesResults(p.html) !== undefined;
}

/** Walk the paginated house-prices results for a postcode. */
export async function scrapeHousePrices(
  s: Scraper,
  postcode: string,
  { url, firstPage }: ResolvedHousePrices,
  maxPages = 20,
): Promise<HousePricesResult[]> {
  const results: HousePricesResult[] = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const res = pn === 1 ? firstPage : await getPage(s.page, withPage(url, pn));
    await s.storage.writeText(`raw/zoopla/${postcodeKey(postcode)}/house_prices_p${pn}.html`, res.html);
    if (res.statuses.some((st) => st >= 400)) console.log(`  page ${pn}: HTTP ${describe(res)}`);

    const parsed = extractHousePricesResults(res.html);
    if (!parsed) {
      // Markup may have changed: fall back to bare UPRN links so the run still progresses.
      const uprns = extractUprnLinks(res.html).filter((u) => !results.some((r) => r.uprn === u));
      console.warn(
        `  page ${pn}: no propertiesSearch data (${isChallengePage(res.html) ? 'challenge page' : describe(res)})` +
          (uprns.length ? `; using ${uprns.length} UPRN link(s) instead` : ''),
      );
      results.push(...uprns.map((uprn) => ({ uprn, address: '' })));
      break;
    }
    const fresh = parsed.results.filter((r) => !results.some((x) => x.uprn === r.uprn));
    results.push(...fresh);
    if (!parsed.hasNextPage || fresh.length === 0) break;
  }
  return results;
}

export async function scrapePropertyPage(s: Scraper, postcode: string, uprn: string): Promise<PropertyPage & { url: string }> {
  const url = `${ZOOPLA}/property/uprn/${uprn}/`;
  const res = await getPage(s.page, url);
  await s.storage.writeText(`raw/zoopla/${postcodeKey(postcode)}/property_${uprn}.html`, res.html);
  return { ...extractPropertyPage(res.html, url), url };
}

/** Visit a live (`/for-sale/details/<id>/`) or archived (`/property-history/.../<id>/`) listing page. */
export async function scrapeListingPage(s: Scraper, postcode: string, ref: ListingRef): Promise<ListingPage & { url: string }> {
  const res = await getPage(s.page, ref.url);
  await s.storage.writeText(`raw/zoopla/${postcodeKey(postcode)}/listing_${ref.id}.html`, res.html);
  const lp = extractListingPage(res.html, ref.url);
  return { ...lp, listingId: lp.listingId ?? ref.id, listingType: lp.listingType ?? ref.listingType, url: ref.url };
}
