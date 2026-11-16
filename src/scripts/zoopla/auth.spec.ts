import { tokenType } from './auth';

const jwt = (payload: object) => `xx.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('tokenType', () => {
  it('reads the type claim of a Zoopla access token', () => {
    expect(tokenType(jwt({ type: 'anon', iss: 'www.zoopla.co.uk' }))).toBe('anon');
    expect(tokenType(jwt({ type: 'auth' }))).toBe('auth');
  });
  it('is undefined for missing or malformed tokens', () => {
    expect(tokenType(undefined)).toBeUndefined();
    expect(tokenType('not-a-jwt')).toBeUndefined();
    expect(tokenType('a.!!!.c')).toBeUndefined();
  });
});
