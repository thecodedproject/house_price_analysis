/**
 * Land Registry PPD web-app session: GET the search form to obtain the Rails session cookie
 * and the form's `authenticity_token` (CSRF), both required to POST /app/ppd/search.
 */
export const LR_BASE = 'https://landregistry.data.gov.uk/app/ppd';
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0';

export interface LrSession {
  cookie: string;
  authenticityToken: string;
}

export async function openSession(): Promise<LrSession> {
  const res = await fetch(`${LR_BASE}/`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Land Registry form page returned ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const html = await res.text();
  const m = html.match(/name="authenticity_token" value="([^"]+)"/);
  if (!cookie || !m) throw new Error('Could not obtain Land Registry session cookie / authenticity token');
  return { cookie, authenticityToken: m[1] };
}
