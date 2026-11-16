/**
 * Zoopla sign-in. Zoopla uses passwordless email sign-in: enter the email, then a
 * confirmation code is emailed. The script fills in the email; you type the code into
 * the browser window, and the script waits until the session is signed in.
 *
 * Signed-in state is read from the `__Host-zooplaat` access-token cookie (a JWT): its
 * `type` claim is "anon" for anonymous sessions and "auth" once signed in. The persistent
 * browser profile keeps the session (via the refresh token) between runs.
 */
import { BrowserContext, Page } from 'playwright';
import { sleep } from '../common';
import { getPage } from './browser';
import { ZOOPLA } from './urls';

const ACCESS_TOKEN_COOKIE = '__Host-zooplaat';
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

const EMAIL_INPUT = 'input#email, input[type="email"][name="email"]';
const EMAIL_SUBMIT = 'button[data-testid="email-entry-next-button"]';

/** The `type` claim of a Zoopla access-token JWT ("anon" | "auth"), or undefined if unreadable. */
export function tokenType(jwt: string | undefined): string | undefined {
  const payload = jwt?.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.type === 'string' ? json.type : undefined;
  } catch {
    return undefined;
  }
}

export async function isSignedIn(context: BrowserContext): Promise<boolean> {
  const cookie = (await context.cookies(ZOOPLA)).find((c) => c.name === ACCESS_TOKEN_COOKIE);
  return tokenType(cookie?.value) === 'auth';
}

async function waitForSignIn(context: BrowserContext): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < SIGN_IN_TIMEOUT_MS) {
    if (await isSignedIn(context)) return true;
    await sleep(2000);
  }
  return false;
}

/**
 * Make sure the browser session is signed in as `email`. Returns true when signed in.
 * Never throws for a failed sign-in: the scraper carries on signed out (with less data).
 */
export async function ensureSignedIn(context: BrowserContext, page: Page, email: string): Promise<boolean> {
  // Loading any page lets Zoopla refresh an expired access token from the refresh token.
  await getPage(page, `${ZOOPLA}/`, { delay: false });
  if (await isSignedIn(context)) {
    console.log('Zoopla: already signed in');
    return true;
  }

  console.log(`Zoopla: signing in as ${email}`);
  await getPage(page, `${ZOOPLA}/signin/`, { delay: false });
  const input = page.locator(EMAIL_INPUT).first();
  try {
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.fill('');
    await input.pressSequentially(email, { delay: 40 + Math.random() * 60 });
    await page.locator(EMAIL_SUBMIT).first().click({ timeout: 10_000 });
    console.log('  ✉  A confirmation code has been emailed - enter it in the browser window (waiting up to 10 min)...');
  } catch (e) {
    console.warn(`  couldn't fill in the sign-in form automatically (${(e as Error).message.split('\n')[0]}).`);
    console.warn('  Please sign in manually in the browser window (waiting up to 10 min)...');
  }

  if (await waitForSignIn(context)) {
    console.log('  ✓ signed in');
    return true;
  }
  console.warn('  sign-in timed out; continuing signed out');
  return false;
}
