import React from 'react';
import { ACTIVE_SITEMAP_LANGUAGES as INFORMATION_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getStationInformationCopy, getStationStreamUnavailableNotice } from '@workspace/seo-shared/station-page-copy';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getQueryFn } from '../src/lib/queryClient';
import { ServerSeoHeadContext } from '../src/utils/ssr-seo-head';
import { buildTemplateDescription } from '@workspace/seo-shared/station-description-template';
import { renderStationBootstrap } from '../../api-server/src/seo/station-bootstrap';
import { getStationEditorial, REVIEWED_STATION_EDITORIALS } from '@workspace/seo-shared/station-editorial';
import { SeoPageWrapper } from '../src/components/SeoPageWrapper';

const state = vi.hoisted(() => ({
  language: 'en', slug: 'fixture-radio', playStation: vi.fn(),
  hasError: false, isPlaying: false, currentStation: null as Record<string, unknown> | null,
  pauseStation: vi.fn(), stopStation: vi.fn(),
  similar: [] as Record<string, unknown>[], country: [] as Record<string, unknown>[],
}));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({
  cleanPath: `/station/${state.slug}`, englishPath: `/station/${state.slug}`, currentLanguage: state.language,
  getLocalizedUrl: (path: string) => `/${state.language}${path}`, navigateWithLanguage: vi.fn(),
}) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: state.language, localeTranslations: {},
  t: (_key: string, fallback: string) => fallback,
}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));
vi.mock('@/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ isPremium: true, isActive: true, isLoading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({
  currentStation: state.currentStation, isPlaying: state.isPlaying, stationMeta: null, hasError: state.hasError,
  playStation: state.playStation, pauseStation: state.pauseStation, stopStation: state.stopStation,
}) }));
vi.mock('@/hooks/useStationRatings', () => ({ useStationRatings: () => ({ statsStatus: 'ready' }) }));
vi.mock('@/hooks/useStationRelatedStations', async importOriginal => ({
  ...await importOriginal<typeof import('../src/hooks/useStationRelatedStations')>(),
  useStationRelatedStations: () => ({ allSimilarStations: state.similar,
    allCountryStations: state.country, countryStationsTotal: state.country.length }),
}));
vi.mock('@/components/RouteBreadcrumbs', () => ({ useBreadcrumbLastItemName: vi.fn() }));
vi.mock('@/components/star-rating', () => ({ StarRating: () => null }));
vi.mock('@/components/ui/station-control-button-group', () => ({ default: () => null }));
vi.mock('@/components/ui/favorite-button', () => ({ default: () => null }));
vi.mock('@/components/ui/listening-timer', () => ({ ListeningTimer: () => null }));
import StationDetails from '../src/pages/stations/[id]';

const article = 'Fixture Radio broadcasts local news and interviews from its studios.';
const seed = { _id: 'fixture-id', slug: 'fixture-radio', name: 'Fixture Radio',
  url: 'https://radio.invalid/live', descriptions: { en: article } };
let client: QueryClient;
let finish: (response: Response) => void;
let fail: (error: Error) => void;

beforeEach(() => {
  state.language = 'en'; state.slug = seed.slug;
  state.similar = []; state.country = []; state.playStation.mockReset();
  state.hasError = false; state.isPlaying = false; state.currentStation = null;
  state.pauseStation.mockReset(); state.stopStation.mockReset();
  window.history.replaceState({}, '', '/en/station/fixture-radio');
  document.head.innerHTML = `<title>Fixture Radio live</title>
    <link rel="canonical" data-managed="seo-head" href="https://themegaradio.com/en/station/fixture-radio">
    <meta name="robots" content="index, follow">
    <link rel="alternate" hreflang="en" href="https://themegaradio.com/en/station/fixture-radio">`;
  client = new QueryClient({ defaultOptions: { queries: {
    queryFn: getQueryFn({ on401: 'throw' }), retry: false, gcTime: 0,
  } } });
  const pending = new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; });
  vi.stubGlobal('fetch', vi.fn((url: string) => url === `/api/station/${state.slug}`
    ? pending : Promise.resolve(Response.json(url.startsWith('/api/translations') ? {} : []))));
});
afterEach(() => {
  cleanup(); client.clear(); vi.unstubAllGlobals();
  document.getElementById('station-bootstrap')?.remove();
  document.head.replaceChildren();
});

