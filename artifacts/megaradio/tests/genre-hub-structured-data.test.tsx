import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { translateUrl } from '@workspace/seo-shared/url-translations';

let initialGuard: (url: string) => boolean;
let mobile = false;
vi.mock('@/utils/ssr-seo-head', async original => ({
  ...await original<typeof import('../src/utils/ssr-seo-head')>(),
  preserveInitialSsrHead: (url: string) => initialGuard(url),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: window.location.pathname.split('/')[1], localeTranslations: {},
  t: (key: string, fallback?: string) => fallback || key,
}) }));
vi.mock('@/hooks/useGenrePageState', async original => ({
  ...await original<typeof import('../src/hooks/useGenrePageState')>(), useGenreMobileViewport: () => mobile,
}));
vi.mock('swiper/react', () => ({
  Swiper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SwiperSlide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { createInitialSsrHeadGuard } from '../src/utils/ssr-seo-head';
import { SeoPageWrapper } from '../src/components/SeoPageWrapper';
import GenresPage from '../src/pages/genres';
import { useSeoRouting } from '../src/hooks/useSeoRouting';

const origin = window.location.origin;
const list = { '@type': 'ItemList', numberOfItems: 60,
  itemListElement: [{ '@type': 'ListItem', name: 'SSR genre', url: `${origin}/en/genres/ssr-only` }] };
const globals = [{ '@type': 'WebSite', '@id': `${origin}/#website` },
  { '@type': 'Organization', '@id': `${origin}/#organization` }];
const breadcrumb = { '@type': 'BreadcrumbList', itemListElement: [] };
const collection = { '@type': 'CollectionPage', name: 'Genres', mainEntity: list };
const structuredData = { global: globals, page: [list, collection, breadcrumb] };
let client: QueryClient;
let requests: URL[];
let mode: 'ready' | 'loading' | 'empty' | 'error';
let pendingSeo: Map<string, (response: Response) => void>;

function pageSchemas() {
  return [...document.querySelectorAll('script[data-managed="seo-structured-data"][data-schema-scope="page"]')]
    .map(node => JSON.parse(node.textContent || '{}'));
}
function expectNoServerLists() {
  expect(pageSchemas().some(schema => schema['@type'] === 'ItemList' || schema.mainEntity?.['@type'] === 'ItemList')).toBe(false);
}
function seedSsr(url: string) {
  window.history.replaceState({}, '', url);
  initialGuard = createInitialSsrHeadGuard(url);
  document.head.innerHTML = '<title>SSR Genres</title>';
  for (const [scope, schemas] of Object.entries(structuredData)) for (const schema of schemas) {
    const node = document.createElement('script');
    node.type = 'application/ld+json'; node.dataset.managed = 'seo-structured-data'; node.dataset.schemaScope = scope;
    node.textContent = JSON.stringify(schema); document.head.appendChild(node);
  }
  const thirdParty = document.createElement('script'); thirdParty.id = 'third-party'; thirdParty.type = 'application/ld+json';
  thirdParty.textContent = JSON.stringify(list); document.head.appendChild(thirdParty);
}
function Content({ country }: { country: string }) {
  const { englishPath } = useSeoRouting();
  return <SeoPageWrapper>{englishPath === '/genres'
    ? <GenresPage selectedCountry={country} /> : <span>Station route</span>}</SeoPageWrapper>;
}
const tree = (country = 'Turkey') => <StrictMode><QueryClientProvider client={client}><Router>
  <Content country={country} /></Router></QueryClientProvider></StrictMode>;

beforeEach(() => {
  localStorage.clear(); mobile = false; mode = 'ready'; requests = []; pendingSeo = new Map();
  seedSsr('/en/genres');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = new URL(input, origin); requests.push(url);
    if (url.pathname === '/api/seo/page-data') return new Promise<Response>(resolve => pendingSeo.set(url.searchParams.get('url')!, resolve));
    if (url.pathname === '/api/genres/precomputed') {
      if (mode === 'loading') return new Promise<Response>(() => {});
      if (mode === 'error') return Promise.resolve(new Response(null, { status: 503 }));
      const country = url.searchParams.get('countryName'), page = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit')), search = url.searchParams.get('search') || '';
      return Promise.resolve(Response.json({
        data: mode === 'empty' ? [] : Array.from({ length: limit }, (_, index) => ({
          _id: `${country}-${page}-${search}-${index}`, slug: `genre-${country}-${page}-${search}-${index}`,
          name: `Genre ${country} ${page} ${search}${index}`, stationCount: 12,
        })), count: 60, currentPage: page, perPage: limit, totalPages: 3,
      }));
    }
    return Promise.resolve(Response.json({}));
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.replaceChildren(); });

it.each(ACTIVE_SITEMAP_LANGUAGES)('%s hub removes only the initial server list when its real filtered grid mounts', async language => {
  seedSsr(`/${language}${translateUrl('/genres', language)}`);
  const globalNodes = [...document.querySelectorAll('[data-schema-scope="global"]')];
  const thirdParty = document.getElementById('third-party');
  expect(pageSchemas()).toEqual(structuredData.page);
  render(tree());
  await screen.findByRole('heading', { name: 'Genre Turkey 1 0' });
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(27);
  expectNoServerLists();
  expect(pageSchemas()).toEqual([{ '@type': 'CollectionPage', name: 'Genres' }, breadcrumb]);
  expect(document.title).toBe('SSR Genres');
  expect([...document.querySelectorAll('[data-schema-scope="global"]')]).toEqual(globalNodes);
  expect(document.getElementById('third-party')).toBe(thirdParty);
  expect(requests.some(url => url.pathname === '/api/seo/page-data')).toBe(false);
});

it.each([false, true])('hub metadata stays honest across pagination, country and search filters (mobile=%s)', async isMobile => {
  mobile = isMobile;
  const view = render(tree());
  await screen.findByRole('heading', { name: 'Genre Turkey 1 0' });
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(isMobile ? 9 : 27);
  fireEvent.click(screen.getByRole('button', { name: '2', exact: true }));
  await screen.findByRole('heading', { name: 'Genre Turkey 2 0' });
  view.rerender(tree('Austria'));
  await screen.findByRole('heading', { name: 'Genre Austria 1 0' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'jazz' } });
  await screen.findByRole('heading', { name: 'Genre Austria 1 jazz0' });
  expectNoServerLists();
});

it.each(['loading', 'empty', 'error'] as const)('a late hub SEO response cannot restore an invisible server list during %s', async state => {
  mode = state; initialGuard = createInitialSsrHeadGuard(null);
  render(tree()); expectNoServerLists();
  await waitFor(() => expect(pendingSeo.has('/en/genres')).toBe(true));
  await act(async () => pendingSeo.get('/en/genres')!(Response.json({
    seoTags: { title: 'Late Genres', canonical: `${origin}/en/genres`, robots: 'index, follow' }, structuredData,
  })));
  await waitFor(() => expect(document.title).toBe('Late Genres'));
  expectNoServerLists();
  expect(pageSchemas()).toContainEqual(breadcrumb);
  expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
});
