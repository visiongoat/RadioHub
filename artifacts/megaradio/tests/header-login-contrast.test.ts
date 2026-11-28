import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test} from 'vitest';

test('desktop sign-up action uses the Figma pill and meets 4.5:1 in both states', () => {
  const source=readFileSync(resolve(process.cwd(),'src/components/layout/radio-header.tsx'),'utf8');
  const button=source.match(/<Link\s+href=\{getLocalizedUrl\('\/signup'\)\}\s+className="([^"]+)"/)?.[1];
  expect(button).toContain('min-h-[45px] min-w-[97px]');
  expect(button).toContain('rounded-full');
  expect(button).toContain('text-white');
  const colors=[...button!.matchAll(/bg-\[#([A-Fa-f0-9]{6})\]/g)].map(m=>m[1]);
  expect(colors).toHaveLength(2);
  for(const hex of colors){
    const c=hex.match(/../g)!.map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=c[0]*.2126+c[1]*.7152+c[2]*.0722;
    expect(1.05/(luminance+.05)).toBeGreaterThanOrEqual(4.5);
  }
});
