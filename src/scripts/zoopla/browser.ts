import * as path from 'path';
import { BrowserContext, Page, Response, chromium } from 'playwright';
import { randomDelay, sleep } from '../common';
import { DATA_DIR } from '../node_storage';
import { isChallengePage } from './extract';

// ZOOPLA_PROFILE_DIR lets you test with a fresh profile (e.g. to reproduce first-visit behaviour)
export const PROFILE_DIR = process.env.ZOOPLA_PROFILE_DIR ?? path.join(DATA_DIR, '.browser-profile');
const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A headed browser with a persistent profile, so Cloudflare clearance and any Zoopla login
 * survive between runs. Prefers the locally installed Google Chrome (looks most like a real
 * user); falls back to Playwright's Chromium (`yarn playwright:install`).
 */
export async function launchBrowser(): Promise<BrowserContext> {
  const opts = { headless: false, viewport: null, args: ['--disable-blink-features=AutomationControlled'] };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' });
  } catch (e) {
    console.warn(`Could not launch Google Chrome (${(e as Error).message.split('\n')[0]}); using bundled Chromium`);
    return chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
}

/** If Cloudflare shows a challenge, wait for the human to clear it in the browser window. */
export async function waitForChallenge(page: Page): Promise<void> {
  if (!isChallengePage(await page.content())) return;
  console.log('  ⚠ Cloudflare challenge - please complete it in the browser window...');
  const start = Date.now();
  while (Date.now() - start < CHALLENGE_TIMEOUT_MS) {
    await sleep(2000);
    if (!isChallengePage(await page.content().catch(() => ''))) {
      console.log('  ✓ challenge cleared');
      await page.waitForLoadState('domcontentloaded');
      return;
    }
  }
  throw new Error('Timed out waiting for the Cloudflare challenge to be completed');
}

export interface FetchedPage {
  url: string;
  /**
   * Status of the *last* main-frame document response. Zoopla sometimes answers the first
   * request with a 403 whose JS then reloads into the real page, so the status that
   * page.goto() reports isn't reliable - judge pages by their content.
   */
  status: number;
  /** Every main-frame document status seen, in order (e.g. [403, 200]) - for logging */
  statuses: number[];
  html: string;
}

const RELOAD_WAIT_MS = 10_000;

/**
 * Navigate politely (random 3-8s pause first) and return the rendered HTML, after any
 * Cloudflare challenge (only waited for if one actually appears) and any JS-driven reload.
 */
export async function getPage(page: Page, url: string, { delay = true } = {}): Promise<FetchedPage> {
  if (delay) await randomDelay(3000, 8000);
  const statuses: number[] = [];
  const onResponse = (r: Response) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) statuses.push(r.status());
  };
  page.on('response', onResponse);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForChallenge(page);
    // Error status but no challenge: give the page's JS a moment to reload itself.
    if ((statuses[statuses.length - 1] ?? 0) >= 400) {
      await page.waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: RELOAD_WAIT_MS }).catch(() => undefined);
      await waitForChallenge(page);
    }
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    return { url: page.url(), status: statuses[statuses.length - 1] ?? 0, statuses, html: await page.content() };
  } finally {
    page.off('response', onResponse);
  }
}

/** Download a binary (e.g. an image) using the browser's cookies. */
export async function download(context: BrowserContext, url: string): Promise<Uint8Array> {
  const res = await context.request.get(url, { headers: { Referer: 'https://www.zoopla.co.uk/' } });
  if (!res.ok()) throw new Error(`HTTP ${res.status()} for ${url}`);
  return new Uint8Array(await res.body());
}
