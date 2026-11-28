import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ inView: true, recentlyLoading: false }));
const recentStation = { _id: 'recent', name: 'Recent Radio', country: 'Germany' };
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: 'en', localeTranslations: {},
  t: (key: string, fallback?: string) => fallback ?? ({ homepage_community_favorites: 'Community Favorites' }[key] ?? key),
}) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({
  currentLanguage: 'en', getLocalizedUrl: (path: string) => `/en${path}`,
  navigateTranslated: vi.fn(), navigateWithLanguage: vi.fn(),
}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { _id: 'listener' }, isAuthenticated: true }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({
  currentStation: null, isPlaying: false, favorites: [], playStation: vi.fn(), stopStation: vi.fn(),
}) }));
vi.mock('@/hooks/useRecentlyPlayed', () => ({ useRecentlyPlayed: () => ({
  recentlyPlayed: state.recentlyLoading ? [] : [recentStation],
  hasRecentlyPlayed: !state.recentlyLoading, isLoading: state.recentlyLoading,
}) }));
vi.mock('@/hooks/useAvailableStationSnapshots', () => ({ useAvailableStationSnapshots: (stations: unknown[]) => stations }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/favorite-button', () => ({ default: () => null }));
vi.mock('@/components/ui/station-logo', () => ({ StationLogo: () => null }));
vi.mock('@/components/ui/public-profile-avatar', () => ({ PublicProfileAvatar: () => null }));
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
vi.mock('@/components/seo/ListStructuredData', () => ({ default: () => null }));
vi.mock('@/components/HomeHeroPicture', () => ({ default: () => null }));
// The signup banner is independently owned; keep this contract scoped to catalog headings.
vi.mock('@/components/HomeSignupBanner', () => ({ default: () => null }));
vi.mock('@/components/ui/in-view', () => ({ InView: ({ children, className }: any) =>
  <div className={className}>{children(state.inView)}</div> }));
vi.mock('swiper/react', () => ({
  Swiper: ({ children, className }: any) => <div className={className}>{children}</div>,
  SwiperSlide: ({ children, className, style }: any) => <div className={className} style={style}>{children}</div>,
}));

import RadioFrontend from '@/pages/radio-frontend';
import StationCard from '@/components/ui/station-card';
import DiscoverableGenreSlider from '@/components/DiscoverableGenreSlider';
import PopularStationsSection from '@/components/PopularStationsSection';

const station = { _id: 'catalog', name: 'Catalog Radio', slug: 'catalog-radio', country: 'Germany' };
const genre = { _id: 'rock', name: 'Rock', slug: 'rock' };
const discoverGenre = { _id: 'discovery', name: 'Discovery Jazz', slug: 'discovery-jazz' };
const profile = { _id: 'community-listener', displayName: 'Community Listener', favoritesCount: 3 };
const stationHeadingClass = 'text-base md:text-[20px] font-medium text-white truncate leading-[20px] md:leading-[23px]';
let client: QueryClient;

beforeEach(() => {
  state.inView = true;
  state.recentlyLoading = false;
  vi.useFakeTimers();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: Infinity, staleTime: Infinity, queryFn: () => new Promise(() => {}),
  } } });
  const page = { stations: [station], pagination: { total: 1, pages: 1 } };
  client.setQueryData(['/api/stations/precomputed', 'all', 1], page);
  client.setQueryData(['/api/stations/precomputed', 'all', 'extended'], page);
  client.setQueryData(['/api/genres/precomputed', 'all'], { data: [genre] });
  client.setQueryData(['/api/genres/discoverable'], [discoverGenre]);
  client.setQueryData(['/api/public-profiles'], { data: [profile] });
  client.setQueryData(['/api/user/favorites', { sort: 'newest' }], {
    stations: [{ ...station, _id: 'favorite', name: 'Favorite Radio' }],
  });
  client.setQueryData(['/api/location'], { location: { country: 'Germany' } });
  client.setQueryData(['/api/stations/nearby', 'all', null, true, 'Germany'], {
    stations: [{ ...station, _id: 'nearby', name: 'Nearby Radio' }],
  });
  client.setQueryData(['/api/countries'], []);
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(children: React.ReactNode = <RadioFrontend />) {
  const location = memoryLocation({ path: '/en' });
  return render(<QueryClientProvider client={client}><Router hook={location.hook}>{children}</Router></QueryClientProvider>);
}

const sectionHeading = (name: string) => screen.getByRole('heading', { level: 2, name, exact: true });