function bootstrap(station: Record<string, unknown> = seed, language = 'en') {
  document.body.insertAdjacentHTML('beforeend', renderStationBootstrap(station, language));
}
function mount() {
  return render(<QueryClientProvider client={client}><ServerSeoHeadContext.Provider value={true}>
    <StationDetails />
  </ServerSeoHeadContext.Provider></QueryClientProvider>);
}
function expectArticle() {
  expect(screen.getByRole('heading', { level: 1, name: seed.name })).toBeInTheDocument();
  expect(screen.getAllByText(article)).toHaveLength(1);
  expect(screen.queryByText('Station not found.')).not.toBeInTheDocument();
}

it.each(['canonical', 'percent-encoded'])(
  'uses one raw path for reviewed station body and metadata during %s navigation', async variant => {
    const content = REVIEWED_STATION_EDITORIALS.find(item => item.language === 'en')!;
    expect(content).toBeDefined();
    state.slug = content.slug;
    const rawPath = variant === 'canonical' ? content.path
      : content.path.slice(0, content.path.lastIndexOf('/') + 1)
        + `%${content.slug.charCodeAt(0).toString(16)}` + content.slug.slice(1);
    window.history.replaceState({}, '', rawPath);
    const record = { ...seed, _id: content.stationId, slug: content.slug,
      descriptions: { en: 'The broadcaster supplied this original overview.' } };
    const requested: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      if (String(url).startsWith('/api/seo/page-data?')) {
        const path = new URL(String(url), window.location.origin).searchParams.get('url')!;
        requested.push(path);
        const selected = getStationEditorial(record, 'en', path);
        return Response.json({ seoTags: { title: selected ? 'Reviewed station title' : 'Original station title',
          description: selected?.summary || record.descriptions.en, canonical: 'https://themegaradio.com' + content.path,
          robots: 'index, follow' }, structuredData: { global: [], page: [] } });
      }
      return Response.json(String(url).startsWith('/api/station/') ? record : []);
    });
    bootstrap(record);
    render(<QueryClientProvider client={client}><SeoPageWrapper><StationDetails /></SeoPageWrapper></QueryClientProvider>);
    await waitFor(() => expect(requested).toEqual([rawPath]));
    await waitFor(() => expect(document.title).toBe(variant === 'canonical' ? 'Reviewed station title' : 'Original station title'));
    if (variant === 'canonical') {
      expect(screen.getAllByText(content.summary)).toHaveLength(1);
      expect(screen.getByTestId('station-editorial')).toBeInTheDocument();
    } else {
      expect(screen.queryByTestId('station-editorial')).not.toBeInTheDocument();
      expect(screen.getAllByText(record.descriptions.en)).toHaveLength(1);
    }
    expect(window.location.pathname).toBe(rawPath);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://themegaradio.com' + content.path);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
  },
);

it.each(['old-fixture-radio', '68a8c482bd66579311ab2f5b'])(
  'retired locale keeps the historical %s address and real English article during enrichment', async identifier => {
    state.slug = identifier;
    const pathname = `/sv/station/${identifier}`;
    window.history.replaceState({}, '', pathname);
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    vi.mocked(fetch).mockImplementation((url: any) => url === `/api/station/${seed._id}`
      ? pending : Promise.resolve(Response.json([])));
    document.body.insertAdjacentHTML('beforeend', renderStationBootstrap(seed, 'en', identifier));
    mount();
    expectArticle();
    expect(window.location.pathname).toBe(pathname);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/station/'))).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(`/api/station/${seed._id}`, expect.anything());
    await act(async () => finish(Response.json({ ...seed, homepage: 'https://radio.invalid' })));
    await waitFor(expectArticle);
    expect(window.location.pathname).toBe(pathname);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://themegaradio.com/en/station/fixture-radio');
  },
);

