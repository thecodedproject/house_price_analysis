/** yarn merge - reconcile provisional/final sales and chain listing price changes. */
import { Db } from '../shared/db';
import { chainListings, reconcileSales } from '../shared/merge';
import { printStats } from './common';
import { NodeStorage } from './node_storage';

async function main() {
  const db = await Db.load(new NodeStorage());
  const superseded = reconcileSales(db);
  const chained = chainListings(db);
  const written = await db.save();
  console.log(`Superseded ${superseded} provisional sale(s); re-chained ${chained} listing(s).`);
  printStats(db);
  console.log(written.length ? `Wrote: ${written.join(', ')}` : 'No changes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