it('renders one hero H1, H2 catalog sections and H3 genre, station and community items', () => {
  const { container } = mount();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveClass('home-hero-title');
  const sections = [
    ['Genres', 'section-header'],
    ['Recently Played', 'section-header'],
    ['Popular Stations', 'section-header'],
    ['Stations Near You', 'section-header pb-5 md:pb-[30px]'],
    ['Your Favorites', 'section-header flex items-center space-x-2'],
    ['Discover Genres', 'section-header pb-4'],
    ['Community Favorites', 'section-header'],
    ['All Stations', 'section-header flex flex-wrap items-baseline gap-x-2 pb-5 md:pb-[30px]'],
  ];
  for (const [name, className] of sections) expect(sectionHeading(name)).toHaveAttribute('class', className);

  for (const name of ['Catalog Radio', 'Recent Radio', 'Nearby Radio', 'Favorite Radio']) {
    for (const heading of screen.getAllByRole('heading', { level: 3, name })) {
      expect(heading).toHaveAttribute('class', stationHeadingClass);
      expect(heading.closest('.home-station-grid')).toBeInTheDocument();
      expect(heading.closest('.group')).toHaveClass('h-[102px]', 'lg:h-[130px]', 'p-3', 'lg:p-[20px]');
    }
  }
  expect(screen.getAllByRole('heading', { level: 3, name: 'Catalog Radio' })).toHaveLength(2);
  expect(screen.getByRole('heading', { level: 3, name: 'Community Listener' }))
    .toHaveAttribute('class', 'text-base md:text-lg font-medium text-white truncate');
  const rock = screen.getByRole('heading', { level: 3, name: 'Rock' });
  expect(rock).toHaveClass('home-genre-title');
  expect(rock.closest('.home-genre-tile')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Discovery Jazz' }))
    .toHaveAttribute('class', 'font-bold text-white leading-tight drop-shadow-lg');
  expect(container.querySelector('h4, h5, h6')).toBeNull();

  const faq = screen.getByTestId('home-faq');
  const guide = screen.getByTestId('home-station-guide');
  expect(within(faq).getByRole('heading', { level: 2 })).toHaveClass('section-header');
  expect(within(guide).getByRole('heading', { level: 2 })).toHaveClass('section-header');
  expect(within(guide).getByRole('link', { name: 'ORF Hitradio Ö3 station guide (in German)' }))
    .toHaveAttribute('href', '/de/sender/orf-hitradio-o3');
  expect(guide.previousElementSibling).toHaveClass('container', 'pb-6');
  expect(faq.previousElementSibling).toBe(guide);
  expect(faq).toBe(faq.parentElement?.lastElementChild);
});

it('keeps recently played, discovery and community viewport/loading placeholders at H2 with their original classes', () => {
  state.inView = false;
  state.recentlyLoading = true;
  const { container } = mount();
  expect(sectionHeading('Recently Played')).toHaveAttribute('class', 'section-header');
  expect(sectionHeading('Discover Genres')).toHaveAttribute('class', 'section-header pb-4');
  expect(sectionHeading('Community Favorites')).toHaveAttribute('class', 'section-header pb-4');
  expect(sectionHeading('Popular Stations')).toHaveClass('section-header');
  expect(screen.queryByRole('heading', { name: 'Community Listener' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Discovery Jazz' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Recent Radio' })).toBeNull();
  expect(container.querySelectorAll('.animate-pulse')).toHaveLength(17);
  expect(container.querySelector('h4, h5, h6')).toBeNull();
});

it('keeps the in-view community request placeholder at the same H2 level as the data state', () => {
  client.removeQueries({ queryKey: ['/api/public-profiles'] });
  mount();
  expect(sectionHeading('Community Favorites')).toHaveAttribute('class', 'section-header pb-4');
  expect(screen.queryByRole('heading', { name: 'Community Listener' })).toBeNull();
  expect(sectionHeading('Community Favorites').parentElement?.nextElementSibling)
    .toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'gap-y-3', 'md:gap-y-[20px]');
});

it('uses H2 for the pending popular section and reserves the same grid as the cards', () => {
  const { container } = mount(<PopularStationsSection stations={[]} isPending activeCountry="all" onPlay={vi.fn()} />);
  expect(sectionHeading('Popular Stations')).toHaveClass('section-header');
  expect(container.querySelector('.min-h-\\[1400px\\]')).toHaveClass('lg:min-h-[750px]', 'xl:min-h-[530px]');
  expect(container.querySelectorAll('.animate-pulse')).toHaveLength(12);
  expect(container.querySelector('.home-station-grid')).toContainElement(container.querySelector('.animate-pulse'));
});

it('preserves shared station card H4 defaults and identical markup/classes when home opts into H3', () => {
  const location = memoryLocation({ path: '/en' });
  const tree = (headingLevel?: 3 | 4) => <Router hook={location.hook}><StationCard station={station} headingLevel={headingLevel} /></Router>;
  const { container, rerender } = render(tree());
  expect(screen.getByRole('heading', { level: 4, name: station.name })).toHaveAttribute('class', stationHeadingClass);
  const original = container.innerHTML;
  rerender(tree(3));
  expect(screen.getByRole('heading', { level: 3, name: station.name })).toHaveAttribute('class', stationHeadingClass);
  expect(container.innerHTML.replaceAll('h3', 'h4')).toBe(original);
});

it('preserves discovery H4 defaults and typography at all breakpoints when home opts into H3', () => {
  const location = memoryLocation({ path: '/en' });
  const tree = (headingLevel?: 3 | 4) => <Router hook={location.hook}><DiscoverableGenreSlider genres={[discoverGenre]} headingLevel={headingLevel} /></Router>;
  const { container, rerender } = render(tree());
  expect(screen.getByRole('heading', { level: 4, name: discoverGenre.name })).toBeInTheDocument();
  const original = container.innerHTML;
  const css = container.querySelector('style')!.textContent!;
  expect(css.match(/\.discoverable-genre-slider :is\(h3, h4\)/g)).toHaveLength(3);
  expect(css).toMatch(/:is\(h3, h4\)\s*\{[^}]*font-size: 30px;[^}]*line-height: 1;/);
  expect(css).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.discoverable-genre-slider :is\(h3, h4\)\s*\{\s*font-size: 24px;/);
  expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{\s*\.discoverable-genre-slider :is\(h3, h4\)\s*\{\s*font-size: clamp\(32px, 3vw, 44px\);/);
  rerender(tree(3));
  expect(screen.getByRole('heading', { level: 3, name: discoverGenre.name })).toBeInTheDocument();
  expect(container.innerHTML.replaceAll('<h3', '<h4').replaceAll('</h3', '</h4')).toBe(original);
});