it.each(['initial-shell', 'spa-navigation'])(
  'R6-03: %s resolves an old record through SSR identity before enrichment without bootstrap', async entry => {
    const old = { ...seed, _id: 'old-record-id', slug: 'old-record', name: 'Wrong retained duplicate', redirectToSlug: seed.slug };
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      if (String(url).startsWith('/api/seo/page-data?')) return Response.json({ stationIdentity: seed._id });
      if (url === `/api/station/${seed._id}` || url === `/api/station/${seed.slug}`) return Response.json(seed);
      if (url === '/api/station/old-record') return Response.json(old);
      return Response.json([]);
    });
    let view: ReturnType<typeof mount> | undefined;
    if (entry === 'spa-navigation') { view = mount(); await screen.findByRole('heading', { name: seed.name, level: 1 }); }
    state.slug = 'old-record';
    window.history.replaceState({}, '', '/sv/station/old-record');
    if (view) view.rerender(<QueryClientProvider client={client}><ServerSeoHeadContext.Provider value={true}>
      <StationDetails />
    </ServerSeoHeadContext.Provider></QueryClientProvider>);
    else mount();
    await waitFor(() => expect(client.getQueryData(['/api/station', 'retired', '/sv/station/old-record'])).toEqual(seed));
    expectArticle();
    expect(fetch).toHaveBeenCalledWith('/api/seo/page-data?url=%2Fsv%2Fstation%2Fold-record&slim=1', expect.anything());
    expect(fetch).toHaveBeenCalledWith(`/api/station/${seed._id}`, expect.anything());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/station/old-record')).toBe(false);
    expect(screen.queryByText(old.name)).not.toBeInTheDocument();
    expect(state.playStation).not.toHaveBeenCalled();
    expect(state.stopStation).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/sv/station/old-record');
  },
);

it.each([410, 503])('R6-03: failed identity resolution (%s) cannot fetch or render a retained duplicate', async status => {
  state.slug = 'old-record';
  window.history.replaceState({}, '', '/sv/station/old-record');
  vi.mocked(fetch).mockImplementation(async (url: any) => String(url).startsWith('/api/seo/page-data?')
    ? new Response('Unavailable', { status }) : Response.json([]));
  mount();
  await waitFor(() => expect(client.getQueryState(['/api/station', 'retired', '/sv/station/old-record'])?.status).toBe('error'));
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/station/'))).toBe(false);
  expect(screen.queryByText(article)).not.toBeInTheDocument();
});

it.each(['a', 'bad/fm', 'slug-owned-by-another-record'])('R6-04: a retired ID bootstrap enriches by verified ID, never stored slug %s', async slug => {
  const id = '68a8c482bd66579311ab2f5b';
  state.slug = id;
  window.history.replaceState({}, '', `/nl/station/${id}`);
  const station = { ...seed, _id: id, slug };
  document.body.insertAdjacentHTML('beforeend', renderStationBootstrap(station, 'en', id));
  vi.mocked(fetch).mockImplementation(async (url: any) => Response.json(url === `/api/station/${id}` ? station : []));
  mount();
  await waitFor(() => expect(client.getQueryData(['/api/station', 'retired', `/nl/station/${id}`])).toEqual(station));
  expectArticle();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/station/')).map(([url]) => url)).toEqual([`/api/station/${id}`]);
  expect(window.location.pathname).toBe(`/nl/station/${id}`);
});

it.each(INFORMATION_LANGUAGES)('%s: information page retains the real article with a neutral intro', language => {
  state.language = language;
  bootstrap({ ...seed, url: '', stationPageMode: 'information', isListVisible: false }, language);
  const view = mount();
  expectArticle();
  expect(view.container.querySelector('.station-intro')).toHaveTextContent(getStationInformationCopy(language, seed.name).intro);
  expect(view.container.querySelector('#station-stream-unavailable')).toHaveTextContent(getStationStreamUnavailableNotice(language, { stationPageMode: 'information' }));
  expect(state.playStation).not.toHaveBeenCalled();
});

it.each(INFORMATION_LANGUAGES)('%s: client navigation emits neutral information metadata', async language => {
  state.language = language;
  window.history.replaceState({}, '', `/${language}/station/${seed.slug}`);
  bootstrap({ ...seed, stationPageMode: 'information', isListVisible: false }, language);
  render(<QueryClientProvider client={client}><ServerSeoHeadContext.Provider value={false}>
    <StationDetails />
  </ServerSeoHeadContext.Provider></QueryClientProvider>);
  const copy = getStationInformationCopy(language, seed.name);
  await waitFor(() => expect(document.title).toContain(copy.title));
  expect(document.querySelector('meta[property="og:description"]')).toHaveAttribute('content', copy.description);
  expect(document.querySelector('meta[name="twitter:description"]')).toHaveAttribute('content', copy.description);
});

