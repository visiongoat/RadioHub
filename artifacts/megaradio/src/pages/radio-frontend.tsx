import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { homeStationPageOptions } from '@/lib/home-station-query';
import { OPEN_HOME_SEARCH, type HomeSearchOpenEvent } from '@/lib/home-search';
import { stationQueryFreshness } from '@/lib/station-query-policy';
import { useAvailableStationSnapshots } from '@/hooks/useAvailableStationSnapshots';
import { useHomeSearchViewport } from '@/hooks/use-home-search-viewport';
import { fetchStationCardList } from '@/lib/station-card-list-request';
import { Link } from "wouter";
import StationCard from "@/components/ui/station-card";
import CatalogStationItems from '@/components/ads/CatalogStationItems';
import HomeHeroPicture from '@/components/HomeHeroPicture';
import HomeSignupBanner from '@/components/HomeSignupBanner';
import HomeHeroCopy from '@/components/HomeHeroCopy';
import HomeFaq from '@/components/HomeFaq';
import HomeStationGuide from '@/components/HomeStationGuide';
import StationCardSkeleton from "@/components/ui/station-card-skeleton";
import GenreCardSkeleton from "@/components/ui/genre-card-skeleton";
import VirtualizedStationList from "@/components/ui/virtualized-station-list";
import OptimizedImage from "@/components/ui/optimized-image";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, getQueryFn } from '@/lib/queryClient';
import { communityDisplayName, communityFavoriteCount, communityLabels, type CommunityProfile } from '@/lib/community-profile';
import { PublicProfileAvatar } from '@/components/ui/public-profile-avatar';
import { MapPin, ChevronLeft, ChevronRight, ThumbsUp, Heart } from "lucide-react";
import { ScrollArea } from '@/components/ui/scroll-area';
import { normalizePublicStationLogoUrl } from '@workspace/seo-shared/station-logo-url';
import './home-search.css';

import { formatSearchVoteCount as formatVoteCount } from '@/lib/search-presentation';

// Pure functions at module level — no deps on component state, never re-created
const rankSearchResults = (stations: any[], query: string): any[] => {
  if (!stations || stations.length === 0 || !query) return stations;
  const normalizedQuery = query.toLowerCase().trim();
  const exactMatches: any[] = [];
  const startsWithMatches: any[] = [];
  const containsMatches: any[] = [];
  for (const station of stations) {
    const normalizedName = (station.name || '').toLowerCase();
    if (normalizedName === normalizedQuery) {
      exactMatches.push(station);
    } else if (normalizedName.startsWith(normalizedQuery)) {
      startsWithMatches.push(station);
    } else {
      containsMatches.push(station);
    }
  }
  const sortByVotes = (a: any, b: any) => (b.votes || 0) - (a.votes || 0);
  exactMatches.sort(sortByVotes);
  startsWithMatches.sort(sortByVotes);
  containsMatches.sort(sortByVotes);
  return [...exactMatches, ...startsWithMatches, ...containsMatches];
};

const GENRE_IMAGES = [
  '/images/genre-bg-grad-1.webp',
  '/images/genre-bg-grad-2.webp',
  '/images/genre-bg-grad-2.webp',
  '/images/genre-bg-grad-4.webp',
];
const getRandomImage = (index: number): string => {
  return `url(${GENRE_IMAGES[Math.abs(index) % GENRE_IMAGES.length]})`;
};
import DiscoverableGenreSlider from "@/components/DiscoverableGenreSlider";
import PopularStationsSection from "@/components/PopularStationsSection";
import { InView } from "@/components/ui/in-view";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { decodeHtmlEntities } from "@/lib/utils";
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode, Navigation } from 'swiper/modules';
// AddYourStationModal/RequestStationModal eager imports were dead code on
// this page (state was declared but no JSX rendered them) — removed entirely.
import ListStructuredData from "@/components/seo/ListStructuredData";
import RecentlyPlayedSection from "@/components/RecentlyPlayedSection";

// 🚀 LAZY LOAD: PageSocialShare with react-icons/si (reduces initial payload by 1.877 KiB)
const PageSocialShare = lazy(() => import("@/components/social/PageSocialShare").then(m => ({ default: m.PageSocialShare })));
import { SeoHead } from "@/components/SeoHead";
import { logger } from '@/lib/logger';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';
import 'swiper/css';
import 'swiper/css/free-mode';
import 'swiper/css/navigation';

