import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { safeAuthReturnTo, tvPairingLoginReturnTo, withAuthReturnTo } from '../src/lib/safe-auth-return';

describe('same-origin auth return targets', () => {
  it.each(['//evil.example/path', '/\\evil.example', '\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/%2Fevil.example', '/%5cevil.example', '/%0aevil', '/%zz', '/\n/evil', null])('rejects unsafe target %s', value => {
    expect(safeAuthReturnTo(value)).toBeNull();
    expect(withAuthReturnTo('/de/login', value)).toBe('/de/login');
  });
  it.each(['/tv?code=ABCD-1234', '/de/premium?plan=yearly#checkout', '/tr/istasyon/kral-fm', '/?q=hello%20world'])('preserves safe returnTo %s through signup/login', value => {
    expect(safeAuthReturnTo(value)).toBe(value);
    const link = withAuthReturnTo('/de/login', value);
    expect(new URL(link, 'https://themegaradio.com').searchParams.get('returnTo')).toBe(value);
  });
  it('both signup routes and login use shared validator/preservation', () => {
    for (const file of ['login.tsx', 'signup.tsx', 'auth/signup.tsx']) {
      const source = readFileSync(path.resolve('src/pages', file), 'utf8');
      expect(source).toContain('safeAuthReturnTo('); expect(source).toContain('withAuthReturnTo(');
      expect(source).not.toContain("returnTo.startsWith('/')");
    }
  });
  it.each(['/tv', '/en/tv', '/tr/tv'])('header login preserves a valid TV code on %s', pathname => {
    const target = tvPairingLoginReturnTo(pathname, '?code=123456&auth_token=not-for-return&other=value');
    expect(target).toBe(`${pathname}?code=123456`);
    const login = withAuthReturnTo('/en/login', target);
    expect(new URL(login, 'https://themegaradio.com').searchParams.get('returnTo')).toBe(target);
    expect(login).not.toContain('auth_token');
  });
  it('does not preserve invalid codes or unrelated page queries', () => {
    expect(tvPairingLoginReturnTo('/en/tv', '?code=ABC123')).toBe('/en/tv');
    expect(tvPairingLoginReturnTo('/en/tv', '?code=1234567')).toBe('/en/tv');
    expect(tvPairingLoginReturnTo('/en/station/example', '?code=123456')).toBe('/en/station/example');
    expect(tvPairingLoginReturnTo('/api/admin', '?returnTo=/en/tv&code=123456')).toBe('/api/admin');
    expect(tvPairingLoginReturnTo('/\\external.example', '?code=123456')).toBe('/');
  });
});

 it('keeps only a known paired receiver on the header login return',()=>{
 const receiver='uuid:5196ead7-40d7-481f-8739-ff866eb19fba',application='MgRadioDev.MegaRadioTVAPP';
 expect(tvPairingLoginReturnTo('/tr/tv','?code=123456&receiver='+encodeURIComponent(receiver)+'&application='+application+'&auth_token=secret')).toBe('/tr/tv?code=123456&receiver='+encodeURIComponent(receiver)+'&application='+application);
 expect(tvPairingLoginReturnTo('/tr/tv','?code=123456&receiver='+encodeURIComponent(receiver)+'&application=OtherApp')).toBe('/tr/tv?code=123456');
 });