function mountRelated(language = 'en') {
  state.language = language;
  state.similar = [{ _id: 'related-id', slug: 'related-jazz', name: 'Related Jazz', country: 'Austria' }];
  state.country = [{ _id: 'country-id', name: 'Country News', country: 'Austria' }];
  bootstrap({ ...seed, country: 'Austria' }, language);
  mount();
}

it('retries a failed current station without pausing it and reports only on a deliberate click', async () => {
  state.language = 'de'; state.hasError = true; state.isPlaying = true; state.currentStation = seed;
  bootstrap(seed, 'de'); mount();
  expect(screen.getByRole('heading', { name: 'Wiedergabefehler' })).toBeInTheDocument();
  expect(screen.getByTestId('station-playback-error').parentElement).toHaveClass('isolate', 'min-h-[420px]', 'md:min-h-[340px]');
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/report-error'))).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' })); });
  expect(state.playStation).toHaveBeenCalledWith(expect.objectContaining({ _id: seed._id }));
  expect(state.pauseStation).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, errorId: 'fixture-report' }));
  fireEvent.click(screen.getByRole('button', { name: 'Problem melden' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Meldung gespeichert' })).toBeDisabled());
  const requests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/report-error'));
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0][1]!.body as string).stationId).toBe(seed._id);
});

it('does not show a report action for another station or a healthy player', () => {
  state.hasError = true; state.currentStation = { ...seed, _id: 'another-station' };
  bootstrap(); mount();
  expect(screen.queryByRole('button', { name: 'Report problem' })).not.toBeInTheDocument();
});

it('uses the existing related lists without fetching a redundant linked list or claiming media ownership', async () => {
  mountRelated();
  await act(async () => { finish(Response.json({ ...seed, country: 'Austria' })); });
  expect(client.getQueryState(['/api/stations', seed._id, 'linked', 'cards-v1'])).toBeUndefined();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/linked'))).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Media Group Radios' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Similar stations' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'More radio stations from Austria' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Related Jazz/ })).toHaveLength(1);
  expect(screen.getAllByRole('link', { name: /Country News/ })).toHaveLength(1);
  expect(state.playStation).not.toHaveBeenCalled();
  expectArticle();
});

it.each([
  { shape: 'envelope', payload: { stations: [{ _id: 'related-id', name: 'Related Jazz' }] } },
  { shape: 'legacy array', payload: [{ _id: 'related-id', name: 'Related Jazz' }] },
  { shape: 'empty envelope', payload: { stations: [] } },
  { shape: 'malformed envelope', payload: { stations: { length: 1 } } },
  { shape: 'unrelated object', payload: { data: 'not a station list' } },
  { shape: 'null', payload: null },
])('ignores $shape linked cache data without duplicating existing recommendations', async ({ payload }) => {
  const legacyKey = ['/api/stations', seed._id, 'linked'];
  const compactKey = [...legacyKey, 'cards-v1'];
  client.setQueryDefaults(legacyKey, { gcTime: 60_000 });
  client.setQueryData(legacyKey, payload);
  client.setQueryData(compactKey, payload);
  mountRelated();
  await act(async () => { finish(Response.json({ ...seed, country: 'Austria' })); });
  expect(client.getQueryData(legacyKey)).toEqual(payload);
  expect(client.getQueryData(compactKey)).toEqual(payload);
  expect(client.getQueryCache().find({ queryKey: compactKey, exact: true })?.getObserversCount()).toBe(0);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/linked'))).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Media Group Radios' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Related Jazz/ })).toHaveLength(1);
  expect(screen.getAllByRole('link', { name: /Country News/ })).toHaveLength(1);
  expectArticle();
});

