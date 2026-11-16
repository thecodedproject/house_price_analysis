/**
 * yarn scrape:zoopla [--postcode "SW1P 3NG"] [--limit N] [--uprn 100022757796[,...]]
 *                    [--no-property-pages] [--no-listings] [--no-images] [--no-login]
 *
 * Opens a real Chrome window (persistent profile in data/.browser-profile). A Cloudflare
 * challenge only appears sometimes (e.g. on a VPN); if it does, complete it in that window
 * and the script carries on.
 *
 * If config/zoopla.json has `zoopla_login_email`, the script first makes sure the session is
 * signed in: it fills in the email and waits while you type the emailed code into the browser.
 *
 * For each postcode:
 *   house-prices results  -> every property: address, UPRN, last sale
 *   property pages        -> sale history + listing history (each listing's own beds/baths,
 *                            photos, floor plans)  [--limit N properties]
 *   listing pages         -> archived/live listing: description, features, status, agent,
 *                            full photo + floor plan sets  [skip with --no-listings]
 *
 * Zoopla's terms prohibit automated scraping: keep this personal, low-volume and slow.
 */
import minimist from 'minimist';
import { BrowserContext } from 'playwright';
import { Db } from '../../shared/db';
import { chainListings, reconcileSales } from '../../shared/merge';
import { Storage } from '../../shared/storage';
import { loadArea, loadZooplaConfig, printStats, saveZooplaUrl, selectPostcodes, today } from '../common';
import { NodeStorage } from '../node_storage';
import { ensureSignedIn } from './auth';
import { download, launchBrowser } from './browser';
import { HistoryEvent, ListingPage, ListingRef } from './extract';
import { ListingMedia, ingestHistory, ingestHousePricesResult, ingestListingPage, resolveProperty } from './ingest';
import { Scraper, resolveHousePricesUrl, scrapeHousePrices, scrapeListingPage, scrapePropertyPage } from './pages';

function imageExt(url: string): string {
  return url.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i)?.[1].toLowerCase() ?? 'jpg';
}

/** Download each URL (skipping files already on disk) to `<dir>/<prefix>NN.<ext>`; returns stored paths. */
async function downloadAll(context: BrowserContext, storage: Storage, urls: string[], dir: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const [n, url] of urls.entries()) {
    const rel = `${dir}/${prefix}${String(n + 1).padStart(2, '0')}.${imageExt(url)}`;
    try {
      if (!(await storage.exists(rel))) await storage.writeBinary(rel, await download(context, url));
      paths.push(rel);
    } catch (e) {
      console.warn(`      download failed: ${(e as Error).message}`);
    }
  }
  return paths;
}