// Public Users Section Component - OPTIMIZED FOR TBT
function PublicUsersSection({ inViewFromParent }: { inViewFromParent: boolean }) {
  const { t, language, localeTranslations } = useTranslation();
  const labels = communityLabels(language, localeTranslations);
  const { getLocalizedUrl } = useSeoRouting();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [followingUsers, setFollowingUsers] = useState<Set<string>>(new Set());
  const [animatingUsers, setAnimatingUsers] = useState<Map<string, 'following' | 'unfollowing'>>(new Map());
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const followTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    followTimers.current.forEach(clearTimeout);
    followTimers.current.clear();
  }, [currentUser?._id]);

  // Reuse the profile page's batched graph, rather than querying every card or
  // displaying Follow for listeners the current account already follows.
  const { data: socialData, isLoading: isFollowingLoading } = useQuery<{ following: Array<{ _id: string }> }>({
    queryKey: ['/api/user/social', currentUser?.email],
    queryFn: context => getQueryFn<{ following: Array<{ _id: string }> }>({ on401: 'throw' })({
      ...context, queryKey: [`/api/user/social/${encodeURIComponent(currentUser?.email || '')}`],
    }),
    enabled: inViewFromParent && !!currentUser?.email,
    staleTime: 60_000,
  });
  useEffect(() => {
    setFollowingUsers(new Set(currentUser ? socialData?.following?.map(profile => profile._id) || [] : []));
    setAnimatingUsers(new Map());
  }, [currentUser?._id, socialData]);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting));
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);
  
  const { data: publicProfilesData, isLoading } = useQuery<{ data: CommunityProfile[] }>({
    queryKey: ['/api/public-profiles'],
    retry: false,
    enabled: inViewFromParent, // Only fetch when section is visible
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: inViewFromParent && isVisible ? 60_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const handleFollowToggle = async (e: React.MouseEvent, userId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (animatingUsers.has(userId) || userId === currentUser?._id || isFollowingLoading) return;
    
    if (!currentUser) {
      // Redirect to login if not authenticated
      window.location.href = getLocalizedUrl('/auth/login');
      return;
    }
    
    const isCurrentlyFollowing = followingUsers.has(userId);
    
    // Start animation
    setAnimatingUsers(prev => new Map(prev).set(userId, isCurrentlyFollowing ? 'unfollowing' : 'following'));
    
    try {
      const response = await apiRequest(isCurrentlyFollowing ? 'DELETE' : 'POST', isCurrentlyFollowing ? `/api/user/unfollow/${userId}` : `/api/user/follow/${userId}`);
      
      if (response.ok) {
        // Wait for animation to complete before updating state
        const timer = setTimeout(() => {
          followTimers.current.delete(timer);
          setFollowingUsers(prev => {
            const newSet = new Set(prev);
            if (isCurrentlyFollowing) {
              newSet.delete(userId);
            } else {
              newSet.add(userId);
            }
            return newSet;
          });
          // Clear animation state
          setAnimatingUsers(prev => {
            const newMap = new Map(prev);
            newMap.delete(userId);
            return newMap;
          });
          void queryClient.invalidateQueries({ queryKey: ['/api/user/social'] });
          void queryClient.invalidateQueries({ queryKey: [`/api/user/is-following/${userId}`] });
        }, isCurrentlyFollowing ? 200 : 600); // Faster for unfollow, slower for follow
        followTimers.current.add(timer);
      } else {
        // Clear animation on error
        setAnimatingUsers(prev => {
          const newMap = new Map(prev);
          newMap.delete(userId);
          return newMap;
        });
      }
    } catch (error) {
      // Clear animation on error
      setAnimatingUsers(prev => {
        const newMap = new Map(prev);
        newMap.delete(userId);
        return newMap;
      });
    }
  };

  if (isLoading || !inViewFromParent) {
    return (
      <div ref={sectionRef} className="container">
        <div className="flex justify-between pb-4">
          <h2 className="section-header pb-4">
            {t('homepage_community_favorites')}
          </h2>
        </div>
        {/* 3x3 Grid skeleton - optimized height for mobile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-[21px] gap-y-3 md:gap-y-[20px]">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-600 rounded-lg p-3 md:p-4 h-20 md:h-24">
              <div className="flex items-center gap-3 h-full">
                <div className="h-12 w-12 md:h-14 md:w-14 bg-gray-500 rounded-full flex-shrink-0"></div>
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-4 bg-gray-500 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-500 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const publicProfiles = (publicProfilesData?.data || []).filter(profile => profile.isPublicProfile !== false);

  if (publicProfiles.length === 0) {
    return <div ref={sectionRef} />; // Keep visibility observation attached for subsequent cache updates.
  }

  return (
    <div ref={sectionRef} className="container">
      <div className="flex justify-between pb-4">
        <h2 className="section-header">
          {t('homepage_community_favorites')}
        </h2>
        <Link className="see-all-link" href={getLocalizedUrl('/users')}>
          {t('homepage_see_all')}
        </Link>
      </div>
      
      {/* Users 3x3 Grid Layout - Optimized mobile height */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-[21px] gap-y-3 md:gap-y-[20px]">
        {publicProfiles.slice(0, 6).map((user) => (
          <Link 
            key={`public-user-${user._id}`}
            href={getLocalizedUrl(`/users/${user.slug || user._id}`)}
            className="flex items-center rounded-md bg-[#2F2F2F] px-3 py-3 md:px-4 md:py-4 hover:bg-[#3A3A3A] transition-colors"
          >
            <PublicProfileAvatar profile={user} name={communityDisplayName(user, t('user_anonymous', 'Anonymous'))}
              className="h-12 w-12 md:h-14 md:w-14 rounded-full shadow-inner flex-shrink-0" />
            <div className="pl-3 md:pl-4 flex-1 min-w-0">
              <h3 className="text-base md:text-lg font-medium text-white truncate">{communityDisplayName(user, t('user_anonymous', 'Anonymous'))}</h3>
              <p className="text-xs md:text-sm font-medium text-gray-400 truncate">{communityFavoriteCount(user).toLocaleString(language)} {labels.radios}</p>
            </div>
            {/* Follow Button - Apple-style Animation */}
            {user._id !== currentUser?._id && <button
              onClick={(e) => handleFollowToggle(e, user._id)}
              disabled={animatingUsers.has(user._id) || isFollowingLoading}
              className={`follow-btn ml-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-medium flex-shrink-0 bg-[#FF4199] text-white hover:bg-[#E0357F] ${
                animatingUsers.get(user._id) === 'following' ? 'is-following' : ''
              } ${
                animatingUsers.get(user._id) === 'unfollowing' ? 'is-unfollowing' : ''
              } ${
                followingUsers.has(user._id) && !animatingUsers.has(user._id) ? 'followed' : ''
              }`}
              data-testid={`button-follow-${user._id}`}
            >
              <span className="follow-text">
                {followingUsers.has(user._id) ? t('user_unfollow', 'Remove') : t('user_follow', 'Follow')}
              </span>
              <Heart 
                className="follow-heart w-5 h-5" 
                fill={followingUsers.has(user._id) || animatingUsers.get(user._id) === 'following' ? 'currentColor' : 'none'}
                strokeWidth={2}
              />
            </button>}
          </Link>
        ))}
      </div>
    </div>
  );
}

// COMPLETE 1:1 REPLICA OF ORIGINAL VUE.JS FRONTEND
export default function RadioFrontend({ 
  selectedCountry = "all", 
  onCountryChange 
}: { 
  selectedCountry?: string; 
  onCountryChange?: (country: string, isManual?: boolean) => void; 
}) {
  const { t, language, isLoading: translationsLoading } = useTranslation();
  const { navigateWithLanguage, navigateTranslated, getLocalizedUrl } = useSeoRouting();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [filteredStations, setFilteredStations] = useState<any[]>([]);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const heroSearchInputRef = useRef<HTMLInputElement>(null);
  const heroSearchReturnFocusRef = useRef<HTMLElement | null>(null);
  const hasSearchTerm = searchQuery.trim().length >= 2;
  const isHeroSearchOpen = showSearchSuggestions || hasSearchTerm;
  const heroSearchAnchorRef = useHomeSearchViewport(isHeroSearchOpen);

  const closeHeroSearch = useCallback((restoreFocus = true) => {
    setShowSearchSuggestions(false);
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setFilteredStations([]);
    if (restoreFocus && heroSearchReturnFocusRef.current?.isConnected) {
      heroSearchReturnFocusRef.current.focus({ preventScroll: true });
    }
    heroSearchReturnFocusRef.current = null;
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const input = heroSearchInputRef.current;
      if (!input) return;
      event.preventDefault();
      heroSearchReturnFocusRef.current = (event as HomeSearchOpenEvent).detail.returnFocusTo;
      setShowSearchSuggestions(true);
      const bounds = input.getBoundingClientRect();
      if (window.innerWidth >= 640 && (bounds.top < 120 || bounds.bottom > window.innerHeight)) {
        input.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      input.focus({ preventScroll: true });
      input.select();
    };
    window.addEventListener(OPEN_HOME_SEARCH, open);
    return () => window.removeEventListener(OPEN_HOME_SEARCH, open);
  }, []);

  // RESTORED: Simple country ready state - no localStorage redirects
  // CRITICAL SEO: Never redirect URLs from Google/external links
  // Country detection only used for internal navigation, not automatic redirects
  const [countryReady] = useState(true);

  // Auto-scroll to top when entering the main page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  
  // Search Result Highlight and Focus Indicator
  const [focusedResultIndex, setFocusedResultIndex] = useState(-1);
  const [hoveredResultIndex, setHoveredResultIndex] = useState(-1);
  

  
  // Load More functionality for "All Stations" section (matches original AllStations.vue)
  const [loadMorePage, setLoadMorePage] = useState(1);
  const [allLoadedStations, setAllLoadedStations] = useState<any[]>([]);
  const availableLoadedStations = useAvailableStationSnapshots(allLoadedStations);
  const [isSearching, setIsSearching] = useState(false);

  
  // Modal state cleanup: AddYourStationModal/RequestStationModal are owned by
  // the layout shell (App.tsx + RadioHeader + Footer). Local state here was
  // dead — removed during the lazy-modal refactor.
  

  




  // Debounce search query - ultra-fast 100ms for instant feel
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 100);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset focus states when search changes
  useEffect(() => {
    setFocusedResultIndex(-1);
    setHoveredResultIndex(-1);
  }, [searchQuery, filteredStations]);

  // Enhanced loading state - tracks both debounce delay AND API request
  const searchLoading = (searchQuery.trim().length >= 2 && debouncedSearchQuery !== searchQuery) || isSearching;



  // DEFERRED: Genres only needed for dropdown, not LCP hero section
  // Deferring reduces critical request chain from 11.86s
  const [shouldLoadGenres, setShouldLoadGenres] = useState(false);

  useEffect(() => {
    // Defer genres to after hero paint (not visible in LCP)
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => setShouldLoadGenres(true), { timeout: 2000 });
    } else {
      setTimeout(() => setShouldLoadGenres(true), 1500);
    }
  }, []);

  // SSR-injected genres (from window.__INITIAL_DATA__) provide an immediate
  // initialData so the Swiper renders on first paint without waiting for the
  // deferred network request. Only applies when selectedCountry is 'all'
  // (the global-only data we inject server-side).
  const ssrGenres = selectedCountry === 'all'
    ? (typeof window !== 'undefined' ? (window as any).__INITIAL_DATA__?.genres : undefined)
    : undefined;

  const { data: genresResponse, isLoading: genresLoading } = useQuery({
    queryKey: ['/api/genres/precomputed', selectedCountry],
    enabled: shouldLoadGenres || !ssrGenres, // skip defer if SSR data is available
    initialData: ssrGenres,
    queryFn: async () => {
      // Use 7-day precomputed cache for genres
      const params = new URLSearchParams();
      if (selectedCountry !== 'all') {
        params.append('country', selectedCountry);
      }
      const response = await fetch(`/api/genres/precomputed?${params}`);
      if (!response.ok) throw new Error('Failed to fetch genres');
      const data = await response.json();
      return data;
    },
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  // Discoverable genres - load immediately (hero-adjacent, visible quickly)
  const [shouldLoadDiscoverableGenres, setShouldLoadDiscoverableGenres] = useState(false);
  
  useEffect(() => {
    // Reduced defer - 500ms for initial paint, then load immediately
    setTimeout(() => setShouldLoadDiscoverableGenres(true), 500);
  }, []);

  const { data: discoverableGenresResponse, isLoading: discoverableGenresLoading } = useQuery({
    queryKey: ['/api/genres/discoverable'],
    queryFn: async () => {
      const response = await fetch('/api/genres/discoverable');
      if (!response.ok) throw new Error('Failed to fetch discoverable genres');
      return response.json();
    },
    enabled: shouldLoadDiscoverableGenres,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - matches server cache
    gcTime: 25 * 60 * 60 * 1000, // 25 hours
  });

  // Geolocation and location detection - always run for geo personalization
  // (nearby stations, etc.) but DON'T use it to gate stations query on first load
  // OPTIMIZED: Cache location data in localStorage to avoid repeated API calls
  const { data: locationData } = useQuery({
    queryKey: ['/api/location'],
    initialData: () => {
      try {
        const cached = localStorage.getItem('cachedLocationData');
        if (cached) {
          const parsed = JSON.parse(cached);
          // Check if cache is still valid (24 hours)
          if (parsed.timestamp && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            return parsed.data;
          }
        }
      } catch {}
      return undefined;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - location doesn't change often
    gcTime: 60 * 60 * 1000, // 1 hour garbage collection
  });

  // Cache location data when it's fetched
  useEffect(() => {
    if (locationData && (locationData as any)?.location) {
      try {
        localStorage.setItem('cachedLocationData', JSON.stringify({
          data: locationData,
          timestamp: Date.now()
        }));
      } catch {}
    }
  }, [locationData]);

  // RESTORED: NO automatic redirects based on geo-location
  // CRITICAL SEO: URLs from Google must stay as they are - never redirect to user's geo-location
  // Country codes are only added when user clicks internal navigation links
  // This prevents Google bot from being redirected away from indexed URLs

  // Get detected country for automatic filtering
  const detectedCountry = (locationData as any)?.location?.country || 'all';
  const activeCountry = selectedCountry;
  
  // PROGRESSIVE LOADING: Ultra-fast precomputed stations (7-day cache, zero DB queries)
  // 🚀 PERF FIX: Gate behind countryReady to prevent fetching for 'all' if redirect coming
  const { data: stationsData, isLoading: stationsLoading } = useQuery({
    ...homeStationPageOptions(selectedCountry, loadMorePage),
    enabled: countryReady, // 🚀 PERF: Wait for country detection on first visit
  });

  // ASYNC LOAD: Load more all stations in background from 7-day cache
  // DEFERRED: Load extended stations only after initial page paint (for Load More)
  const { data: extendedStationsData } = useQuery({
    queryKey: ['/api/stations/precomputed', selectedCountry, 'extended'],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('countryName', selectedCountry === 'all' ? 'global' : selectedCountry);
      params.append('page', '1');
      params.append('limit', '36');
      const url = `/api/stations/precomputed?${params}&slim=1`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch extended stations');
      const result = await response.json();
      return { stations: result.data, pagination: result.pagination };
    },
    ...stationQueryFreshness,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    enabled: !!stationsData && shouldLoadDiscoverableGenres, // DEFERRED: Load after page interactive
  });

  const { currentStation, isPlaying, playStation, stopStation } = useGlobalPlayer();

  // Reset load more when country changes
  // PERF: Removed broad invalidateQueries — query keys already include `selectedCountry`,
  // so TanStack Query refetches automatically when the key changes. The previous broad
  // invalidate caused duplicate /api/stations/precomputed calls (5+ second each on mobile).
  useEffect(() => {
    setLoadMorePage(1);
    setAllLoadedStations([]);

    // Clear search results when country changes
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setFilteredStations([]);
  }, [selectedCountry]);

  // Handle stations data - SIMPLIFIED to match original performance pattern
  useEffect(() => {
    if (stationsData && stationsData.stations) {
      if (loadMorePage === 1) {
        // First page - replace all stations
        setAllLoadedStations(stationsData.stations);
      } else {
        // Subsequent pages - append to existing stations, preventing duplicates
        setAllLoadedStations((prev: any[]) => {
          const existingIds = new Set(prev.map(station => station._id));
          const newStations = stationsData.stations.filter((station: any) => !existingIds.has(station._id));
          return [...prev, ...newStations];
        });
      }
      
      // Don't update global stations list to prevent performance issues
      // Only update if no station is currently playing to prevent audio disruption
      if (!isPlaying || !currentStation) {
        // Stations are handled directly in component now
      }
    }
  }, [stationsData, loadMorePage, isPlaying, currentStation]);

  // DEFERRED: Countries only needed for dropdown, not LCP hero section
  const { data: countries = [] } = useQuery<any[]>({
    queryKey: ['/api/countries'],
    enabled: shouldLoadGenres, // DEFERRED: Load after hero paint with genres
  });

  // GPS coordinates state for true proximity-based recommendations
  // DISABLED automatic GPS request to prevent permissions policy violations
  // Country detection works automatically via IP-based geolocation from backend
  const [userCoordinates, setUserCoordinates] = useState<{lat: number, lng: number} | null>(null);
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'pending' | 'prompt'>('pending');

  // GPS coordinates are now opt-in only - user must click "Enable Nearby Stations"
  // This prevents automatic permission requests and policy violations
  const requestGPSLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserCoordinates(coords);
          setLocationPermission('granted');
        },
        (error) => {
          setLocationPermission('denied');
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000 // 5 minutes cache
        }
      );
    } else {
      setLocationPermission('denied');
    }
  };

  // Track if user has manually selected a country to prevent auto-override
  // Check localStorage on mount to persist manual selection across page reloads
  const [hasManualSelection, setHasManualSelection] = useState(() => {
    try {
      return localStorage.getItem('countryPreference') === 'manual';
    } catch {
      return false;
    }
  });
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Track when country changes from external source (manual selection)
  useEffect(() => {
    // If country changed and it's not the initial auto-detection, mark as manual
    if (initialLoadDone && selectedCountry && onCountryChange) {
      setHasManualSelection(true);
    }
  }, [selectedCountry, initialLoadDone, onCountryChange]);

  // Auto-set country based on user location - ONLY on initial load, never override manual selections
  useEffect(() => {
    if ((locationData as any)?.location?.country && 
        (locationData as any)?.location?.country !== 'all' && 
        selectedCountry === 'all' && 
        !hasManualSelection &&
        !initialLoadDone &&
        onCountryChange) {
      const detectedCountry = (locationData as any).location.country;
      onCountryChange(detectedCountry, false); // Mark as automatic, not manual
      setInitialLoadDone(true);
    } else if (locationData && !initialLoadDone) {
      // Mark initial load as done even if no auto-detection occurred
      setInitialLoadDone(true);
    }
  }, [locationData, selectedCountry, onCountryChange, hasManualSelection, initialLoadDone]);

  // Show nearby stations when:
  // 1. User is viewing their actual detected location (country match)
  // 2. User selected "Global" (should still show nearby from detected country)
  const userDetectedCountry = (locationData as any)?.location?.country;
  const shouldShowNearbyStations = userDetectedCountry && 
    userDetectedCountry !== 'all' && 
    (selectedCountry === userDetectedCountry || selectedCountry === 'all');
  
  // DEFERRED: Load nearby stations after page interactive
  const { data: nearbyStationsData } = useQuery({
    queryKey: ['/api/stations/nearby', selectedCountry, userCoordinates, shouldShowNearbyStations, userDetectedCountry],
    ...stationQueryFreshness,
    enabled: shouldLoadDiscoverableGenres && shouldShowNearbyStations, // DEFERRED
    queryFn: async () => {
      logger.log('🏘️ Nearby stations query starting:', { 
        shouldShowNearbyStations, 
        userDetectedCountry, 
        selectedCountry, 
        hasCoords: !!userCoordinates,
        locationPermission,
        locationData: (locationData as any)?.location
      });
      
      // Only fetch nearby stations if conditions are met
      if (!shouldShowNearbyStations) {
        logger.log('❌ Nearby stations disabled:', { shouldShowNearbyStations, userDetectedCountry });
        return null;
      }

      // Priority 1: Use GPS coordinates for true proximity-based results
      if (userCoordinates && locationPermission === 'granted') {
        const params = new URLSearchParams();
        params.append('lat', userCoordinates.lat.toString());
        params.append('lng', userCoordinates.lng.toString());
        params.append('radius', '300'); // 300km radius for better coverage
        params.append('limit', '12');
        // IMPORTANT: Send user's country to prioritize stations from their country
        if (userDetectedCountry) {
          params.append('userCountry', userDetectedCountry);
        }
        
        logger.log('📍 Using GPS coordinates for nearby stations:', userCoordinates, 'userCountry:', userDetectedCountry);
        const response = await fetch(`/api/stations/nearby?${params}&slim=1`);
        if (response.ok) {
          const data = await response.json();
          logger.log('✅ GPS nearby stations found:', data.length);
          if (data.length >= 6) { // Only use GPS if we get enough stations
            return { stations: data };
          }
        }
      }
      
      // Priority 2: Use detected location coordinates from IP for proximity search
      if ((locationData as any)?.location?.lat && (locationData as any)?.location?.lng) {
        const params = new URLSearchParams();
        params.append('lat', (locationData as any).location.lat.toString());
        params.append('lng', (locationData as any).location.lng.toString());
        params.append('radius', '400'); // 400km radius for IP-based location
        params.append('limit', '12');
        // IMPORTANT: Send user's country to prioritize stations from their country
        if (userDetectedCountry) {
          params.append('userCountry', userDetectedCountry);
        }
        
        logger.log('🌐 Using IP location coordinates:', (locationData as any).location, 'userCountry:', userDetectedCountry);
        const response = await fetch(`/api/stations/nearby?${params}&slim=1`);
        if (response.ok) {
          const data = await response.json();
          logger.log('✅ IP nearby stations found:', data.length);
          if (data.length >= 6) { // Only use IP location if we get enough stations
            return { stations: data };
          }
        }
      }
      
      // Priority 3: Use country-based filtering as fallback - ALWAYS WORKS
      // Use detected country when Global is selected, otherwise use selected country
      const countryForNearby = selectedCountry === 'all' ? userDetectedCountry : selectedCountry;
      if (countryForNearby && countryForNearby !== 'all') {
        const params = new URLSearchParams();
        params.append('country', countryForNearby);
        params.append('limit', '12');
        
        logger.log('🏳️ Using country fallback for nearby stations:', countryForNearby);
        const response = await fetch(`/api/stations/nearby?${params}&slim=1`);
        if (!response.ok) throw new Error('Failed to fetch country stations');
        const data = await response.json();
        logger.log('✅ Country nearby stations found:', data.length);
        return { stations: data };
      }
      
      logger.log('❌ No nearby stations method available');
      return null;
    }
  });

  // Popular is the first twelve of the same ordered first page used below.
  // A separate observer keeps it on page one when All Stations loads page two,
  // while TanStack shares the initial request/cache (no extra gate or download).
  const { data: popularStationsData, isPending: popularStationsPending } = useQuery({
    ...homeStationPageOptions(selectedCountry),
    enabled: countryReady,
    select: (page) => page.stations,
  });

  // PERF: `extendedPopularStationsData` removed — it duplicated the exact same
  // /api/stations/precomputed call as the initial popular query (different cache key only),
  // wasting 5+ seconds and 16KB on mobile. Alias kept so downstream consumers don't break.
  const extendedPopularStationsData = popularStationsData;

  // Use global player for proper audio handling - MOVE TO TOP TO FIX INITIALIZATION
  const { favorites } = useGlobalPlayer();
  const { isAuthenticated, user } = useAuth();
  
  // Popular stations query gating state for TBT optimization
  
  // Fetch user's favorite stations when authenticated
  const { data: userFavoritesData } = useQuery({
    queryKey: ['/api/user/favorites', { sort: 'newest' }],
    retry: false,
    enabled: !!isAuthenticated,
    ...stationQueryFreshness,
  });

  const genres = (genresResponse as any)?.data || [];
  const discoverableGenres = (discoverableGenresResponse as any) || [];
  
  // PROGRESSIVE DATA: Use extended data if available, fallback to initial
  const stations = (extendedStationsData as any)?.stations || (stationsData as any)?.stations || [];
  const popularStations = (extendedPopularStationsData as any) || (popularStationsData as any) || []; // All 12 popular stations
  const userFavoriteStations = (userFavoritesData as any)?.stations || [];
  
  // IMMEDIATE DISPLAY: Show 12 popular stations (3x4 grid) and 18 all stations for fast initial render
  const initialPopularStations = popularStations.slice(0, 12);
  const initialAllStations = stations.slice(0, 18);
  
  // Filter out favorited stations from discovery sections to avoid duplicates
  const favoritesArray = favorites || [];
  const unfavoritedStations = stations.filter((station: any) => !favoritesArray.includes(station._id));
  const unfavoritedPopularStations = popularStations.filter((station: any) => !favoritesArray.includes(station._id));
  
  // SMART DISPLAY: Show initial data immediately, extended data loads in background
  const allStations = unfavoritedStations.slice(0, 18);
  const displayPopularStations = unfavoritedPopularStations.length > 0 ? unfavoritedPopularStations : initialPopularStations;
  const displayAllStations = allStations.length > 0 ? allStations : initialAllStations;
  
  // Handle play function with page stations
  const handlePlay = useCallback(async (station: any, _playlistName?: string) => {
    try {
      if (allLoadedStations.some(row => row._id === station._id) && !availableLoadedStations.some(row => row._id === station._id)) return;
      const currentPageStations = allLoadedStations.length > 0 ? availableLoadedStations :
        (extendedStationsData?.stations || stationsData?.stations || []);
      await playStation(station, currentPageStations);
    } catch (_error) {
      // silently ignore play errors
    }
  }, [allLoadedStations, availableLoadedStations, extendedStationsData, stationsData, playStation]);

  // Handle stop function
  const handleStop = useCallback(() => {
    stopStation();
  }, [stopStation]);

  // Navigate to station function with language-aware routing.
  // Uses navigateTranslated so the URL segment is translated (e.g. /tr/istasyon/x,
  // /bg/stantsiya/x) — otherwise we emit /<lang>/station/x which 301-redirects
  // and wastes Google crawl budget.
  const navigateToStation = useCallback((station: any) => {
    const stationPath = station.slug ? `/station/${station.slug}` : `/station/${station._id}`;
    navigateTranslated(stationPath);
  }, [navigateTranslated]);
  
  // Player state helper
  const playerState = currentStation ? (isPlaying ? 'playing' : 'stopped') : 'stopped';
  const isLoading = false; // Add loading state when needed
  
  // Remove mock auth variables - using real auth now



  // In-memory search cache for instant repeat searches
  const searchCacheRef = useRef<Map<string, { stations: any[]; expiresAt: number }>>(new Map());
  
  // Search functionality - DIRECT backend API call with cache + abort for speed
  useEffect(() => {
    const controller = new AbortController();
    const performSearch = async () => {
      const searchTerm = debouncedSearchQuery.trim();
      
      if (!searchTerm || searchTerm.length < 2) {
        setFilteredStations([]);
        setIsSearching(false);
        return;
      }
      
      // Normalize cache key (lowercase, no spaces)
      const cacheKey = searchTerm.toLowerCase().replace(/\s+/g, '');
      
      // Check cache first for instant results
      const cachedSearch = searchCacheRef.current.get(cacheKey);
      if (cachedSearch && cachedSearch.expiresAt > Date.now()) {
        setFilteredStations(cachedSearch.stations);
        setIsSearching(false);
        return;
      }
      
      setIsSearching(true);
      
      try {
        const params = new URLSearchParams({
          search: searchTerm,
          limit: '20',
          sort: 'votes'
        });
        
        const response = await fetchStationCardList(params, {
          signal: controller.signal
        });
        
        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }
        
        const data = await response.json();
        if (controller.signal.aborted) return;
        
        if (data.stations) {
          const rankedStations = rankSearchResults(data.stations, searchTerm);
          setFilteredStations(rankedStations);
          
          // Cache for instant repeat searches (limit cache size)
          if (searchCacheRef.current.size > 50) {
            const firstKey = searchCacheRef.current.keys().next().value;
            if (firstKey) searchCacheRef.current.delete(firstKey);
          }
          searchCacheRef.current.set(cacheKey, { stations: rankedStations, expiresAt: Date.now() + stationQueryFreshness.staleTime });
        } else {
          setFilteredStations([]);
        }
      } catch (error: any) {
        if (!controller.signal.aborted && error.name !== 'AbortError') {
          setFilteredStations([]);
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    };
    
    performSearch();
    return () => controller.abort();
  }, [debouncedSearchQuery]);

  // Opening from the header uses the same result surface, with already-fetched
  // popular stations until the listener types a searchable term.
  const visibleSearchStations = hasSearchTerm ? filteredStations : (popularStationsData || []).slice(0, 6);
  const heroSearchLoading = hasSearchTerm ? searchLoading : popularStationsPending;

  const selectHeroSearchStation = (station: any) => {
    handlePlay(station);
    closeHeroSearch(false);
    navigateTranslated(station.slug ? `/station/${station.slug}` : `/station/${station._id}`);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && isHeroSearchOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeHeroSearch();
      return;
    }
    if (!isHeroSearchOpen || heroSearchLoading || visibleSearchStations.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedResultIndex(index => index < visibleSearchStations.length - 1 ? index + 1 : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedResultIndex(index => index > 0 ? index - 1 : visibleSearchStations.length - 1);
    } else if (event.key === 'Enter' && visibleSearchStations[focusedResultIndex]) {
      event.preventDefault();
      selectHeroSearchStation(visibleSearchStations[focusedResultIndex]);
    }
  };

  useEffect(() => {
    if (isHeroSearchOpen && focusedResultIndex >= 0) {
      document.getElementById(`hero-search-option-${focusedResultIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [isHeroSearchOpen, focusedResultIndex]);

  return (
    <div className="w-full">
      {/* SEO: Dynamic canonical and meta tags */}
      <SeoHead pageType="home" />
      
      
      {/* EXACT HERO SECTION FROM ORIGINAL - Hero.vue */}
      <div className="hero-container overflow-visible">
          {/* 🚀 LCP CRITICAL: Hero background image - visible in HTML with high priority for fastest LCP */}
          <HomeHeroPicture />

          {/* 🚀 LCP OPTIMIZATION: Decorative gradients - lazy loaded (not critical for LCP) */}
          <img 
            src="/images/bg-gradient-red.svg" 
            alt="" 
            className="absolute right-0 top-0 h-full opacity-60 pointer-events-none z-0" 
            aria-hidden="true"
            loading="lazy"
          />
          <img 
            src="/images/bg-gradient-blue.svg" 
            alt="" 
            className="absolute left-0 top-0 h-full opacity-40 pointer-events-none z-0" 
            aria-hidden="true"
            loading="lazy"
          />
          
          
          <HomeHeroCopy language={language} />

          {/* Shared hero/header search, styled from Figma's open search component. */}
          <div
            ref={heroSearchAnchorRef}
            className={`home-search-anchor ${isHeroSearchOpen ? 'home-search-anchor--open' : ''}`}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) closeHeroSearch(false);
            }}
          >
            {isHeroSearchOpen && (
              <div 
                className="home-search-dismiss"
                onClick={() => closeHeroSearch()}
                data-testid="hero-search-backdrop"
              />
            )}
            
            {/* Search Container with unified border */}
            <div 
              className={`home-search-panel ${isHeroSearchOpen ? 'home-search-panel--open' : ''}`}
            >
              {/* Search Input */}
              <div className="home-search-input-row">
                <input
                  ref={heroSearchInputRef}
                  type="text"
                  role="combobox"
                  aria-label={t('general_search', 'Search')}
                  aria-autocomplete="list"
                  aria-expanded={isHeroSearchOpen}
                  aria-controls={isHeroSearchOpen ? 'hero-search-results' : undefined}
                  aria-activedescendant={isHeroSearchOpen && !heroSearchLoading && visibleSearchStations[focusedResultIndex] ? `hero-search-option-${focusedResultIndex}` : undefined}
                  autoComplete="off"
                  data-testid="input-hero-search"
                  placeholder={t('hero_search_placeholder', 'Search for radio stations...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="home-search-input"
                />
                {isHeroSearchOpen && (
                  <button type="button" onClick={() => closeHeroSearch()} aria-label={t('general_close', 'Close')}
                    className="home-search-close">
                    <img src="/icons/home-search/close-circle.svg" width="24" height="24" alt="" />
                  </button>
                )}
                
                {/* Search Icon - Left side (Outside input to avoid blur) */}
                <img className="home-search-icon" src="/icons/home-search/search-normal.svg" width="24" height="24" alt="" />
                {isHeroSearchOpen && <img className="home-search-divider" src="/icons/home-search/divider.svg" alt="" />}
              </div>
              
              {/* A single glass surface keeps the hero visible through the results. */}
              {isHeroSearchOpen && (
                  <div className="home-search-dropdown">
                    {/* Results count - Minimal style */}
                      <p aria-live="polite" className="home-search-count">
                        {hasSearchTerm
                          ? `${visibleSearchStations.length} ${visibleSearchStations.length === 1 ? t('station_found', 'station found') : t('stations_found', 'stations found')}`
                          : t('popular_stations', 'Popular Stations')}
                      </p>
                    
                    {/* Search Results - Light translucent list */}
                    <ScrollArea
                      type="auto"
                      id="hero-search-results"
                      role="listbox"
                      aria-label={t('general_search', 'Search')}
                      aria-busy={heroSearchLoading}
                      className="home-search-results"
                    >
                      {heroSearchLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <div className="flex items-center space-x-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-transparent"></div>
                            <span className="text-gray-300 text-sm">{t('searching', 'Searching...')}</span>
                          </div>
                        </div>
                      ) : visibleSearchStations.length > 0 ? (
                        <>
                          {/* Display all stations with highlighting and focus indicators */}
                          {visibleSearchStations.map((station: any, index: number) => {
                            const isHovered = hoveredResultIndex === index;
                            const isFocused = focusedResultIndex === index;
                            const isHighlighted = isHovered || isFocused;
                            
                            return (
                              <div
                                key={station._id || index}
                                id={`hero-search-option-${index}`}
                                role="option"
                                aria-selected={isFocused}
                                className={`home-search-option ${isHighlighted ? 'home-search-option--highlighted' : ''}`}
                                onMouseEnter={() => setHoveredResultIndex(index)}
                                onMouseLeave={() => setHoveredResultIndex(-1)}
                                onClick={() => selectHeroSearchStation(station)}
                              >
                                {/* Station Image - Apple style */}
                                <div className="relative flex-shrink-0 size-[38px]">
                                  <OptimizedImage
                                    src={normalizePublicStationLogoUrl(
                                      // 1. Priority: Optimized logo assets
                                      station.logoAssets?.status === 'completed' && station.logoAssets?.folder && (station.logoAssets?.webp256 || station.logoAssets?.webp96 || station.logoAssets?.webp48)
                                        ? ((() => { const v = (station.logoAssets.webp256 || station.logoAssets.webp96 || station.logoAssets.webp48)!; return v.startsWith('http') || v.startsWith('/') ? v : `/station-logos/${station.logoAssets.folder}/${v}`; })())
                                        // 2. Local image path
                                        : station.localImagePath ? `/station-images/${station.localImagePath}` 
                                        // 3. External favicon
                                        : (station.favicon && station.favicon.trim() !== '' && station.favicon !== 'null' && station.favicon !== 'undefined') ? 
                                          decodeHtmlEntities(station.favicon) : ''
                                    )}
                                    alt={`${station.name} favicon`}
                                    width={38}
                                    height={38}
                                    className="w-full h-full rounded-[6px] object-cover"
                                    fallbackSrc="/images/no-image.webp"
                                  />
                                  {/* Country Flag - Minimal positioning */}
                                  {station.countryCode && (
                                    <img
                                      loading="lazy"
                                      width="16"
                                      height="16"
                                      src={`https://flagcdn.com/w80/${station.countryCode.toLowerCase()}.webp`}
                                      alt={`${station.country || 'Country'} flag`}
                                      className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-white/30"
                                    />
                                  )}
                                </div>
                                
                                {/* Station Info - White text style */}
                                <div className="flex-1 min-w-0" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}>
                                  <span className="home-search-station-name">{station.name}</span>
                                  {station.country && (
                                    <span className="text-xs text-white/80 truncate block">{station.country}</span>
                                  )}
                                </div>
                                
                                {/* Station Votes - ThumbsUp Icon + Formatted Count */}
                                {station.votes !== undefined && (
                                  <div className="flex items-center gap-1 text-xs text-white/70 flex-shrink-0 ml-2" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}>
                                    <ThumbsUp className="w-3 h-3" />
                                    <span>{formatVoteCount(station.votes || 0)}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <div className="flex items-center justify-center py-4">
                          <div className="text-center">
                            <p className="text-gray-300 text-sm">{t('no_stations_found', 'No stations found')}</p>
                            <p className="text-gray-400 text-xs mt-1">{t('hero_search_placeholder', 'Search for radio stations...')}</p>
                          </div>
                        </div>
                      )}
                    </ScrollArea>
                  </div>
              )}
            </div>
          </div>

          {/* Gradient overlay - EXACT from original */}
          <div className="absolute bottom-0 h-60 w-full bg-gradient-to-b from-transparent to-[#1A0020]"></div>
        </div>

        {/* MAIN CONTENT SECTION - EXACT from index.vue */}
        <div className="relative overflow-hidden bg-[#0E0E0E]">
          
          <div className="m-auto text-white space-y-8">

            {/* 1. GENRES SECTION - EXACT from index.vue */}
            <div className="container">
              <div className="flex justify-between items-center pb-4">
                <h2 className="section-header">{t('homepage_genres', 'Genres')}</h2>
                {/* Hide "See all" and navigation arrows on mobile, show only on md+ */}
                <div className="hidden md:flex items-center gap-3">
                  <Link className="see-all-link" href={getLocalizedUrl('/genres')}>
                    {t('homepage_see_all', 'See all')}
                  </Link>
                  <div className="flex items-center gap-2">
                    <button 
                      className="genres-swiper-prev w-10 h-10 flex items-center justify-center rounded-full bg-[#2A2A2A] hover:bg-[#3A3A3A] transition-colors"
                      aria-label="Previous genres"
                      data-testid="button-genres-prev"
                    >
                      <ChevronLeft className="w-6 h-6 text-[#FF4199] stroke-[3]" />
                    </button>
                    <button 
                      className="genres-swiper-next w-10 h-10 flex items-center justify-center rounded-full bg-[#2A2A2A] hover:bg-[#3A3A3A] transition-colors"
                      aria-label="Next genres"
                      data-testid="button-genres-next"
                    >
                      <ChevronRight className="w-6 h-6 text-[#FF4199] stroke-[3]" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Standard Genre Slider - Mobile: 170x58px, Desktop: 280x87px */}
              <div className="min-h-[58px] md:min-h-[87px]">
                {genresLoading ? (
                  <div className="flex gap-2 md:gap-5 items-center overflow-hidden h-[58px] md:h-[87px]">
                    {Array(3).fill(0).map((_, index) => (
                      <div key={index} className="animate-pulse h-[58px] md:h-[87px] w-[170px] md:w-[280px] rounded-[5px] md:rounded-[10px] bg-[#404040] flex-shrink-0"></div>
                    ))}
                  </div>
                ) : (
                  <Swiper
                    modules={[FreeMode, Navigation]}
                    freeMode={true}
                    loop={true}
                    spaceBetween={10}
                    navigation={{
                      prevEl: '.genres-swiper-prev',
                      nextEl: '.genres-swiper-next',
                    }}
                    breakpoints={{
                      320: {
                        slidesPerView: 'auto' as any,
                        spaceBetween: 8,
                      },
                      480: {
                        slidesPerView: 'auto' as any,
                        spaceBetween: 8,
                      },
                      768: {
                        slidesPerView: 'auto' as any,
                        spaceBetween: 20,
                      },
                      1200: {
                        slidesPerView: 'auto' as any,
                        spaceBetween: 20,
                      },
                    }}
                    className="flex gap-2"
                  >
                    {/* Genres slider - Mobile: 130x45px, Desktop: 280x87px */}
                    {genres?.map((genre: any, index: number) => (
                      <SwiperSlide
                        key={`genre-${genre._id}-${index}`}
                        className="genre-slide cursor-pointer select-none genre-bg-full dynamic-bg-image rounded-[5px] md:rounded-[10px] !w-[170px] !h-[58px] md:!w-[280px] md:!h-[87px]"
                        style={{
                          '--bg-image': getRandomImage(index),
                        } as React.CSSProperties}
                      >
                        <Link 
                          href={getLocalizedUrl(`/genres/${genre.slug || genre.name.toLowerCase()}`)} 
                          className="w-full h-full flex items-center justify-center rounded-[5px] md:rounded-[10px]"
                        >
                          <h3 className="home-genre-title px-2 text-sm md:text-xl font-bold capitalize text-center text-white drop-shadow-lg">
                            {genreDisplayName(genre, language)}
                          </h3>
                        </Link>
                      </SwiperSlide>
                    ))}
                  </Swiper>
                )}
              </div>
            </div>

            {/* 1.5. RECENTLY PLAYED STATIONS - Show only if user has played stations */}
            <RecentlyPlayedSection onPlay={handlePlay} />

            {/* 2. POPULAR STATIONS — reserve space while loading, not after an empty/error response. */}
            <PopularStationsSection stations={displayPopularStations} isPending={popularStationsPending} activeCountry={activeCountry} onPlay={handlePlay} />

            {/* 3. STATIONS NEAR YOU SECTION */}
            {shouldShowNearbyStations && (nearbyStationsData as any)?.stations?.length > 0 && (
              <div className="container mt-8">
                <h2 className="section-header pb-4">
                  {t('homepage_stations_near_you', 'Stations Near You')}
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
                  {(nearbyStationsData as any).stations.slice(0, 6).map((station: any, i: number) => (
                    <StationCard key={`nearby-${station._id || i}`} station={station} onPlay={handlePlay} headingLevel={3} />
                  ))}
                </div>
              </div>
            )}

            {/* 4. YOUR FAVORITES SECTION - Only show when user is authenticated and has favorites */}
            {isAuthenticated && userFavoriteStations?.length > 0 && (
              <div className="container mt-8">
                <div className="flex justify-between pb-4">
                  <h2 className="section-header flex items-center space-x-2">
                    <svg className="w-6 h-6 text-[#FF4199]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                    <span>{t('homepage_your_favorites', 'Your Favorites')}</span>
                  </h2>
                  <Link className="see-all-link" href={getLocalizedUrl('/favorites')}>
                    {t('homepage_see_all', 'See all')}
                  </Link>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
                  {userFavoriteStations.slice(0, 6).map((station: any, i: number) => (
                    <StationCard 
                      key={`favorite-${station._id || i}`} 
                      station={station} 
                      onPlay={handlePlay}
                      showVotes={false}
                      headingLevel={3}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Blue Gradient Backgrounds - Decorative Elements */}
            <div className="fixed pointer-events-none" style={{
              width: '946px',
              height: '946px',
              top: '2121px',
              left: '-690px',
              background: 'rgba(51, 0, 255, 0.3)',
              borderRadius: '50%',
              filter: 'blur(40px)',
              zIndex: 0
            }} aria-hidden="true" />
            <div className="fixed pointer-events-none" style={{
              width: '946px',
              height: '946px',
              top: '2121px',
              right: '-690px',
              background: 'rgba(51, 0, 255, 0.3)',
              borderRadius: '50%',
              filter: 'blur(40px)',
              zIndex: 0
            }} aria-hidden="true" />

            {/* 4. DISCOVERABLE GENRE SLIDER SECTION - LAZY LOADED FOR TBT OPTIMIZATION */}
            <InView rootMargin="200px">
              {(inView) => inView ? (
                <div className="container">
                  <div className="my-8">
                    <h2 className="section-header pb-4">{t('homepage_discover_genres', 'Discover Genres')}</h2>
                    {discoverableGenresLoading ? (
                      <div className="flex gap-4 items-center overflow-hidden">
                        {Array(6).fill(0).map((_, index) => (
                          <div key={index} className="animate-pulse h-[150px] md:h-[214px] min-w-56 md:min-w-80 lg:min-w-60 rounded-xl bg-[#404040]"></div>
                        ))}
                      </div>
                    ) : discoverableGenres && discoverableGenres.length > 0 ? (
                      <Suspense fallback={
                        <div className="flex gap-4 items-center overflow-hidden">
                          {Array(6).fill(0).map((_, index) => (
                            <div key={index} className="animate-pulse h-[150px] md:h-[214px] min-w-56 md:min-w-80 lg:min-w-60 rounded-xl bg-[#404040]"></div>
                          ))}
                        </div>
                      }>
                        <DiscoverableGenreSlider genres={discoverableGenres} headingLevel={3} />
                      </Suspense>
                    ) : (
                      <div className="text-center text-gray-400 py-8 w-full">
                        <p>No discoverable genres selected</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="container">
                  <div className="my-8">
                    <h2 className="section-header pb-4">{t('homepage_discover_genres', 'Discover Genres')}</h2>
                    <div className="flex gap-4 items-center overflow-hidden">
                      {Array(6).fill(0).map((_, index) => (
                        <div key={index} className="animate-pulse h-[150px] md:h-[214px] min-w-56 md:min-w-80 lg:min-w-60 rounded-xl bg-[#404040]"></div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </InView>

            {/* 5. FAVORITES FROM USERS SECTION - LAZY LOADED FOR TBT OPTIMIZATION */}
            <InView rootMargin="200px">
              {(inView) => inView ? (
                <Suspense fallback={
                  <div className="container">
                    <div className="my-8">
                      <h2 className="section-header pb-4">{t('homepage_community_favorites', 'Community Favorites')}</h2>
                      <div className="flex gap-4 overflow-hidden">
                        {Array(4).fill(0).map((_, i) => (
                          <div key={i} className="animate-pulse h-32 w-64 bg-gray-600 rounded-lg"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                }>
                  <PublicUsersSection inViewFromParent={true} />
                </Suspense>
              ) : (
                <div className="container">
                  <div className="my-8">
                    <h2 className="section-header pb-4">{t('homepage_community_favorites', 'Community Favorites')}</h2>
                    <div className="flex gap-4 overflow-hidden">
                      {Array(4).fill(0).map((_, i) => (
                        <div key={i} className="animate-pulse h-32 w-64 bg-gray-600 rounded-lg"></div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </InView>

            {/* 6. ALL STATIONS SECTION - EXACT from AllStations.vue */}
            <div className="container relative">
              <h2 className="section-header pb-4 flex items-baseline gap-2">
                <span>{t('homepage_all_stations', 'All Stations')}</span>
                {activeCountry !== 'all' && (
                  <span className="text-sm font-normal text-gray-400">
                    {t('from', 'from')} {getLocalizedCountryDisplayName(activeCountry, language)}
                  </span>
                )}
              </h2>

              {/* All Stations Grid - Always use 3-column grid layout for consistent design */}
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
                <CatalogStationItems stations={availableLoadedStations} getKey={(station: any, i) => `all-stations-${station._id || i}`}>
                  {(station: any) => <StationCard station={station} onPlay={handlePlay} headingLevel={3} />}
                </CatalogStationItems>
              </div>
              
              {/* See More Button - EXACT from original LoadMoreButton.vue - Centered below stations */}
              {stationsData?.pagination && loadMorePage * 18 < stationsData.pagination.total && (
                <div className="flex justify-center my-8">
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // CRITICAL: Use wouter navigation to preserve audio during redirect
                      if (loadMorePage + 1 === 3) {
                        logger.log('🎵 Audio-preserving redirect to /radios page (preserving playback)');
                        
                        // Use navigateTranslated to get proper translated URL
                        // Example: /tr → /tr/radyolar, /en → /en/radios
                        navigateTranslated('/radios');
                        return;
                      }
                      
                      setLoadMorePage(prev => prev + 1);
                    }}
                    disabled={stationsLoading}
                    className="px-4 py-2 font-normal text-md bg-white/20 disabled:text-gray-400 disabled:cursor-not-allowed rounded-full text-white hover:bg-white/30 transition-colors"
                  >
                    {stationsLoading ? t('loading', 'Loading...') : t('see_more', 'See more')}
                  </button>
                </div>
              )}
            </div>

            {/* DOWNLOAD APP SECTION - DISABLED TO MATCH ORIGINAL Vue.js (v-if="false") */}
            {false && (
              <div className="container relative">
                <div className="relative py-5 sm:my-20 lg:my-28 2xl:my-40">
                  <div className="bg-gradient-to-l from-[#FF4199] to-[#AB41FF] rounded-[20px] p-5 sm:p-[30px] lg:p-[60px] lg:px-[70px] lg:py-[90px] flex flex-col">
                    <div className="flex flex-col sm:flex-row h-full">
                      <div className="w-full sm:w-1/2 md:w-1/3 xl:w-1/2">
                        <h3 className="text-xl text-white sm:text-3xl md:text-4xl font-bold mb-6 sm:mb-14 whitespace-nowrap text-center sm:text-left">
                          For more <span className="text-[#FFBF42]">freedom</span>
                          <br />
                          download the app
                        </h3>
                        <div className="flex flex-col gap-4 xl:flex-row text-center sm:text-left items-center sm:items-start">
                          <a href="#" className="w-[172px] sm:w-[200px] lg:w-[225px] border-2 rounded-full space-x-2 sm:space-x-3 px-3 sm:px-5 py-2 flex items-center">
                            <svg className="fill-white h-6 w-6 sm:h-7 sm:w-7" viewBox="0 0 384 512">
                              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                            </svg>
                            <div>
                              <p className="text-xs sm:text-sm text-white">Download on the<br />App store</p>
                            </div>
                          </a>

                          <a href="#" className="w-[172px] sm:w-[200px] lg:w-[225px] border-2 rounded-full space-x-2 sm:space-x-3 px-3 sm:px-5 py-2 flex items-center">
                            <svg className="fill-white h-5 w-5 sm:h-7 sm:w-7" viewBox="0 0 512 512">
                              <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
                            </svg>
                            <div>
                              <p className="text-xs sm:text-sm text-white">Download on the<br />Google Play</p>
                            </div>
                          </a>
                        </div>
                      </div>

                      <a href="" className="text-white w-full sm:1/2 md:w-2/3 xl:w-1/2 z-10 self-end font-mono text-[18px] md:text-2xl relative text-center sm:text-left mt-6 sm:mt-0">
                        Apple Watch Support
                        <div className="hidden sm:block absolute top-[-85px] left-[50px] md:left-[110px]">
                          <svg 
                            className="w-8 h-8 text-white" 
                            fill="currentColor" 
                            viewBox="0 0 24 24"
                            role="presentation"
                          >
                            <path d="M7 14l5-5 5 5z"/>
                          </svg>
                        </div>
                      </a>
                    </div>
                  </div>

                  {/* /images/devices-{400,600,800}w.webp variants were lost
                      during the monorepo migration; only devices.png exists.
                      Drop the broken srcSet so the browser falls back to the
                      single PNG instead of 404'ing. */}
                  <img loading="lazy"
                    decoding="async"
                    width={1200}
                    height={750}
                    className="hidden sm:block h-[420px] sm:h-[350px] md:h-[450px] lg:h-[600px] xl:h-[550px] 2xl:h-[630px] absolute top-[-40px] lg:top-[-90px] 2xl:top-[-130px] right-0 lg:right-[50px] 2xl:right-[120px] pointer-events-none"
                    src="/images/devices.webp"
                    alt="Radio streaming on multiple devices - phone, tablet, and desktop" />
                </div>
                <img loading="lazy" className="pointer-events-none absolute left-[-15%] top-[-50%]" src="/images/bg-gradient-blue.svg" alt="" role="presentation" />
              </div>
            )}

        {/* LAYOUT WITH PROPER PADDING - EXACT from default.vue */}
        <div className="flex-1 w-full mx-auto">
            <div className="container pb-6">
              <HomeSignupBanner />
            </div>
            <HomeStationGuide />
            <HomeFaq />

          </div>

        </div>
        

      </div>

      {/* BOTTOM PLAYER is now handled globally by App.tsx */}
      
      {/* Footer is now handled in App.tsx */}
      
      {/* Auth Modal for Favorites */}

      {/* Structured Data for homepage content */}
      {stations && stations.length > 0 && (
        <ListStructuredData
          type="stations"
          items={stations}
          listName="Popular Radio Stations"
          listDescription="Discover the most popular radio stations from around the world on Mega Radio"
          breadcrumbs={[
            { name: "Home", url: `/${window.location.pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] || 'en'}/` },
            { name: "Popular Stations", url: `/${window.location.pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] || 'en'}/` }
          ]}
        />
      )}

      {popularStations && popularStations.length > 0 && !stations && (
        <ListStructuredData
          type="stations"
          items={popularStations}
          listName="Featured Radio Stations"
          listDescription="Top-rated radio stations handpicked for the best listening experience"
        />
      )}

      {genres && genres.length > 0 && (
        <ListStructuredData
          type="genres"
          items={genres}
          listName="Music Genres"
          listDescription="Browse radio stations by music genre - from Pop to Jazz, Rock to Classical"
          currentCountry={selectedCountry}
        />
      )}

      {/* About Section Hidden for Cleaner Homepage */}

    </div>
  );
}