it.each(['en', 'de', 'tr'])('keeps both related sections crawlable with localized %s links', language => {
  mountRelated(language);
  expect(screen.getByRole('link', { name: /Related Jazz/ })).toHaveAttribute('href', `/${language}/station/related-jazz`);
  expect(screen.getByRole('link', { name: /Country News/ })).toHaveAttribute('href', `/${language}/station/country-id`);
  for (const name of [/Related Jazz/, /Country News/]) {
    expect(screen.getByRole('link', { name }).querySelector('button')).toBeNull();
  }
  expect(state.playStation).not.toHaveBeenCalled();
});

it('preserves ordinary link activation and independent play controls', async () => {
  mountRelated();
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Related Jazz/ })); });
  expect(state.playStation).toHaveBeenCalledWith(state.similar[0]);
  expect(window.location.pathname).toBe('/en/station/related-jazz');
  const countryLink = screen.getByRole('link', { name: /Country News/ });
  const countryPlay = countryLink.parentElement!.querySelector('button')!;
  expect(countryPlay).not.toBeNull();
  await act(async () => { fireEvent.click(countryPlay); });
  expect(state.playStation).toHaveBeenLastCalledWith(state.country[0]);
  expect(window.location.pathname).toBe('/en/station/country-id');
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
  'does not hijack native modified link activation %j', modifiers => {
    mountRelated();
    const link = screen.getByRole('link', { name: /Related Jazz/ });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...modifiers });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(false);
    expect(state.playStation).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/en/station/fixture-radio');
  },
);

it('keeps the matching SSR article and head while the complete API request is slow', () => {
  bootstrap(); const head = document.head.innerHTML; mount();
  expectArticle();
  expect(document.head.innerHTML).toBe(head);
  expect(client.getQueryData(['/api/station/fixture-radio'])).toBeUndefined();
});

