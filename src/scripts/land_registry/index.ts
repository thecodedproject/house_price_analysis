/**
 * yarn scrape:lr [--postcode "SW1P 3NG"]
 *
 * Downloads Land Registry Price Paid Data for each configured postcode and upserts
 * Property + Sale (status: final) rows. Raw CSVs are kept under data/raw/land_registry/.
 */
import minimist from 'minimist';
import { Db } from '../../shared/db';
import { postcodeKey } from '../../shared/ids';
import { chainListings, reconcileSales } from '../../shared/merge';
import { loadArea, printStats, selectPostcodes, sleep, today } from '../common';
import { NodeStorage } from '../node_storage';
import { parsePpdCsv, toProperties, toProperty, toSale } from './parse';
import { fetchPostcodeCsv } from './search';

async function main() {
  const argv = minimist(process.argv.slice(2), { string: ['postcode'] });
  const storage = new NodeStorage();
  const db = await Db.load(storage);
  const postcodes = selectPostcodes(loadArea(), argv.postcode);

  for (const [i, { postcode }] of postcodes.entries()) {
    if (i > 0) await sleep(1500);
    console.log(`Land Registry: ${postcode}`);
    const csv = await fetchPostcodeCsv(postcode);
    await storage.writeText(`raw/land_registry/${postcodeKey(postcode)}/${today()}.csv`, csv);
    const records = parsePpdCsv(csv);
    // one upsert per property (records merged, latest wins), then one per sale
    for (const property of toProperties(records)) db.upsert('properties', property);
    for (const r of records) db.upsert('sales', toSale(r, toProperty(r).id));
    console.log(`  ${records.length} transaction(s)`);
  }

  const superseded = reconcileSales(db);
  chainListings(db);
  const written = await db.save();
  printStats(db);
  if (superseded) console.log(`  ${superseded} provisional sale(s) now superseded by Land Registry records`);
  console.log(written.length ? `Wrote: ${written.join(', ')}` : 'No changes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
