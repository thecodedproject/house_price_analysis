/**
 * yarn zoopla:probe <url>
 *
 * Debug tool: opens the scraper's browser profile, loads one URL and logs every main-frame
 * navigation response (status + URL), then the final title / challenge state over time.
 * Saves the final HTML to data/raw/zoopla/probe.html.
 */
import { NodeStorage } from '../node_storage';
import { sleep } from '../common';
import { launchBrowser } from './browser';
import { extractUprnLinks, isChallengePage } from './extract';

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('usage: yarn zoopla:probe <url>');
  const context = await launchBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  const t0 = Date.now();
  const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  page.on('response', (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) {
      console.log(`[${ts()}] nav response ${r.status()} ${r.url()}`);
    }
  });
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log(`[${ts()}] navigated -> ${f.url()}`));

  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log(`[${ts()}] goto() returned status ${res?.status()}`);

  for (let i = 0; i < 10; i++) {
    const html = await page.content().catch(() => '');
    console.log(
      `[${ts()}] title=${JSON.stringify(await page.title().catch(() => '?'))} challenge=${isChallengePage(html)} ` +
        `uprnLinks=${extractUprnLinks(html).length} bytes=${html.length}`,
    );
    await sleep(1500);
  }
  const cookies = await context.cookies('https://www.zoopla.co.uk');
  console.log(`cookies: ${cookies.map((c) => c.name).sort().join(', ')}`);
  await new NodeStorage().writeText('raw/zoopla/probe.html', await page.content());
  console.log('saved data/raw/zoopla/probe.html');
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