it('keeps the Ö3 summary above recommendations and all detailed editorial below both station lists', async () => {
  state.language = 'de'; state.slug = 'orf-hitradio-o3';
  window.history.replaceState({}, '', '/de/sender/orf-hitradio-o3');
  state.similar = [{ _id: 'related-id', slug: 'related-jazz', name: 'Related Jazz', country: 'Austria' }];
  state.country = [{ _id: 'country-id', name: 'Country News', country: 'Austria' }];
  const oe3 = { ...seed, _id: '68a8c483bd66579311ab2ffe', slug: state.slug, name: 'ORF Hitradio Ö3 | HQ', country: 'Austria', countryCode: 'AT' };
  const content = getStationEditorial(oe3, 'de')!;
  bootstrap(oe3, 'de'); mount();
  const editorial = screen.getByTestId('station-editorial');
  expect(editorial).toContainElement(screen.getByTestId('station-editorial-intro'));
  for (const paragraph of content.paragraphs) expect(screen.getByText(paragraph)).toBeInTheDocument();
  const summary = screen.getByText(content.summary);
  expect(screen.queryByText(article)).not.toBeInTheDocument();
  for (const name of [/Related Jazz/, /Country News/]) {
    const link = screen.getByRole('link', { name });
    expect(summary.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(editorial) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  await act(async () => { finish(Response.json({ ...oe3, descriptions: { de: 'Stored station description.' } })); });
  expect(screen.getAllByText(content.summary)).toHaveLength(1);
  expect(screen.queryByText('Stored station description.')).not.toBeInTheDocument();
  expect(state.playStation).not.toHaveBeenCalled();
});

it.each([
  { language: 'en', id: '68a8c483bd66579311ab2ffa', slug: 'orf-hitradio-o3' },
  { language: 'de', id: 'another-station', slug: 'fm4-orf' },
])('does not replace stored copy outside the German Ö3 pilot: $language $slug', ({ language, id, slug }) => {
  state.language = language; state.slug = slug;
  bootstrap({ ...seed, _id: id, slug }, language); mount();
  expect(screen.getAllByText(article)).toHaveLength(1);
  expect(screen.queryByTestId('station-editorial')).not.toBeInTheDocument();
  expect(state.playStation).not.toHaveBeenCalled();
});

it.each([408, 429, 500, 502, 503, 'network'] as const)('retains valid SSR content after a %s enrichment failure', async kind => {
  bootstrap(); const head = document.head.innerHTML; mount();
  expectArticle();
  await act(async () => {
    if (kind === 'network') fail(new TypeError('Failed to fetch'));
    else finish(new Response('Temporarily unavailable', { status: kind }));
  });
  await waitFor(() => expect(client.getQueryState(['/api/station/fixture-radio'])?.status).toBe('error'));
  expectArticle();
  expect(document.head.innerHTML).toBe(head);
  expect(client.getQueryData(['/api/station/fixture-radio'])).toBeUndefined();
});

it.each([400, 401, 403, 404, 410])('does not resurrect a station after an authoritative %s response', async status => {
  bootstrap(); mount();
  await act(async () => { finish(new Response('Gone', { status })); });
  await waitFor(() => expect(client.getQueryState(['/api/station/fixture-radio'])?.status).toBe('error'));
  expect(screen.queryByRole('heading', { level: 1, name: seed.name })).not.toBeInTheDocument();
  expect(screen.queryByText(article)).not.toBeInTheDocument();
});

it('replaces observer-only SSR data with the complete API record', async () => {
  bootstrap(); mount();
  const full = { ...seed, descriptions: { en: { full: 'Updated station article from the API.' } } };
  await act(async () => { finish(Response.json(full)); });
  await waitFor(() => expect(screen.getAllByText(full.descriptions.en.full)).toHaveLength(1));
  expect(screen.queryByText(article)).not.toBeInTheDocument();
  expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(full);
});

it('accepts a successful retry after retaining the SSR article through a failure', async () => {
  bootstrap(); mount();
  await act(async () => { finish(new Response('Temporarily unavailable', { status: 503 })); });
  await waitFor(() => expect(client.getQueryState(['/api/station/fixture-radio'])?.status).toBe('error'));
  expectArticle();
  const full = { ...seed, descriptions: { en: 'Recovered station article.' } };
  vi.mocked(fetch).mockResolvedValue(Response.json(full));
  await act(async () => { await client.refetchQueries({ queryKey: ['/api/station/fixture-radio'] }); });
  await waitFor(() => expect(screen.getAllByText(full.descriptions.en)).toHaveLength(1));
  expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(full);
});

it('does not change an SSR noindex decision or create alternates during an API outage', async () => {
  bootstrap();
  document.querySelector('meta[name="robots"]')!.setAttribute('content', 'noindex, follow');
  document.querySelector('link[hreflang]')!.remove();
  const head = document.head.innerHTML; mount();
  await act(async () => { finish(new Response('Temporarily unavailable', { status: 503 })); });
  await waitFor(() => expect(client.getQueryState(['/api/station/fixture-radio'])?.status).toBe('error'));
  expectArticle();
  expect(document.head.innerHTML).toBe(head);
});

it.each(['station', 'language'])('does not leak the SSR article to another %s during failed navigation', async kind => {
  bootstrap(); const view = mount();
  if (kind === 'station') state.slug = 'another-radio';
  else state.language = 'de';
  window.history.replaceState({}, '', `/${state.language}/station/${state.slug}`);
  view.rerender(<QueryClientProvider client={client}><ServerSeoHeadContext.Provider value={true}>
    <StationDetails />
  </ServerSeoHeadContext.Provider></QueryClientProvider>);
  await act(async () => { finish(new Response('Temporarily unavailable', { status: 503 })); });
  await waitFor(() => expect(client.getQueryState([`/api/station/${state.slug}`])?.status).toBe('error'));
  expect(screen.queryByText(article)).not.toBeInTheDocument();
});

it('renders the legacy description used by SSR instead of replacing it with generic copy', async () => {
  mount();
  await act(async () => { finish(Response.json({ ...seed, descriptions: {}, description: article })); });
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: seed.name })).toBeInTheDocument());
  expect(screen.getAllByText(article)).toHaveLength(1);
});

it('uses the factual English fallback in the visible article when stored prose is missing or malformed', async () => {
  const station = { ...seed, country: 'Austria', countryCode: 'AT', tags: 'news',
    descriptions: { en: { full: 42, meta: false } } };
  mount();
  await act(async () => { finish(Response.json(station)); });
  await waitFor(() => expect(screen.getAllByText(buildTemplateDescription(station).full)).toHaveLength(1));
  expect(screen.queryByText(/You are now listening/)).not.toBeInTheDocument();
});

