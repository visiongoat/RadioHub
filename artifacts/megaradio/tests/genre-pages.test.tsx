import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import { GENRE_STATIONS_PAGE_SIZE, MAX_GENRE_DIRECTORY_PAGE } from '@workspace/seo-shared/seo-config';
import GenresPage from '@/pages/genres';
import GenreLanding from '@/pages/genres/genre-landing';
import { parseGenreDirectoryPage, parseGenrePage, useGenrePagination } from '@/hooks/useGenrePageState';
import { getGenrePageLabels } from '@/utils/genre-page-labels';

const fixture = vi.hoisted(() => ({ language: 'de', error: false, empty: false, metadataError: false, responsePage: null as number | null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: fixture.language, localeTranslations: {}, t: (key: string) => key,
}) }));
vi.mock('@/hooks/useSeoRouting', async () => {
  const { translateUrl } = await import('@workspace/seo-shared/url-translations');
  return { useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/${fixture.language}${translateUrl(path, fixture.language)}` }) };
});
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station }: any) => <div data-testid="station-card">{station.name}</div> }));
vi.mock('swiper/react', () => ({ Swiper: ({ children }: any) => <div>{children}</div>, SwiperSlide: ({ children }: any) => <div>{children}</div> }));
vi.mock('swiper/modules', () => ({ FreeMode: {} }));

let client: QueryClient;
let requests: URL[];
function visit(url: string) {
  act(() => { window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function backTo(url: string) {
  // Browser popstate/query-only navigation, without any component click handler.
  act(() => { window.history.replaceState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function wrap(children: React.ReactNode) {
  return <QueryClientProvider client={client}><Router>{children}</Router></QueryClientProvider>;
}
function listing(country = 'Austria') { return wrap(<GenresPage selectedCountry={country} />); }
function detail(country = localStorage.getItem('selectedCountry') || 'Austria') { return wrap(<Route path="/:lang/:section/:slug"><GenreLanding selectedCountry={country} /></Route>); }
const listCalls = () => requests.filter(url => url.pathname === '/api/genres/precomputed' && url.searchParams.get('limit') !== '5');
const detailCalls = () => requests.filter(url => url.pathname.endsWith('/stations'));

beforeEach(() => {
  fixture.language = 'de'; fixture.error = false; fixture.empty = false; fixture.metadataError = false;
  fixture.responsePage = null;
  localStorage.clear();
  requests = [];
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, window.location.origin); requests.push(url);
    if (fixture.error || (fixture.metadataError && url.pathname.includes('/slug/'))) return { ok: false, status: 503, json: async () => ({}) };
    if (url.pathname.includes('/slug/')) return { ok: true, json: async () => ({ name: 'Jazz', slug: 'jazz' }) };
    const page = Number(url.searchParams.get('page') || 1);
    const country = url.searchParams.get('countryName') || url.searchParams.get('country') || 'global';
    if (url.pathname.endsWith('/stations')) return { ok: true, json: async () => ({
      stations: fixture.empty ? [] : Array.from({ length: page === 10 ? 13 : 15 }, (_, index) => ({
        _id: `${country}-${page}-${index}`, name: `Station ${country} ${page}${index ? ` #${index}` : ''}`,
      })),
      total: fixture.empty ? 0 : 148, page: fixture.responsePage ?? page, pages: fixture.empty ? 0 : 10,
    }) };
    return { ok: true, json: async () => ({ data: fixture.empty ? [] : [{
      _id: `${country}-${page}`, slug: `fixture-${country}-${page}`, name: `Genre ${country} ${page}`, stationCount: 3,
    }], count: fixture.empty ? 0 : 270, totalPages: fixture.empty ? 0 : 10 }) };
  }));
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0,
    queryFn: async ({ queryKey }) => {
      const response = await fetch(String(queryKey[0]));
      if (!response.ok) throw new Error('Failed');
      return response.json();
    },
  } } });
  visit('/de/genres');
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('genre URL pagination', () => {
  it.each(['', '?page=0', '?page=-1', '?page=foo', '?page=1.5', '?page=2&page=3', '?page=999999999999999999'])('bounds invalid page %s to 1', value => {
    expect(parseGenrePage(value)).toBe(1);
  });
  it('accepts a deep positive page', () => expect(parseGenrePage('?page=51')).toBe(51));
  it('bounds only detail pages at the shared maximum without changing hub parsing', () => {
    expect(parseGenreDirectoryPage(`?page=${MAX_GENRE_DIRECTORY_PAGE}`)).toEqual({ page: MAX_GENRE_DIRECTORY_PAGE, valid: true });
    expect(parseGenreDirectoryPage(`?page=${MAX_GENRE_DIRECTORY_PAGE + 1}`)).toEqual({ page: 1, valid: false });
    expect(parseGenrePage(`?page=${MAX_GENRE_DIRECTORY_PAGE + 1}`)).toBe(MAX_GENRE_DIRECTORY_PAGE + 1);
  });

  it('keeps initial deep page, click URL, unrelated query/hash, and back/forward state', async () => {
    visit('/de/genres?page=3&source=test#grid');
    render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
    expect(listCalls().every(url => url.searchParams.get('page') === '3')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await screen.findByRole('heading', { name: 'Genre Austria 4' });
    expect(window.location.search).toBe('?page=4&source=test');
    expect(window.location.hash).toBe('#grid');
    backTo('/de/genres');
    await screen.findByRole('heading', { name: 'Genre Austria 1' });
    backTo('/de/genres?page=3');
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
  });

  it('resets country/search filters immediately, without a stale high-page request', async () => {
    visit('/de/genres?page=4');
    const view = render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 4' });
    view.rerender(listing('Germany'));
    await screen.findByRole('heading', { name: 'Genre Germany 1' });
    expect(listCalls().filter(url => url.searchParams.get('countryName') === 'Germany').every(url => url.searchParams.get('page') === '1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await screen.findByRole('heading', { name: 'Genre Germany 3' });
    fireEvent.change(screen.getByPlaceholderText('search_genre'), { target: { value: 'Jazz' } });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('search')).toBe('Jazz'));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
    expect(window.location.search).not.toContain('page');
  });

  it('uses distinct 9/27 caches and resets on responsive page-size changes', async () => {
    visit('/de/genres?page=3');
    render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
    act(() => { Object.defineProperty(window, 'innerWidth', { value: 375 }); window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('limit')).toBe('9'));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
    const keys = client.getQueryCache().findAll({ queryKey: ['/api/genres/precomputed'] }).map(query => query.queryKey.at(-1));
    // The current observer must be attached to the mobile key, never the stale desktop response.
    expect(keys).toContain(9);
    act(() => { Object.defineProperty(window, 'innerWidth', { value: 1024 }); window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('limit')).toBe('27'));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
  });

  it.each([
    ['tr', 'Caz', 'jazz'], ['tr', 'Klasik', 'classical'],
    ['de', 'Klassik', 'classical'], ['de', 'Nachrichten', 'news'],
    ['tr', 'Jazz', 'Jazz'], ['tr', 'jazz', 'jazz'], ['tr', 'Rare Style', 'Rare Style'],
  ])('searches the canonical catalogue for %s displayed name %s', async (language, input, expected) => {
    fixture.language = language;
    visit(`/${language}/genres?page=3`);
    render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
    fireEvent.change(screen.getByPlaceholderText('search_genre'), { target: { value: input } });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('search')).toBe(expected));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
    expect(screen.getByPlaceholderText('search_genre')).toHaveValue(input);
    expect(client.getQueryCache().findAll({ queryKey: ['/api/genres/precomputed'] })
      .some(query => query.queryKey[2] === expected)).toBe(true);
  });

  it('does not reset an explicitly paginated new genre route', () => {
    function Probe() { const state = useGenrePagination(window.location.pathname); return <div>Page {state.currentPage}</div>; }
    visit('/de/genres/rock?page=3');
    render(wrap(<Probe />));
    expect(screen.getByText('Page 3')).toBeInTheDocument();
    visit('/de/genres/jazz?page=2');
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });
});

describe('genre detail and localized states', () => {
  it('loads saved-country page two globally, with real hrefs, reload and browser back/forward', async () => {
    localStorage.setItem('selectedCountry', 'Austria');
    visit('/de/genres/jazz?page=2&source=test#grid');
    const view = render(detail());
    await screen.findByText('Station global 2');
    expect(screen.getAllByTestId('station-card')).toHaveLength(GENRE_STATIONS_PAGE_SIZE);
    expect(detailCalls().every(url => url.searchParams.get('page') === '2' && !url.searchParams.has('country') && url.searchParams.get('limit') === String(GENRE_STATIONS_PAGE_SIZE))).toBe(true);
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '/de/genres/jazz?source=test#grid');
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '/de/genres/jazz?page=3&source=test#grid');
    fireEvent.click(screen.getByRole('link', { name: '3' }));
    await screen.findByText('Station global 3');
    expect(window.location.search).toBe('?page=3&source=test');
    expect(window.location.hash).toBe('#grid');
    act(() => window.history.back());
    await screen.findByText('Station global 2');
    act(() => window.history.forward());
    await screen.findByText('Station global 3');
    fireEvent.click(screen.getByRole('link', { name: '1' }));
    await screen.findByText('Station global 1');
    expect(window.location.search).toBe('?source=test');
    act(() => window.history.back());
    await screen.findByText('Station global 3');
    view.unmount(); client.clear();
    render(detail());
    await screen.findByText('Station global 3');
    expect(detailCalls().every(url => !url.searchParams.has('country'))).toBe(true);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('leaves modified/middle page clicks to the browser: %j', async modifiers => {
    visit('/de/genres/jazz?page=2'); render(detail());
    await screen.findByText('Station global 2');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers });
    // Observe the application's defaultPrevented value, then suppress jsdom navigation.
    let prevented: boolean | undefined;
    const observe = (event: Event) => { prevented = event.defaultPrevented; event.preventDefault(); };
    window.addEventListener('click', observe, { once: true });
    act(() => screen.getByRole('link', { name: '3' }).dispatchEvent(event));
    expect(prevented).toBe(false);
    expect(window.location.search).toBe('?page=2');
    expect(detailCalls()).toHaveLength(1);
  });

  it('returns a changed personal filter to the base URL and keeps its pagination local', async () => {
    visit('/de/genres/jazz?page=4&source=test#grid');
    const view = render(detail());
    await screen.findByText('Station global 4');
    view.rerender(detail('Germany'));
    await screen.findByText('Station Germany 1');
    expect(detailCalls().filter(url => url.searchParams.get('country') === 'Germany').every(url => url.searchParams.get('page') === '1')).toBe(true);
    expect(window.location.search).toBe('?source=test');
    expect(window.location.hash).toBe('#grid');
    expect(screen.queryByRole('link', { name: '2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await screen.findByText('Station Germany 2');
    expect(window.location.search).toBe('?source=test');
    view.rerender(detail('Austria'));
    await screen.findByText('Station Austria 1');
    expect(detailCalls().filter(url => url.searchParams.get('country') === 'Austria').every(url => url.searchParams.get('page') === '1')).toBe(true);
    view.rerender(detail('all'));
    await screen.findByText('Station global 1');
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('href', '/de/genres/jazz?source=test&page=2#grid');
    expect(window.location.search).not.toContain('country');
  });

  it('keeps initial personal page one local, but an explicit pageN navigation is global', async () => {
    visit('/de/genres/jazz'); render(detail());
    await screen.findByText('Station Austria 1');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await screen.findByText('Station Austria 2');
    expect(window.location.search).toBe('');
    backTo('/de/genres/jazz?page=2');
    await screen.findByText('Station global 2');
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '/de/genres/jazz?page=3');
  });

  it.each(['personal-first', 'global-first'])('isolates cached global and personal page-two slices: %s', async order => {
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, gcTime: 5 * 60 * 1000 } });
    visit(order === 'personal-first' ? '/de/genres/jazz' : '/de/genres/jazz?page=2');
    const view = render(detail());
    if (order === 'personal-first') {
      await screen.findByText('Station Austria 1');
    } else {
      await screen.findByText('Station global 2');
      view.rerender(detail('Germany'));
      await screen.findByText('Station Germany 1');
    }
    const country = order === 'personal-first' ? 'Austria' : 'Germany';
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await screen.findByText(`Station ${country} 2`);
    backTo('/de/genres/jazz?page=2');
    expect(screen.queryByText(`Station ${country} 2`)).not.toBeInTheDocument();
    await screen.findByText('Station global 2');
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
    const slices = client.getQueryCache().findAll().filter(query => String(query.queryKey[0]).endsWith('/stations'));
    expect(slices.some(query => query.queryKey[2] === 'all' && (query.queryKey[1] as any).page === 2)).toBe(true);
    expect(slices.some(query => query.queryKey[2] === country && (query.queryKey[1] as any).page === 2)).toBe(true);
  });

  it('preserves the public page and 15-card request when pagination switches to mobile', async () => {
    visit('/de/genres/jazz?page=6'); render(detail());
    await screen.findByText('Station global 6');
    act(() => { Object.defineProperty(window, 'innerWidth', { value: 375 }); window.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('link', { name: '6' })).toHaveAttribute('aria-current', 'page');
    const labels = getGenrePageLabels('de');
    expect(screen.getByRole('link', { name: labels.previous })).toHaveAttribute('href', '/de/genres/jazz?page=5');
    expect(screen.getByRole('link', { name: labels.next })).toHaveAttribute('href', '/de/genres/jazz?page=7');
    expect(detailCalls()).toHaveLength(1);
    expect(detailCalls()[0].searchParams.get('limit')).toBe(String(GENRE_STATIONS_PAGE_SIZE));
    expect(window.location.search).toBe('?page=6');
  });

  it('uses explicit URL-country scope for public pages despite a different saved country', async () => {
    visit('/dz/genres/jazz?page=2'); const view = render(detail());
    await screen.findByText('Station Algeria 2');
    expect(detailCalls()[0].searchParams.get('country')).toBe('Algeria');
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '/dz/genres/jazz?page=3');
    view.rerender(detail('Germany'));
    await screen.findByText('Station Germany 1');
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await screen.findByText('Station Germany 2');
    expect(window.location.search).toBe('');
  });

  it('keeps the native last page and its disabled next arrow instead of clamping to page one', async () => {
    visit('/de/genres/jazz?page=10'); render(detail());
    await screen.findByText('Station global 10');
    expect(screen.getAllByTestId('station-card')).toHaveLength(13);
    const labels = getGenrePageLabels('de');
    expect(screen.getByRole('button', { name: labels.next })).toBeDisabled();
    expect(screen.getByRole('link', { name: labels.previous })).toHaveAttribute('href', '/de/genres/jazz?page=9');
    expect(screen.getByRole('link', { name: '10' })).toHaveAttribute('aria-current', 'page');
    expect(window.location.search).toBe('?page=10');
  });

  it.each(['', '0', '-1', 'foo', '1.5', '2&page=3', '%2532', String(MAX_GENRE_DIRECTORY_PAGE + 1), '999999999999999999'])('does not fetch another slice for invalid public page %s', async page => {
    visit(`/de/genres/jazz?page=${page}`); render(detail());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(detailCalls()).toHaveLength(0);
    expect(screen.queryByTestId('station-card')).not.toBeInTheDocument();
  });

  it.each(['0002', '%32'])('normalizes numeric page %s exactly once, matching native/SSR pagination', async page => {
    visit(`/de/genres/jazz?page=${page}`); render(detail());
    await screen.findByText('Station global 2');
    expect(detailCalls()[0].searchParams.get('page')).toBe('2');
    expect(detailCalls()[0].searchParams.has('country')).toBe(false);
  });

  it('rejects a mismatched API page without publishing that slice under pageN', async () => {
    fixture.responsePage = 1;
    visit('/de/genres/jazz?page=2'); render(detail());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('station-card')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?page=2');
    expect(client.getQueryCache().findAll().filter(query => String(query.queryKey[0]).endsWith('/stations')).every(query => query.state.data === undefined)).toBe(true);
  });

  it('never sends the global sentinel as a literal station country', async () => {
    visit('/de/genres/jazz'); render(detail('global'));
    await screen.findByText('Station global 1');
    expect(detailCalls()[0].searchParams.has('country')).toBe(false);
  });

  it.each(['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'])('%s: localized heading and canonical genre breadcrumb', async code => {
    fixture.language = code;
    const genresUrl = `/${code}${translateUrl('/genres', code)}`;
    visit(`${genresUrl}/jazz`); render(detail());
    const labels = getGenrePageLabels(code);
    expect(await screen.findByRole('heading', { level: 1, name: genreDisplayName({slug: 'jazz'}, code) })).toBeInTheDocument();
    const breadcrumbs = screen.getAllByRole('navigation', { name: 'breadcrumb' });
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0].querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: labels.genres })).toHaveAttribute('href', genresUrl);
  });

  it('shows real empty genres instead of an endless popular skeleton', async () => {
    fixture.empty = true; const view = render(listing());
    await waitFor(() => expect(screen.getAllByText('Keine Genres gefunden.')).toHaveLength(2));
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a localized list error and a functional retry, not a false empty result', async () => {
    fixture.error = true; render(listing());
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.queryByText('Keine Genres gefunden.')).not.toBeInTheDocument();
    fixture.error = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Erneut versuchen' })[1]);
    await screen.findByRole('heading', { name: 'Genre Austria 1' });
  });

  it('distinguishes an empty detail result from a metadata/station request failure', async () => {
    visit('/de/genres/jazz'); fixture.empty = true;
    const view = render(detail());
    await screen.findByText('Keine Sender gefunden.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount(); client.clear(); fixture.empty = false; fixture.metadataError = true;
    render(detail());
    expect(await screen.findByRole('alert')).toHaveTextContent('Dieser Inhalt konnte nicht geladen werden.');
    expect(screen.queryByText('Keine Sender gefunden.')).not.toBeInTheDocument();
    fixture.metadataError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Station Austria 1');
  });
});
