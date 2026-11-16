import { normalisePostcode } from '../../shared/ids';
import { LR_BASE, LrSession, USER_AGENT, openSession } from './session';

/**
 * Fetch every Price Paid record for a postcode as CSV text.
 *
 * Primary route: the CSV download linked from the search results page
 * (`ppd_data.csv?postcode=...&limit=all&header=true`), which currently needs no session.
 * Fallback: replay the browser flow (form GET -> POST /app/ppd/search with cookie + CSRF
 * token) and then download the CSV within that session.
 *
 * Replace this module with the official API client later; callers only need the CSV text.
 */
export async function fetchPostcodeCsv(postcode: string): Promise<string> {
  const pc = normalisePostcode(postcode);
  try {
    return await downloadCsv(pc);
  } catch (e) {
    console.warn(`  direct CSV download failed (${(e as Error).message}); retrying via search session`);
  }
  const session = await openSession();
  await postSearch(pc, session);
  return downloadCsv(pc, session.cookie);
}

function csvUrl(postcode: string): string {
  const params = new URLSearchParams({ postcode, limit: 'all', header: 'true' });
  return `${LR_BASE}/ppd_data.csv?${params}`;
}

async function downloadCsv(postcode: string, cookie?: string): Promise<string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'text/csv' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(csvUrl(postcode), { headers });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('csv')) throw new Error(`HTTP ${res.status} (${type})`);
  return res.text();
}

async function postSearch(postcode: string, session: LrSession): Promise<string> {
  const body = new URLSearchParams({
    authenticity_token: session.authenticityToken,
    postcode,
    limit: 'all',
  });
  const res = await fetch(`${LR_BASE}/search`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: session.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${LR_BASE}/`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Land Registry search returned ${res.status}`);
  return res.text();
}