it('does not replace the localized SSR legacy article with an unrelated English fallback', async () => {
  state.language = 'de';
  window.history.replaceState({}, '', '/de/sender/fixture-radio');
  mount();
  const localized = 'Dieser Sender bietet Nachrichten und Interviews aus der Region.';
  await act(async () => { finish(Response.json({ ...seed, description: localized })); });
  await waitFor(() => expect(screen.getAllByText(localized)).toHaveLength(1));
  expect(screen.queryByText(article)).not.toBeInTheDocument();
});

it('keeps a slow request without SSR data in loading state, not station-not-found', () => {
  mount();
  expect(screen.getByText('Loading station...')).toBeInTheDocument();
  expect(screen.queryByText('Station not found.')).not.toBeInTheDocument();
});

it('does not turn an API outage without matching SSR data into a station-not-found message', async () => {
  bootstrap({ ...seed, slug: 'another-radio' }); mount();
  await act(async () => { finish(new Response('Temporarily unavailable', { status: 503 })); });
  expect(await screen.findByText('Connection error. Please try again.')).toBeInTheDocument();
  expect(screen.queryByText('Station not found.')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: seed.name })).not.toBeInTheDocument();
});

it('renders the entire original article once before any More interaction', () => {
  const finalSentence = 'The distinctive final programme detail is available without a click.';
  const full = `${'Station-specific programme information. '.repeat(20)}${finalSentence}`;
  bootstrap({ ...seed, descriptions: { en: full } }); mount();
  const paragraphs = screen.getAllByText(full);
  expect(paragraphs).toHaveLength(1);
  expect(full.indexOf(finalSentence)).toBeGreaterThan(470);
  expect(paragraphs[0].textContent).toBe(full);
  expect(paragraphs[0]).toHaveClass('line-clamp-3');
  expect(paragraphs[0]).not.toHaveClass('hidden');
  expect(paragraphs[0]).not.toHaveClass('md:hidden');
  expect(paragraphs[0]).not.toHaveAttribute('aria-hidden');
});

it('prefers the current locale full article over both legacy and English content', async () => {
  state.language = 'de';
  window.history.replaceState({}, '', '/de/sender/fixture-radio');
  const local = 'Das vollstaendige lokale Programm mit Nachrichten und Interviews.';
  mount();
  await act(async () => { finish(Response.json({ ...seed,
    description: 'Legacy text should not replace the local article.',
    descriptions: { en: article, de: { full: local, meta: 'Only metadata, not the article.' } },
  })); });
  await waitFor(() => expect(screen.getAllByText(local)).toHaveLength(1));
  expect(screen.queryByText(article)).not.toBeInTheDocument();
  expect(screen.queryByText('Legacy text should not replace the local article.')).not.toBeInTheDocument();
  expect(screen.queryByText('Only metadata, not the article.')).not.toBeInTheDocument();
});

it.each([
  { language: 'de', description: 'Legacy programme detail.',
    descriptions: { de: { full: '[FULL DESCRIPTION - 200-300 words]' }, en: article }, expected: 'Legacy programme detail.' },
  { language: 'tr', description: '[FULL DESCRIPTION - 200-300 words]',
    descriptions: { tr: ' \n[FULL DESCRIPTION - 200-300 words]\n', en: { full: article } }, expected: article },
  { language: 'de', description: 'Legacy programme detail.',
    descriptions: { de: { full: 'Local programme detail.' }, en: article }, expected: 'Local programme detail.' },
  { language: 'en', description: 'Legacy programme detail.',
    descriptions: {}, expected: 'Legacy programme detail.' },
  { language: 'de', description: '[Import note] [FULL DESCRIPTION] Programme for {STATION_NAME}.',
    descriptions: { de: '[TRANSLATED FULL DESCRIPTION]', en: '[TRANSLATED META DESCRIPTION]' }, expected: 'Programme for Fixture Radio.' },
])('keeps cleaned $language article parity from real SSR bootstrap through API enrichment', async row => {
  state.language = row.language;
  window.history.replaceState({}, '', `/${row.language}/station/${seed.slug}`);
  const station = { ...seed, description: row.description, descriptions: row.descriptions };
  bootstrap(station, row.language);
  const head = document.head.innerHTML;
  mount();
  expect(screen.getAllByText(row.expected)).toHaveLength(1);
  expect(client.getQueryData(['/api/station/fixture-radio'])).toBeUndefined();
  await act(async () => { finish(Response.json(station)); });
  await waitFor(() => expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(station));
  expect(screen.getAllByText(row.expected)).toHaveLength(1);
  expect(document.head.innerHTML).toBe(head);
});