/** What the property page already told us about a listing, as a ListingPage. */
function listingFromEvent(ref: ListingRef, e: HistoryEvent | undefined): ListingPage & { url: string } {
  return {
    url: ref.url,
    listingId: ref.id,
    listingType: ref.listingType,
    price: e?.price,
    bedrooms: e?.listing?.bedrooms,
    bathrooms: e?.listing?.bathrooms,
    receptions: e?.listing?.receptions,
    floorAreaSqm: e?.listing?.floorAreaSqm,
    features: [],
    tags: [],
    imageUrls: e?.listing?.imageUrls ?? [],
    floorplanUrls: e?.listing?.floorplanUrls ?? [],
  };
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['postcode', 'uprn'],
    boolean: ['images', 'listings', 'property-pages', 'login'],
    default: { images: true, listings: true, 'property-pages': true, login: true, limit: Infinity },
  });
  const limit = Number(argv.limit);
  const storage = new NodeStorage();
  const db = await Db.load(storage);
  const postcodes = selectPostcodes(loadArea(), argv.postcode);
  const { zoopla_login_email: email } = loadZooplaConfig();

  const context = await launchBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  const s: Scraper = { context, page, storage };

  try {
    if (argv.login && email) await ensureSignedIn(context, page, email);
    else if (argv.login) console.log('Zoopla: no zoopla_login_email in config/zoopla.json - scraping signed out');

    for (const area of postcodes) {
      console.log(`Zoopla: ${area.postcode}`);
      const resolved = await resolveHousePricesUrl(s, area.postcode, area.zooplaUrl);
      if (!resolved) {
        console.warn(`  couldn't find a house-prices page for ${area.postcode}; set "zooplaUrl" in config/area.json`);
        continue;
      }
      console.log(`  ${resolved.url}`);
      if (resolved.discovered) {
        console.log(
          saveZooplaUrl(area.postcode, resolved.url)
            ? '  saved zooplaUrl to config/area.json'
            : '  (not saved: postcode not in config/area.json)',
        );
      }
      const results = await scrapeHousePrices(s, area.postcode, resolved);
      let ingested = 0;
      for (const r of results) {
        try {
          if (r.address && ingestHousePricesResult(db, r, area.postcode)) ingested++;
        } catch (e) {
          console.warn(`  result uprn ${r.uprn} skipped: ${(e as Error).message}`);
        }
      }
      await db.save();
      console.log(`  ${results.length} result(s) on the house-prices pages, ${ingested} ingested`);
      if (!argv['property-pages']) continue;

      const uprns = argv.uprn ? String(argv.uprn).split(',') : results.map((r) => r.uprn).slice(0, limit);
      console.log(`  ${uprns.length} property page(s) to visit`);

      for (const [i, uprn] of uprns.entries()) {
        try {
          const prop = await scrapePropertyPage(s, area.postcode, uprn);
          const propId = resolveProperty(db, prop, area.postcode, prop.url);
          ingestHistory(db, propId, prop.history);
          const sales = prop.history.filter((e) => e.kind === 'sale').length;
          console.log(`  [${i + 1}/${uprns.length}] ${propId}: ${sales} sale(s), ${prop.listings.length} listing(s)`);

          for (const ref of prop.listings) {
            const event = prop.history.find((e) => e.listing?.id === ref.id);
            let lp = listingFromEvent(ref, event);
            if (argv.listings) {
              try {
                const fetched = await scrapeListingPage(s, area.postcode, ref);
                // keep the property page's media if the listing page didn't give any
                lp = {
                  ...fetched,
                  price: fetched.price ?? lp.price,
                  imageUrls: fetched.imageUrls.length ? fetched.imageUrls : lp.imageUrls,
                  floorplanUrls: fetched.floorplanUrls.length ? fetched.floorplanUrls : lp.floorplanUrls,
                };
              } catch (e) {
                console.warn(`    listing page ${ref.url} failed: ${(e as Error).message}`);
              }
            }
            const media: ListingMedia = { images: [], floorplans: [] };
            if (argv.images) {
              const dir = `images/${propId}/${ref.id}`;
              media.images = await downloadAll(context, storage, lp.imageUrls, dir);
              media.floorplans = await downloadAll(context, storage, lp.floorplanUrls, dir, 'floorplan_');
            }
            const rowId = ingestListingPage(db, propId, lp, media, today());
            console.log(
              `    listing ${ref.id}: £${lp.price ?? '?'}${lp.status ? ` (${lp.status})` : ''}, ` +
                `${lp.imageUrls.length} photo(s), ${lp.floorplanUrls.length} floor plan(s)` +
                (argv.images ? `, ${media.images.length + media.floorplans.length} downloaded` : '') +
                ` -> ${rowId ?? 'skipped (no price)'}`,
            );
          }
        } catch (e) {
          console.warn(`  [${i + 1}/${uprns.length}] uprn ${uprn} failed: ${(e as Error).message}`);
        }
        await db.save(); // checkpoint: an interrupted run keeps its progress
      }
    }
  } finally {
    reconcileSales(db);
    chainListings(db);
    await db.save();
    console.log('Done. Changes this run:');
    printStats(db);
    await context.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
