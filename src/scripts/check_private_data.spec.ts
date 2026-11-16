import { findProblems } from './check_private_data';

// Built at runtime so this file itself never contains a non-allowed postcode or email.
const PC = ['E1', '6AN'];
const spaced = PC.join(' ');
const compact = PC.join('');
const slug = PC.join('-').toLowerCase();
const email = ['someone', 'mail.co.uk'].join('@');

describe('findProblems', () => {
  it('allows only the Westminster test postcodes, in any format', () => {
    const ok = 'SW1A 0AA, SW1P3BU, house-prices/london/great-smith-street/sw1p-3bu/';
    expect(findProblems('f', ok, [])).toEqual([]);
    const bad = findProblems('f', `line one\n${spaced} then ${compact} then ${slug}`, []);
    expect(bad.map((p) => [p.line, p.match])).toEqual([
      [2, spaced],
      [2, compact],
      [2, slug],
    ]);
  });

  it('ignores postcode-like fragments inside hashes', () => {
    expect(findProblems('f', 'https://lid.zoocdn.com/u/1024/768/e016871d5468dc4fbf314f9bdf67a89b325136a0.jpg', [])).toEqual([]);
  });

  it('flags email addresses other than placeholders', () => {
    expect(findProblems('f', 'you@example.com noreply@anthropic.com <img src="logo-400x200@2x.webp">', [])).toEqual([]);
    expect(findProblems('f', `"zoopla_login_email": "${email}"`, [])[0]).toMatchObject({ match: email, reason: 'email address' });
  });

  it('flags whole-word matches of private terms, without printing them in full', () => {
    const denied = [{ term: 'acacia avenue', kind: 'street name' }, { term: '123456', kind: 'UPRN' }];
    const found = findProblems('f', 'id: Acacia Avenue\nuprn/123456/\nhash a1234567b', denied);
    expect(found.map((p) => [p.line, p.match, p.reason])).toEqual([
      [1, 'ac…ue', 'matches a street name from your private local data'],
      [2, '12…56', 'matches a UPRN from your private local data'],
    ]);
  });
});