it.each(['en', 'de', 'tr'])('uses the same factual English template for missing %s prose before and after enrichment', async language => {
  state.language = language;
  window.history.replaceState({}, '', `/${language}/station/${seed.slug}`);
  const station = { ...seed, country: 'Unknown', countryCode: 'DE', tags: 'news',
    description: '[FULL DESCRIPTION - 200-300 words]',
    descriptions: { en: '[FULL DESCRIPTION - 200-300 words]' } };
  const expected = buildTemplateDescription({ ...station, country: 'Germany' }).full;
  bootstrap(station, language);
  mount();
  expect(screen.getAllByText(expected)).toHaveLength(1);
  await act(async () => { finish(Response.json(station)); });
  await waitFor(() => expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(station));
  expect(screen.getAllByText(expected)).toHaveLength(1);
  expect(screen.queryByText(/HD quality|You are now listening|Şu anda/)).not.toBeInTheDocument();
});

it.each(['en', 'de', 'tr'])('does not invent an article for sparse %s metadata', async language => {
  state.language = language;
  window.history.replaceState({}, '', `/${language}/station/${seed.slug}`);
  const station = { ...seed, descriptions: {} };
  bootstrap(station, language);
  const view = mount();
  expect(view.container.querySelector('p.line-clamp-3')).toBeEmptyDOMElement();
  await act(async () => { finish(Response.json(station)); });
  await waitFor(() => expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(station));
  expect(view.container.querySelector('p.line-clamp-3')).toBeEmptyDOMElement();
  expect(screen.queryByText(/HD quality|You are now listening|Şu anda|is listed as a radio station/)).not.toBeInTheDocument();
});

it('preserves the long legacy tail as safe React text in both the real bootstrap and full API render', async () => {
  state.language = 'de';
  window.history.replaceState({}, '', `/de/station/${seed.slug}`);
  const tail = 'Literal </script><script>window.articleExecuted = true</script> & final programme detail.';
  const prose = `${'Legacy programme information. '.repeat(100)}${tail}`;
  const station = { ...seed, description: `[FULL DESCRIPTION - 200-300 words]\n${prose}` };
  bootstrap(station, 'de');
  mount();
  const paragraph = screen.getByText(prose);
  expect(paragraph.textContent).toBe(prose);
  expect(paragraph).toHaveClass('line-clamp-3');
  expect(paragraph.querySelector('script')).toBeNull();
  expect(document.querySelectorAll('#station-bootstrap')).toHaveLength(1);
  await act(async () => { finish(Response.json(station)); });
  await waitFor(() => expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(station));
  expect(screen.getByText(prose).textContent).toBe(prose);
  expect(screen.getByText(prose).querySelector('script')).toBeNull();
});

it('substitutes placeholder names with literal dollar tokens after removing SSR marker prefixes', async () => {
  state.language = 'de';
  window.history.replaceState({}, '', `/de/station/${seed.slug}`);
  const station = { ...seed, name: "Cash $& $$ $` $' $1 FM", description: '[TRANSLATED META DESCRIPTION]',
    descriptions: { de: { full: '[Import note] [TRANSLATED FULL DESCRIPTION] Programme for {STATION_NAME}. Next: {STATION_NAME}.' } } };
  const expected = `Programme for ${station.name}. Next: ${station.name}.`;
  bootstrap(station, 'de');
  mount();
  expect(screen.getByText(expected).textContent).toBe(expected);
  await act(async () => { finish(Response.json(station)); });
  await waitFor(() => expect(client.getQueryData(['/api/station/fixture-radio'])).toEqual(station));
  expect(screen.getByText(expected).textContent).toBe(expected);
});
