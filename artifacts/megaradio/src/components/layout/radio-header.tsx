import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import { fetchStationCardList } from '@/lib/station-card-list-request';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from '@/lib/queryClient';
import { notificationTarget } from '@/lib/notification-target';
import { tvPairingLoginReturnTo, withAuthReturnTo } from '@/lib/safe-auth-return';
import { Link, useLocation } from "wouter";
import { User } from "lucide-react";
import notificationIcon from "@assets/notification1.png";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useAuth } from "@/hooks/useAuth";
import { UserMenuDropdown } from "@/components/ui/UserMenuDropdown";
import { PublicProfileAvatar } from "@/components/ui/public-profile-avatar";
// 🚀 LAZY: modal only loads on first open
const AddYourStationModal = lazy(() => import("@/components/modals/AddYourStationModal"));
const MobileNavigation = lazy(() => import('./mobile-navigation'));
const QuickSearchDialog = lazy(() => import('./quick-search-dialog'));
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatSearchVoteCount } from '@/lib/search-presentation';
import { getQuickSearchCopy } from '@/lib/quick-search-copy';
import { requestHomeSearch } from '@/lib/home-search';
import { useTranslation } from "@/hooks/useTranslation";
import { getProfileNavCopy } from '@/lib/profile-nav-copy';
import { logoutAccount } from '@/lib/logout';
import { toast } from '@/hooks/use-toast';
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { URL_TRANSLATIONS } from "@workspace/seo-shared/url-translations";
import { getImageUrl, getUserDisplayName } from "@/lib/utils";
import { getStationUrl } from "@/utils/slugs";
import { StationLogo } from "@/components/ui/station-logo";
import { HeaderBrand } from './header-brand';
import { getCountryCodeFromApiName, getLanguageForCountry } from "@workspace/seo-shared/seo-config";
import {
  canonicalizeCountry,
  countrySlug,
  getRegionSlugForCountry,
} from "@workspace/seo-shared/country-regions";
import { Music, Globe, ThumbsUp, Crown, Heart, Compass, MessageCircle, MessageSquareWarning, LogOut } from "lucide-react";
import {
  buildDropdownKeyHandler as buildSharedDropdownKeyHandler,
  focusFirstInside as focusFirstInsideShared,
} from "@/lib/dropdown-keyboard";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";

interface RadioHeaderProps {
  profileLayout?: boolean;
  showSearch?: boolean;
  showAddStationModal?: boolean;
  setShowAddStationModal?: (show: boolean) => void;
  selectedCountry?: string;
  onCountryChange?: (country: string, isManual?: boolean) => void;
}

export default function RadioHeader({ 
  profileLayout = false,
  showSearch = true,
  showAddStationModal = false,
  setShowAddStationModal,
  selectedCountry = "all",
  onCountryChange
}: RadioHeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [internalAddStationOpen, setInternalAddStationOpen] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [isNotificationDropdownOpen, setIsNotificationDropdownOpen] = useState(false);
  const [isMobileProfileMenuOpen, setIsMobileProfileMenuOpen] = useState(false);
  
  const { t, setLanguage, localeTranslations } = useTranslation();
  const { getLocalizedUrl, cleanPath, navigateTranslated, currentLanguage } = useSeoRouting();
  const quickSearchCopy = getQuickSearchCopy(currentLanguage);
  const profileNavCopy = getProfileNavCopy(currentLanguage);
  const englishProfileNav = getProfileNavCopy('en');
  const profileNavLabel = (key: string, name: keyof typeof profileNavCopy) => {
    const value = localeTranslations?.[key]?.trim();
    return value && !(currentLanguage !== 'en' && value === englishProfileNav[name]) ? value : profileNavCopy[name];
  };
  const langPrefix = currentLanguage === "en" ? "" : `/${currentLanguage}`;
  // 2026-05-12 SEO audit: header search dropdown was emitting hardcoded
  // /<lang>/regions/... links, but per-language routes expect the
  // translated segment (e.g. /tr/bolgeler/...). Resolve from the shared
  // URL_TRANSLATIONS map; falls back to "regions" for English / unknown.
  const getLocalizedRegionsSegment = (): string =>
    URL_TRANSLATIONS[currentLanguage]?.['regions'] || 'regions';
  const [location, setLocation] = useLocation();
  const loginReturnTo = tvPairingLoginReturnTo(location, typeof window === 'undefined' ? '' : window.location.search);
  
  // Use getLanguageForCountry helper from @shared/seo-config (single source of truth)
  
  // Country selection state
  const [selectedCountryObj, setSelectedCountryObj] = useState<{ name: string; code: string } | null>(null);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [filteredStations, setFilteredStations] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);
  const openSearch = useCallback((event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!showSearch) return;
    searchReturnFocusRef.current = event?.currentTarget ||
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setIsMobileMenuOpen(false);
    setIsCountryDropdownOpen(false);
    setIsNotificationDropdownOpen(false);
    setIsMobileProfileMenuOpen(false);
    if (cleanPath === '/' && requestHomeSearch(searchReturnFocusRef.current)) {
      setIsSearchOpen(false);
      return;
    }
    setIsSearchOpen(true);
  }, [showSearch, cleanPath]);

  useEffect(() => {
    if (!showSearch) return;
    const onShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.altKey) return;
      const command = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.ctrlKey && !event.metaKey;
      if (!command && !slash) return;
      const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
      if (event.composedPath().some(target => target instanceof Element && !!target.closest(editable))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [showSearch, openSearch]);
  
  // Touch handling for mobile scroll
  const [touchStartY, setTouchStartY] = useState<number>(0);
  const [touchStartTime, setTouchStartTime] = useState<number>(0);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
    }
  }, []);
  
  // Refs for positioning dropdown
  const countryButtonRef = useRef<HTMLButtonElement>(null);
  const countryButtonDesktopRef = useRef<HTMLButtonElement>(null);
  const countryButtonMobileRef = useRef<HTMLButtonElement>(null);
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  // Tracks the trigger button that opened the country dropdown so keyboard
  // users get focus restored to it on close (Escape / selection).
  const lastCountryTriggerRef = useRef<HTMLButtonElement | null>(null);

  const toggleCountryDropdown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      lastCountryTriggerRef.current = e.currentTarget;
      setIsCountryDropdownOpen((prev) => !prev);
    },
    []
  );

  const closeCountryDropdownAndRestoreFocus = useCallback(() => {
    setIsCountryDropdownOpen(false);
    setCountrySearchQuery("");
    // Defer focus restore until after the portal unmounts so the browser does
    // not move focus elsewhere first.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        lastCountryTriggerRef.current?.focus();
      });
    }
  }, []);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonDesktopRef = useRef<HTMLButtonElement>(null);
  const mobileProfileButtonRef = useRef<HTMLDivElement>(null);
  // Tracks the trigger button that opened the notification or mobile profile
  // dropdown so keyboard users get focus restored to it on close.
  const lastNotificationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileProfileTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  // Refs to the rendered dropdown roots, used for the on-open focus move and
  // the Tab/Shift+Tab focus trap inside each open popover.
  const notificationDropdownRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileDropdownRef = useRef<HTMLDivElement | null>(null);

  const toggleNotificationDropdown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      lastNotificationTriggerRef.current = e.currentTarget;
      setIsNotificationDropdownOpen((prev) => !prev);
    },
    []
  );

  const closeNotificationDropdownAndRestoreFocus = useCallback(() => {
    setIsNotificationDropdownOpen(false);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        lastNotificationTriggerRef.current?.focus();
      });
    }
  }, []);

  const toggleMobileProfileMenu = useCallback(() => {
    setIsMobileProfileMenuOpen((prev) => !prev);
  }, []);

  const closeMobileProfileMenuAndRestoreFocus = useCallback(() => {
    setIsMobileProfileMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        mobileProfileTriggerButtonRef.current?.focus();
      });
    }
  }, []);

  // Focus the first focusable element in a dropdown root once it mounts. If
  // there is nothing focusable, fall back to focusing the root container so
  // Escape and the Tab trap still work.
  const focusFirstInside = useCallback((root: HTMLElement | null) => {
    focusFirstInsideShared(root);
  }, []);

  useEffect(() => {
    if (!isNotificationDropdownOpen) return;
    const id = window.requestAnimationFrame(() => {
      focusFirstInside(notificationDropdownRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isNotificationDropdownOpen, focusFirstInside]);

  useEffect(() => {
    if (!isMobileProfileMenuOpen) return;
    const id = window.requestAnimationFrame(() => {
      focusFirstInside(mobileProfileDropdownRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isMobileProfileMenuOpen, focusFirstInside]);

  // Build a keyboard handler that traps Tab/Shift+Tab inside the open
  // dropdown and closes it (with focus restore) on Escape.
  const buildDropdownKeyHandler = useCallback(
    (rootRef: React.RefObject<HTMLDivElement | null>, close: () => void) =>
      buildSharedDropdownKeyHandler<HTMLDivElement>(rootRef, close),
    []
  );

  const { playStation } = useGlobalPlayer();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isPremium } = usePremiumStatus();
  const notificationQueryClient = useQueryClient();
  const notificationUserId = user?._id || (user as any)?.id || '';

  // Fetch user notifications (with 30s polling for real-time message notifications)
  const { data: notificationsData, isLoading: notificationsLoading, isError: notificationsError } = useQuery({
    queryKey: ['/api/user/notifications', notificationUserId, 1, 10, 'all'],
    queryFn: async ({ signal }) => {
      const response = await apiRequest('GET', '/api/user/notifications?page=1&limit=10', { signal });
      return response.json();
    },
    enabled: !!isAuthenticated && !!notificationUserId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const notifications = (notificationsData as any)?.notifications || [];
  const unreadCount = (notificationsData as any)?.unreadCount || 0;
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobileDevice(window.innerWidth < 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close search dropdown when route changes
  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setIsMobileMenuOpen(false);
  }, [location]);

  // Handle click outside to close country dropdown and notification dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Don't close if clicking on any country button (including mobile)
      const countryButtons = document.querySelectorAll('[data-country-button], .country-selector');
      for (let i = 0; i < countryButtons.length; i++) {
        if (countryButtons[i].contains(target)) {
          return;
        }
      }
      
      // Don't close if clicking inside the search bar or search results
      const searchElements = document.querySelectorAll('[data-search-element]');
      for (let i = 0; i < searchElements.length; i++) {
        if (searchElements[i].contains(target)) {
          return;
        }
      }
      
      // Don't close if clicking inside the country dropdown (portal rendered elements)
      const countryDropdownElements = document.querySelectorAll('[data-country-dropdown]');
      for (let i = 0; i < countryDropdownElements.length; i++) {
        if (countryDropdownElements[i].contains(target)) {
          return;
        }
      }
      
      // Check for notification dropdown clicks (button or dropdown itself)
      const notificationElements = document.querySelectorAll('button[aria-label="Notifications"], [data-notification-dropdown]');
      let clickedNotificationElement = false;
      for (let i = 0; i < notificationElements.length; i++) {
        if (notificationElements[i].contains(target)) {
          clickedNotificationElement = true;
          break;
        }
      }
      
      if (!clickedNotificationElement) {
        setIsNotificationDropdownOpen(false);
      }
      
      // Check for mobile profile dropdown clicks
      const profileElements = document.querySelectorAll('[data-testid="button-mobile-profile"], [data-testid="mobile-profile-dropdown"]');
      let clickedProfileElement = false;
      for (let i = 0; i < profileElements.length; i++) {
        if (profileElements[i].contains(target)) {
          clickedProfileElement = true;
          break;
        }
      }
      
      if (!clickedProfileElement) {
        setIsMobileProfileMenuOpen(false);
      }
      
      setIsCountryDropdownOpen(false);
      setCountrySearchQuery("");
      // Profile and notification menus close only for an outside target above.
      // Closing them on an inside mousedown removes links before click can fire.
    };

    if (isCountryDropdownOpen || isNotificationDropdownOpen || isMobileProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCountryDropdownOpen, isNotificationDropdownOpen, isMobileProfileMenuOpen]);

  // Dropdown scroll prevention handled by backdrop only - no body manipulation

  // Fetch countries for dropdown from stations - OPTIMIZED with cache
  const { data: countriesRaw = [], isLoading: countriesLoading } = useQuery<string[]>({
    queryKey: ['/api/filters/countries'],
    staleTime: 10 * 60 * 1000, // 10 minutes - country list rarely changes
    gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
  });

  // Convert string array to objects format expected by the frontend
  // Memoized to prevent recalculation on every render
  // DROPDOWN RENDER FIX (2026-07-04): the raw list can contain duplicate
  // names (e.g. "Sao Tome And Principe" twice) and getCountryCode's
  // first-two-letters fallback collides for unmapped names ("The Central
  // African Republic" -> 'th' = Thailand's real ISO code). Both fed
  // duplicate React keys / element ids in the dropdown lists, which broke
  // React's list reconciliation: the typed filter computed correctly but
  // the DOM kept showing a stale, garbage subset. Dedupe here (by trimmed
  // name) and use index-scoped keys below.
  const countries = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string; code: string; displayName: string }> = [];
    for (const raw of countriesRaw) {
      const name = String(raw ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, code: getCountryCode(name), displayName: getLocalizedCountryDisplayName(name, currentLanguage) });
    }
    return out;
  }, [countriesRaw, currentLanguage]);
  
  // Get selected country code directly from seo-config (no need to wait for countries API)
  const selectedCountryCode = useMemo(() => {
    if (selectedCountry === "all" || selectedCountry === "Global") return null;
    return getCountryCodeFromApiName(selectedCountry);
  }, [selectedCountry]);

  const selectedCountryDisplayName = useMemo(() =>
    selectedCountry === 'all' || selectedCountry === 'Global'
      ? t('nav_global', 'Global')
      : getLocalizedCountryDisplayName(selectedCountry, currentLanguage),
  [selectedCountry, currentLanguage, t]);

  // Filter countries based on search.
  // SEARCH FOLD (2026-07-04): diacritic-insensitive matching so 'turk' finds
  // 'Türkiye', 'cote' finds 'Côte d'Ivoire', etc. NFD strips combining marks;
  // the explicit Turkish dotless-i mappings cover the one case NFD doesn't.
  const foldForSearch = (v: string): string =>
    v
      .toLowerCase()
      .replace(/\u0131/g, 'i') // dotless i
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const filteredCountries = useMemo(() => {
    if (!countries) return [];

    if (!countrySearchQuery.trim()) {
      return countries; // Show all countries when no search query
    }

    const q = foldForSearch(countrySearchQuery.trim());
    return countries.filter((country) =>
      [country.name, country.displayName, country.code].some(value => foldForSearch(value || '').includes(q))
    );
  }, [countries, countrySearchQuery]);

  // Helper function to get country code from country name
  // Uses getCountryCodeFromApiName from seo-config which handles all 232 countries + aliases
  function getCountryCode(countryName: string): string {
    return getCountryCodeFromApiName(countryName);
  }
  


  // Genre search results for the header dropdown (mirrors /search)
  const { data: genresSearchData, isFetching: isGenresFetching, isError: genreSearchError } = useQuery<{
    genres?: Array<{ slug: string; name: string; stationCount?: number }>;
    data?: Array<{ slug: string; name: string; stationCount?: number }>;
  }>({
    queryKey: ['/api/genres', { search: debouncedSearchQuery, limit: 5 }],
    enabled: isSearchOpen && debouncedSearchQuery.trim().length >= 2,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        search: debouncedSearchQuery.trim(),
        limit: '5',
        page: '1',
      });
      const res = await fetch(`/api/genres?${params}`, { signal });
      if (!res.ok) throw new Error('Genre search failed');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // Rich country list (small, cached) — filtered client-side just like /search
  const { data: richCountries = [], isFetching: isCountriesFetching, isError: countrySearchError } = useQuery<Array<{ name: string; stationCount?: number }>>({
    queryKey: ['/api/countries', 'rich'],
    enabled: isSearchOpen,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/countries?format=rich`, { signal });
      if (!res.ok) throw new Error('Country list failed');
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  const matchingGenres = useMemo(
    () => (genresSearchData?.genres || genresSearchData?.data || []).slice(0, 5),
    [genresSearchData]
  );

  const matchingCountries = useMemo(() => {
    const term = foldForSearch(debouncedSearchQuery.trim());
    if (term.length < 2 || !richCountries.length) return [];
    const seen = new Set<string>();
    const hits: Array<{ name: string; displayName: string; canonical: string; regionSlug: string; stationCount?: number }> = [];
    for (const c of richCountries) {
      if (!c?.name) continue;
      const displayName = getLocalizedCountryDisplayName(c.name, currentLanguage);
      if (![c.name, displayName, getCountryCode(c.name)].some(value => foldForSearch(value || '').includes(term))) continue;
      const canonical = canonicalizeCountry(c.name);
      if (seen.has(canonical)) continue;
      const regionSlug = getRegionSlugForCountry(canonical);
      if (!regionSlug) continue;
      seen.add(canonical);
      hits.push({ name: c.name, displayName, canonical, regionSlug, stationCount: c.stationCount });
      if (hits.length >= 5) break;
    }
    return hits;
  }, [debouncedSearchQuery, richCountries, currentLanguage]);

  // Station search — AbortController cancels any in-flight request when the
  // debounced term changes, preventing stale responses from overwriting fresh ones.
  useEffect(() => {
    const searchTerm = debouncedSearchQuery.trim();

    if (!isSearchOpen || searchTerm.length < 2) {
      setFilteredStations([]);
      setIsSearching(false);
      setSearchError(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);
    setSearchError(false);

    const params = new URLSearchParams({ search: searchTerm, limit: '20' });
    fetchStationCardList(params, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!controller.signal.aborted) setFilteredStations(data.stations ?? data.data ?? []);
      })
      .catch(err => {
        // AbortError is expected when the effect re-runs — not a real error.
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setFilteredStations([]);
          setSearchError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });

    return () => controller.abort();
  }, [debouncedSearchQuery, isSearchOpen]);

  // Close search and other modals when mobile menu opens
  useEffect(() => {
    if (isMobileMenuOpen) {
      setIsSearchOpen(false);
      setSearchQuery("");
      setIsCountryDropdownOpen(false);
      setCountrySearchQuery("");
    }
  }, [isMobileMenuOpen]);

  const searchLoading = (searchQuery.trim().length >= 2 && debouncedSearchQuery !== searchQuery) || isSearching || isGenresFetching || isCountriesFetching;
  const hasAnyResults = filteredStations.length > 0 || matchingGenres.length > 0 || matchingCountries.length > 0;

  // Keyboard navigation for the header search dropdown — mirrors /search.
  // Items are flattened in display order: genres → countries → stations.
  const PAGE_STEP = 10;
  const STATION_LIMIT = 20;
  const visibleStations = useMemo(
    () => filteredStations.slice(0, STATION_LIMIT),
    [filteredStations]
  );
  const flatSearchItems = useMemo(() => {
    type Item =
      | { kind: 'genre'; id: string; href: string }
      | { kind: 'country'; id: string; href: string }
      | { kind: 'station'; id: string; station: any };
    const items: Item[] = [];
    for (const g of matchingGenres) {
      items.push({
        kind: 'genre',
        id: `genre-${g.slug}`,
        href: getLocalizedUrl(`/genres/${encodeURIComponent(g.slug)}`),
      });
    }
    for (const c of matchingCountries) {
      items.push({
        kind: 'country',
        id: `country-${c.canonical}`,
        // 2026-05-12 SEO audit: was hardcoded `regions` which produced
        // /tr/regions/... 404s when the matched route expects the
        // language-translated segment (e.g. /tr/bolgeler/...). Use the
        // shared URL_TRANSLATIONS lookup so every language gets the
        // correct localized prefix.
        href: `${langPrefix}/${getLocalizedRegionsSegment()}/${c.regionSlug}/${countrySlug(c.canonical)}`,
      });
    }
    visibleStations.forEach((station: any, idx: number) => {
      const slug = station.slug || station._id || idx;
      items.push({
        kind: 'station',
        id: `station-${slug}-${idx}`,
        station,
      });
    });
    return items;
  }, [matchingGenres, matchingCountries, visibleStations, langPrefix]);

  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchItemRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const suppressSearchHoverRef = useRef(false);

  useEffect(() => {
    const onMove = () => { suppressSearchHoverRef.current = false; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Reset highlight whenever the query or the result set changes
  useEffect(() => {
    setActiveSearchIndex(-1);
  }, [debouncedSearchQuery]);

  useEffect(() => {
    if (activeSearchIndex >= flatSearchItems.length) setActiveSearchIndex(-1);
  }, [flatSearchItems.length, activeSearchIndex]);

  // Reset when the dropdown closes
  useEffect(() => {
    if (!isSearchOpen) setActiveSearchIndex(-1);
  }, [isSearchOpen]);

  // Scroll the highlighted item into view
  useEffect(() => {
    if (activeSearchIndex < 0) return;
    const item = flatSearchItems[activeSearchIndex];
    if (!item) return;
    const el = searchItemRefs.current.get(item.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeSearchIndex, flatSearchItems]);

  const setSearchItemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) searchItemRefs.current.set(id, el);
      else searchItemRefs.current.delete(id);
    },
    []
  );

  const setActiveSearchById = useCallback(
    (id: string) => {
      if (suppressSearchHoverRef.current) return;
      const idx = flatSearchItems.findIndex((it) => it.id === id);
      if (idx >= 0) setActiveSearchIndex(idx);
    },
    [flatSearchItems]
  );

  const activateSearchItem = useCallback(
    (item: typeof flatSearchItems[number]) => {
      if (item.kind === 'station') {
        playStation(item.station);
        setIsSearchOpen(false);
        setSearchQuery('');
        setLocation(getStationUrl(item.station));
      } else {
        setIsSearchOpen(false);
        setSearchQuery('');
        setLocation(item.href);
      }
    },
    [playStation, setLocation]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
      return;
    }
    // Don't navigate or activate when the dropdown isn't showing results.
    // Without this, a short window exists where the user can press Enter on
    // stale results after backspacing the query below the 2-char threshold.
    if (e.nativeEvent.isComposing || searchLoading || searchQuery.trim().length < 2 || flatSearchItems.length === 0) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => (i < 0 ? 0 : (i + 1) % flatSearchItems.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => (i <= 0 ? flatSearchItems.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex(flatSearchItems.length - 1);
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => Math.min((i < 0 ? 0 : i) + PAGE_STEP, flatSearchItems.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => Math.max((i < 0 ? 0 : i) - PAGE_STEP, 0));
      return;
    }
    if (e.key === 'Enter') {
      const target = flatSearchItems[activeSearchIndex] ?? flatSearchItems[0];
      if (target) {
        e.preventDefault();
        activateSearchItem(target);
      }
    }
  };

  const activeSearchId =
    activeSearchIndex >= 0 ? flatSearchItems[activeSearchIndex]?.id ?? null : null;

  // ---------- Country picker keyboard navigation ----------
  const countryItems = useMemo(() => {
    const items: Array<{ id: string; activate: () => void }> = [
      {
        id: 'global',
        activate: () => {
          onCountryChange?.("all", true);
          closeCountryDropdownAndRestoreFocus();
        },
      },
    ];
    for (const country of filteredCountries) {
      const code = country.code || country.name;
      items.push({
        id: `country-${code}`,
        activate: () => {
          onCountryChange?.(country.name, true);
          if (isAuthenticated) {
            setSelectedCountryObj({ name: country.name, code: country.code });
          }
          localStorage.setItem('selectedCountry', country.name);
          localStorage.setItem('countryPreference', 'manual');
          closeCountryDropdownAndRestoreFocus();
        },
      });
    }
    return items;
  }, [filteredCountries, isAuthenticated, onCountryChange, closeCountryDropdownAndRestoreFocus]);

  const [activeCountryIndex, setActiveCountryIndex] = useState(-1);
  const countryItemRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const suppressCountryHoverRef = useRef(false);

  useEffect(() => {
    const onMove = () => { suppressCountryHoverRef.current = false; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Reset highlight when search query changes or dropdown closes
  useEffect(() => {
    setActiveCountryIndex(-1);
  }, [countrySearchQuery]);
  useEffect(() => {
    if (!isCountryDropdownOpen) setActiveCountryIndex(-1);
  }, [isCountryDropdownOpen]);
  useEffect(() => {
    if (activeCountryIndex >= countryItems.length) setActiveCountryIndex(-1);
  }, [countryItems.length, activeCountryIndex]);

  // Scroll the highlighted country into view
  useEffect(() => {
    if (activeCountryIndex < 0) return;
    const item = countryItems[activeCountryIndex];
    if (!item) return;
    const el = countryItemRefs.current.get(item.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeCountryIndex, countryItems]);

  const setCountryItemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) countryItemRefs.current.set(id, el);
      else countryItemRefs.current.delete(id);
    },
    []
  );

  const setActiveCountryById = useCallback(
    (id: string) => {
      if (suppressCountryHoverRef.current) return;
      const idx = countryItems.findIndex((it) => it.id === id);
      if (idx >= 0) setActiveCountryIndex(idx);
    },
    [countryItems]
  );

  const handleCountryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (countrySearchQuery !== '') {
        setCountrySearchQuery('');
        setActiveCountryIndex(-1);
      } else {
        closeCountryDropdownAndRestoreFocus();
      }
      return;
    }
    // Trap Tab/Shift+Tab inside the dropdown so focus does not leak back to
    // the page while the picker is open. The search input is the only
    // focusable element inside the dropdown, so we just keep focus on it.
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
    if (countryItems.length === 0) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => (i < 0 ? 0 : (i + 1) % countryItems.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => (i <= 0 ? countryItems.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex(countryItems.length - 1);
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => Math.min((i < 0 ? 0 : i) + PAGE_STEP, countryItems.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => Math.max((i < 0 ? 0 : i) - PAGE_STEP, 0));
      return;
    }
    if (e.key === 'Enter') {
      const target = countryItems[activeCountryIndex] ?? countryItems[0];
      if (target) {
        e.preventDefault();
        target.activate();
      }
    }
  };

  const activeCountryId =
    activeCountryIndex >= 0 ? countryItems[activeCountryIndex]?.id ?? null : null;
  const countryFocusRingClass = 'ring-2 ring-[#FF4199] ring-inset';

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 w-full text-white">
        <div className="flex w-full items-center justify-center bg-black">
          {/* Profile chrome spans the viewport; public pages retain the centered container. */}
          {/* CRITICAL: Desktop nav shows at xl(1280px) to prevent overflow on tablet */}
          <div className={`container ${profileLayout ? 'lg:max-w-none lg:px-[30px]' : ''} relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center max-sm:!px-5 xl:flex xl:gap-4 min-[1400px]:gap-5 h-[70px] md:h-[80px] lg:h-[90px] xl:h-[105px]`}>
            
            <div className="contents xl:flex xl:items-center">
              {/* Mobile Menu Toggle - hidden on desktop (xl+) */}
              <button
                ref={mobileMenuTriggerRef}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="-ml-3 flex size-12 items-center justify-center text-white xl:hidden"
                aria-label={t('nav_menu', 'Menu')}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-navigation"
                aria-haspopup="dialog"
                data-testid="button-mobile-menu"
              >
                {isMobileMenuOpen ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <img src="/icons/header/menu.svg" width="24" height="24" alt="" />
                )}
              </button>

              <HeaderBrand href={getLocalizedUrl("/")} variant={profileLayout ? 'profile' : 'public'} />
            </div>

            <div className="ml-auto hidden min-w-0 items-center gap-3 xl:flex min-[1400px]:gap-4 2xl:gap-5 [&>.nav-item]:min-w-0 [&>.nav-item]:truncate [&>.nav-item]:px-0 [&>.nav-item]:text-sm min-[1400px]:[&>.nav-item]:text-[15px]">
              <Link href={getLocalizedUrl("/genres")} title={t('nav_genres', 'Genres')} className="nav-item">{t('nav_genres', 'Genres')}</Link>
              <Link href={getLocalizedUrl("/request-station")} title={t('modal_request_station_title', 'Request a Station')} className="nav-item">{t('modal_request_station_title', 'Request a Station')}</Link>
              <button 
                type="button"
                onClick={() => setShowAddStationModal ? setShowAddStationModal(true) : setInternalAddStationOpen(true)}
                className="nav-item"
                title={t('nav_add_your_station', 'Add your station')}
              >
                {t('nav_add_your_station', 'Add your station')}
              </button>
              <Link href={getLocalizedUrl('/profile/favorites')} title={profileNavLabel('nav_your_favorites', 'favorites')} className="nav-item">
                {profileNavLabel('nav_your_favorites', 'favorites')}
              </Link>
              <Link href={getLocalizedUrl("/recommendations")} title={t('nav_for_you', 'For You')} className="nav-item">{t('nav_for_you', 'For You')}</Link>
            </div>

            <div className="flex shrink-0 items-center justify-self-end gap-[17px] sm:gap-3 min-[1400px]:gap-[15px]">
              {/* Mobile/Tablet: Authenticated users - Search + Bell + Country + Avatar (sıra: 1-2-3-4) */}
              {!authLoading && isAuthenticated && (
                <div className="flex h-[45px] items-center gap-3 max-sm:gap-[17px] xl:hidden">
                  {/* 1. Search Icon - Mobile only */}
                  <button
                    onClick={openSearch}
                    className="flex items-center justify-center flex-shrink-0 max-sm:absolute max-sm:left-[60px] max-sm:top-[23px]"
                    style={{ width: '24px', height: '24px' }}
                    aria-label={t('general_search', 'Search')}
                    data-testid="button-search-mobile"
                  >
                    <svg className="w-6 h-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                  
                  {/* 2. Notification Icon - Layout: 24x24, Icon: 24x24, Dot: 8x8 */}
                  <button
                    ref={notificationButtonRef}
                    onClick={toggleNotificationDropdown}
                    className="relative flex items-center justify-center flex-shrink-0 max-sm:absolute max-sm:left-[96px] max-sm:top-[23px]"
                    style={{ width: '24px', height: '24px' }}
                    aria-label="Notifications"
                    aria-haspopup="dialog"
                    aria-expanded={isNotificationDropdownOpen}
                    data-testid="button-notifications-mobile"
                  >
                    <img src={notificationIcon} alt="Notifications" style={{ width: '24px', height: '24px' }} />
                    {unreadCount > 0 && (
                      <span className="absolute bg-[#FF4199]" style={{ width: '8px', height: '8px', borderRadius: '30px', top: '1px', right: '0px' }} />
                    )}
                  </button>
                  
                  {/* 3. Country Selector - Layout: 34x34, border-radius: 4px, bg: #2F2F2F, border: 1px #2F2F2F */}
                  <button 
                    ref={countryButtonMobileRef}
                    onClick={toggleCountryDropdown}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: '34px', height: '34px', minWidth: '34px', minHeight: '34px', borderRadius: '4px', backgroundColor: '#0E0E0E', padding: '0px' }}
                    aria-label={t('general_select_country', 'Select country')}
                    aria-haspopup="listbox"
                    aria-expanded={isCountryDropdownOpen}
                    data-country-button
                    title={selectedCountryDisplayName}
                  >
                    {(selectedCountry === "all" || selectedCountry === "Global") ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="fill-[#FF4199]" style={{ width: '24px', height: '24px' }}>
                        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                      </svg>
                    ) : selectedCountryCode ? (
                      <img
                        src={`https://flagcdn.com/w80/${selectedCountryCode.toLowerCase()}.png`}
                        alt={selectedCountryDisplayName}
                        width={24}
                        height={24}
                        loading="lazy"
                        decoding="async"
                        style={{ width: '24px', height: '24px' }}
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                    )}
                  </button>
                  
                  {/* 3. User Avatar with Dropdown Menu - Layout: 45x45, border-radius: 50px */}
                  <div className="relative flex-shrink-0" ref={mobileProfileButtonRef}>
                    <button 
                      ref={mobileProfileTriggerButtonRef}
                      onClick={toggleMobileProfileMenu}
                      className="flex items-center justify-center overflow-hidden"
                      style={{ width: '45px', height: '45px', borderRadius: '50px' }}
                      aria-label="Profile menu"
                      aria-haspopup="menu"
                      aria-expanded={isMobileProfileMenuOpen}
                      data-testid="button-mobile-profile"
                    >
                      <PublicProfileAvatar profile={user ?? {}} name={getUserDisplayName(user)} className="size-[45px]" size={45} />
                    </button>
                  </div>
                </div>
              )}
              
              {/* Mobile/Tablet: NOT authenticated - Search + Country + Login */}
              {!authLoading && !isAuthenticated && (
                <>
                  {/* Search Icon - Mobile only */}
                  <button
                    onClick={openSearch}
                    className="xl:hidden flex items-center justify-center flex-shrink-0 max-sm:absolute max-sm:left-[60px] max-sm:top-[23px]"
                    style={{ width: '24px', height: '24px' }}
                    aria-label={t('general_search', 'Search')}
                    data-testid="button-search-mobile-guest"
                  >
                    <svg className="w-6 h-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                  
                  {/* Country Selector - Layout: 34x34, border-radius: 4px, bg: #2F2F2F, border: 1px #2F2F2F */}
                  <button 
                    ref={countryButtonMobileRef}
                    onClick={toggleCountryDropdown}
                    className="xl:hidden flex items-center justify-center flex-shrink-0"
                    style={{ width: '34px', height: '34px', minWidth: '34px', minHeight: '34px', borderRadius: '4px', backgroundColor: '#0E0E0E', padding: '0px' }}
                    aria-label={t('general_select_country', 'Select country')}
                    aria-haspopup="listbox"
                    aria-expanded={isCountryDropdownOpen}
                    data-country-button
                    title={selectedCountryDisplayName}
                  >
                    {(selectedCountry === "all" || selectedCountry === "Global") ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="fill-[#FF4199]" style={{ width: '24px', height: '24px' }}>
                        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.30-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                      </svg>
                    ) : selectedCountryCode ? (
                      <img
                        src={`https://flagcdn.com/w80/${selectedCountryCode.toLowerCase()}.png`}
                        alt={selectedCountryDisplayName}
                        width={24}
                        height={24}
                        loading="lazy"
                        decoding="async"
                        style={{ width: '24px', height: '24px' }}
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                    )}
                  </button>
                  
                  {/* Login Icon */}
                  <Link
                    href={withAuthReturnTo(getLocalizedUrl('/login'), loginReturnTo)}
                    className="flex size-[45px] shrink-0 items-center justify-center overflow-hidden rounded-full transition-colors hover:ring-1 hover:ring-white/40 focus-visible:ring-2 focus-visible:ring-[#FF4199] xl:hidden"
                    aria-label={t('nav_login', 'Log in')}
                    data-testid="button-mobile-login"
                  >
                    <img src="/icons/tv-connect/empty-avatar.svg" width="45" height="45" alt="" />
                  </Link>
                </>
              )}
              
              {/* Desktop only (xl+) */}
              {authLoading ? (
                <div className="hidden xl:flex items-center gap-[15px]">
                  <div className="nav-skeleton nav-skeleton-button loading-placeholder"></div>
                  <div className="nav-skeleton nav-skeleton-button loading-placeholder"></div>
                </div>
              ) : isAuthenticated ? (
                <>
                  {/* 3. Country Selector - desktop only (xl+) - Figma: 147x38px, border-radius 5px */}
                  <div className="hidden xl:block relative dropdown-container" ref={countryDropdownRef}>
                    <button 
                      ref={countryButtonDesktopRef}
                      onClick={toggleCountryDropdown}
                      className="country-selector flex items-center text-white bg-[#1D1D1D] hover:bg-[#2A2A2A] transition-colors overflow-hidden whitespace-nowrap"
                      style={{ width: '147px', height: '38px', borderRadius: '5px' }}
                      aria-label={`${selectedCountryDisplayName}: ${t('general_select_country', 'Select country')}`}
                      aria-haspopup="listbox"
                      aria-expanded={isCountryDropdownOpen}
                      title={selectedCountryDisplayName}
                    >
                      {/* Flag - Figma: 24x24px, left 9px - Uses selectedCountryCode directly (no API wait) */}
                      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: '24px', height: '24px', marginLeft: '9px' }}>
                        {(selectedCountry === "all" || selectedCountry === "Global") ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: '24px', height: '24px' }} className="fill-[#FF4199]">
                            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                          </svg>
                        ) : selectedCountryCode ? (
                          <img
                            src={`https://flagcdn.com/w40/${selectedCountryCode.toLowerCase()}.png`}
                            alt={selectedCountryDisplayName}
                            width={24}
                            height={24}
                            loading="lazy"
                            decoding="async"
                            style={{ width: '24px', height: '24px' }}
                            className="object-cover rounded-full"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                        )}
                      </div>
                      {/* Country text - Figma: Ubuntu Bold 15px, line-height 100%, left aligned */}
                      <span className="font-ubuntu font-bold text-white truncate flex-1 text-left" style={{ fontSize: '15px', lineHeight: '100%', marginLeft: '9px' }}>
                        {selectedCountryDisplayName}
                      </span>
                      {/* Arrow - Figma: 20x20px, pointing down */}
                      <svg className="text-white flex-shrink-0" style={{ width: '20px', height: '20px', marginRight: '10px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* 3. Search Button - desktop only (xl+) - Figma: 38x38px, #1D1D1D, rounded-[5px] */}
                  <button
                    onClick={openSearch}
                    className="hidden size-[38px] items-center justify-center rounded-[5px] bg-[#1D1D1D] transition-colors hover:bg-[#2A2A2A] xl:flex"
                    aria-label={`${t('general_search', 'Search')}: ${isMac ? '⌘K' : 'Ctrl K'}`}
                    aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
                    title={isMac ? '⌘K' : 'Ctrl+K'}
                  >
                    <img src="/icons/search-normal.svg" width="20" height="20" alt="" />
                  </button>

                  {/* 4. Vertical Divider */}
                  <div className="hidden xl:block w-[2px] h-[33px] bg-[#222222] rounded-sm" />

                  {/* Account notifications — grouped with the profile, after search */}
                  <button
                    ref={notificationButtonDesktopRef}
                    onClick={toggleNotificationDropdown}
                    className="hidden xl:flex relative items-center justify-center"
                    style={{ width: '24px', height: '24px' }}
                    aria-label="Notifications"
                    aria-haspopup="dialog"
                    aria-expanded={isNotificationDropdownOpen}
                    data-testid="button-notifications-desktop"
                  >
                    <img src={notificationIcon} alt="Notifications" style={{ width: '24px', height: '24px' }} />
                    {unreadCount > 0 && (
                      <span className="absolute bg-[#FF4199]" style={{ width: '8px', height: '8px', borderRadius: '30px', top: '1px', right: '0px' }} />
                    )}
                  </button>

                  {/* 5. User Section - Username + Avatar - Desktop only (xl+) */}
                  <Link 
                    href={getLocalizedUrl("/profile/favorites")}
                    className="hidden xl:flex min-w-0 items-center gap-4 hover:opacity-80 transition-opacity cursor-pointer"
                    data-testid="link-desktop-profile"
                    aria-label={getUserDisplayName(user)}
                    title={getUserDisplayName(user)}
                  >
                    {/* Figma followers: 25×5 px accent below the left edge of the name. */}
                    {user && (
                      <span className="relative flex h-[45px] min-w-0 items-center font-ubuntu text-[15px] font-bold text-white">
                        <span className="max-w-[180px] truncate">{getUserDisplayName(user)}</span>
                        <span aria-hidden="true" className="absolute bottom-0 left-0 h-[5px] w-[25px] bg-[#FF4199]" />
                      </span>
                    )}
                    <PublicProfileAvatar profile={user ?? {}} name={getUserDisplayName(user)} className="size-[45px]" size={45} />
                  </Link>
                </>
              ) : (
                <>
                  {/* NOT Authenticated: Country Selector + Search + Divider + Login + Sign Up */}
                  {/* Country Selector - desktop only (xl+) - Figma: 147x38px, border-radius 5px */}
                  <div className="hidden xl:block relative dropdown-container" ref={countryDropdownRef}>
                    <button 
                      ref={countryButtonRef}
                      onClick={toggleCountryDropdown}
                      className="country-selector flex items-center text-white bg-[#1D1D1D] hover:bg-[#2A2A2A] transition-colors overflow-hidden"
                      style={{ width: '147px', height: '38px', borderRadius: '5px' }}
                      aria-label={`${selectedCountryDisplayName}: ${t('general_select_country', 'Select country')}`}
                      aria-haspopup="listbox"
                      aria-expanded={isCountryDropdownOpen}
                      title={selectedCountryDisplayName}
                    >
                      {/* Flag - Figma: 24x24px, left 9px - Uses selectedCountryCode directly (no API wait) */}
                      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: '24px', height: '24px', marginLeft: '9px' }}>
                        {(selectedCountry === "all" || selectedCountry === "Global") ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: '24px', height: '24px' }} className="fill-[#FF4199]">
                            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                          </svg>
                        ) : selectedCountryCode ? (
                          <img
                            src={`https://flagcdn.com/w40/${selectedCountryCode.toLowerCase()}.png`}
                            alt={selectedCountryDisplayName}
                            width={24}
                            height={24}
                            loading="lazy"
                            decoding="async"
                            style={{ width: '24px', height: '24px' }}
                            className="object-cover rounded-full"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                        )}
                      </div>
                      {/* Country text - Figma: Ubuntu Bold 15px, line-height 100%, left aligned */}
                      <span className="font-ubuntu font-bold text-white truncate flex-1 text-left" style={{ fontSize: '15px', lineHeight: '100%', marginLeft: '9px' }}>
                        {selectedCountryDisplayName}
                      </span>
                      {/* Arrow - Figma: 20x20px, pointing down */}
                      <svg className="text-white flex-shrink-0" style={{ width: '20px', height: '20px', marginRight: '10px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Search Button - desktop only (xl+) - Figma: 38x38px */}
                  <button
                    onClick={openSearch}
                    className="hidden size-[38px] items-center justify-center rounded-[5px] bg-[#1D1D1D] transition-colors hover:bg-[#2A2A2A] xl:flex"
                    aria-label={`${t('general_search', 'Search')}: ${isMac ? '⌘K' : 'Ctrl K'}`}
                    aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
                    title={isMac ? '⌘K' : 'Ctrl+K'}
                  >
                    <img src="/icons/search-normal.svg" width="20" height="20" alt="" />
                  </button>
                  
                  {/* Vertical Divider - desktop only (xl+) */}
                  <div className="hidden xl:block w-[2px] h-[33px] bg-[#222222] rounded-sm" />
                  
                  <div className="hidden items-center gap-5 xl:flex">
                    <Link
                      href={withAuthReturnTo(getLocalizedUrl('/login'), loginReturnTo)}
                      className="inline-flex min-h-[45px] items-center whitespace-nowrap text-[15px] font-medium text-white transition-colors hover:text-[#FF4199]"
                    >
                      {t('nav_login', 'Log in')}
                    </Link>
                    <Link
                      href={getLocalizedUrl('/signup')}
                      className="inline-flex min-h-[45px] min-w-[97px] items-center justify-center whitespace-nowrap rounded-full bg-[#D82C80] px-4 text-[15px] font-medium text-white transition-colors hover:bg-[#C32470]"
                    >
                      {t('nav_signup', 'Sign Up')}
                    </Link>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      </nav>

      {isMobileMenuOpen && (
        <Suspense fallback={null}>
          <MobileNavigation open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}
            triggerRef={mobileMenuTriggerRef} isAuthenticated={isAuthenticated} authLoading={authLoading}
            onAddStation={() => {
              setIsMobileMenuOpen(false);
              if (setShowAddStationModal) setShowAddStationModal(true);
              else setInternalAddStationOpen(true);
            }} />
        </Suspense>
      )}

      {/* One interaction-gated surface for header buttons and Ctrl/Cmd+K. */}
      {isSearchOpen && showSearch && !isMobileMenuOpen && (
        <Suspense fallback={null}>
          <QuickSearchDialog title={quickSearchCopy.title} hint={quickSearchCopy.hint}
            onClose={closeSearch} inputRef={searchInputRef}
            returnFocusRef={searchReturnFocusRef}>
              <div className="home-search-input-row">
                <input
                  ref={searchInputRef}
                  data-testid="input-quick-search"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={quickSearchCopy.title}
                  placeholder={t('search_placeholder', 'Search stations, genres, countries…')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  onKeyDown={handleSearchKeyDown}
                  role="combobox"
                  aria-expanded={searchQuery.trim().length >= 2 && !searchLoading && hasAnyResults}
                  aria-controls="header-search-results"
                  aria-activedescendant={!searchLoading ? activeSearchId ?? undefined : undefined}
                  aria-autocomplete="list"
                  className="home-search-input"
                />
                <img className="home-search-icon" src="/icons/home-search/search-normal.svg" width="24" height="24" alt="" />
                <button type="button" onClick={closeSearch} aria-label={quickSearchCopy.close} className="home-search-close">
                  <img src="/icons/home-search/close-circle.svg" width="24" height="24" alt="" />
                </button>
                <img className="home-search-divider" src="/icons/home-search/divider.svg" alt="" />
              </div>

              {/* Search Results */}
              {searchQuery.trim().length >= 2 && (
                <>
                  <p className="home-search-count" aria-live="polite" aria-atomic="true">
                    {searchLoading ? t('general_searching', 'Searching...') : [
                      `${visibleStations.length} ${visibleStations.length === 1 ? t('station_found', 'station found') : t('stations_found', 'stations found')}`,
                      ...(matchingGenres.length ? [`${matchingGenres.length} ${t('search_section_genres', 'Genres')}`] : []),
                      ...(matchingCountries.length ? [`${matchingCountries.length} ${t('search_section_countries', 'Countries')}`] : []),
                    ].join(' · ')}
                  </p>
                <ScrollArea
                  type="auto"
                  className="home-search-results quick-search-results"
                  id="header-search-results"
                  role="listbox"
                  aria-label={quickSearchCopy.title}
                  aria-busy={searchLoading}
                >
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-10" role="status">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-transparent"></div>
                      <span className="ml-2 text-gray-300">{t('general_searching', 'Searching...')}</span>
                    </div>
                  ) : hasAnyResults ? (
                    <div className="space-y-2">
                      {matchingGenres.length > 0 && (
                        <div className="min-w-0">
                          <div className="quick-search-section-label">
                            <Music size={14} className="text-[#FF4199]" />
                            <span>{t('search_section_genres', 'Genres')}</span>
                          </div>
                          {matchingGenres.map((g) => {
                            const id = `genre-${g.slug}`;
                            const isActive = activeSearchId === id;
                            return (
                            <Link
                              key={id}
                              href={getLocalizedUrl(`/genres/${encodeURIComponent(g.slug)}`)}
                              ref={setSearchItemRef(id)}
                              id={id}
                              role="option"
                              aria-selected={isActive}
                              onMouseEnter={() => setActiveSearchById(id)}
                              onClick={() => {
                                setIsSearchOpen(false);
                                setSearchQuery("");
                              }}
                              className="home-search-option"
                              data-testid={`header-search-genre-${g.slug}`}
                            >
                              <div className="size-[38px] rounded-[6px] bg-white/10 flex items-center justify-center flex-shrink-0">
                                <Music size={16} className="text-[#FF4199]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="home-search-station-name capitalize">
                                  {g.name}
                                </div>
                                {typeof g.stationCount === 'number' && (
                                  <div className="text-xs text-white/80">
                                    {g.stationCount.toLocaleString()} {t('stations', 'stations')}
                                  </div>
                                )}
                              </div>
                            </Link>
                            );
                          })}
                        </div>
                      )}

                      {matchingCountries.length > 0 && (
                        <div className="min-w-0">
                          <div className="quick-search-section-label">
                            <Globe size={14} className="text-[#FF4199]" />
                            <span>{t('search_section_countries', 'Countries')}</span>
                          </div>
                          {matchingCountries.map((c) => {
                            const id = `country-${c.canonical}`;
                            const isActive = activeSearchId === id;
                            return (
                            <Link
                              key={id}
                              href={`${langPrefix}/${getLocalizedRegionsSegment()}/${c.regionSlug}/${countrySlug(c.canonical)}`}
                              ref={setSearchItemRef(id)}
                              id={id}
                              role="option"
                              aria-selected={isActive}
                              onMouseEnter={() => setActiveSearchById(id)}
                              onClick={() => {
                                setIsSearchOpen(false);
                                setSearchQuery("");
                              }}
                              className="home-search-option"
                              data-testid={`header-search-country-${countrySlug(c.canonical)}`}
                            >
                              <div className="size-[38px] rounded-[6px] bg-white/10 flex items-center justify-center flex-shrink-0">
                                <Globe size={16} className="text-[#FF4199]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="home-search-station-name">
                                  {c.displayName}
                                </div>
                                {typeof c.stationCount === 'number' && (
                                  <div className="text-xs text-white/80">
                                    {c.stationCount.toLocaleString()} {t('stations', 'stations')}
                                  </div>
                                )}
                              </div>
                            </Link>
                            );
                          })}
                        </div>
                      )}

                      {filteredStations.length > 0 && (
                        <div className="min-w-0">
                          {(matchingGenres.length > 0 || matchingCountries.length > 0) && (
                            <div className="quick-search-section-label">
                              <span>{t('search_section_stations', 'Stations')}</span>
                            </div>
                          )}
                      {visibleStations.map((station: any, index: number) => {
                        const slug = station.slug || station._id || index;
                        const id = `station-${slug}-${index}`;
                        const isActive = activeSearchId === id;
                        return (
                        <div
                          key={station._id || index}
                          ref={setSearchItemRef(id)}
                          id={id}
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveSearchById(id)}
                          className="home-search-option"
                          onClick={() => {
                            playStation(station);
                            setIsSearchOpen(false);
                            setSearchQuery("");
                            // Use localized URL for station
                            const stationUrl = getStationUrl(station);
                            setLocation(stationUrl);
                          }}
                        >
                          <div className="relative size-[38px] flex-shrink-0">
                            <StationLogo station={station} size="md" sizes="38px" className="w-[38px] h-[38px] rounded-[6px]" />
                            {station.countryCode && (
                              <img loading="lazy" src={`https://flagcdn.com/w80/${station.countryCode.toLowerCase()}.webp`}
                                width="16" height="16" alt="" className="absolute -bottom-1 -right-1 size-4 rounded-full border border-white/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="home-search-station-name">
                              {station.name}
                            </div>
                            <div className="text-xs text-white/80 truncate">
                              {getLocalizedCountryDisplayName(station.country || '', currentLanguage)}
                            </div>
                          </div>
                          
                          {/* Station Votes */}
                          {station.votes !== undefined && (
                            <div className="flex items-center gap-1 text-xs text-white/70 flex-shrink-0 ms-2">
                              <ThumbsUp className="size-3" aria-hidden="true" />
                              <span>{formatSearchVoteCount(station.votes || 0)}</span>
                            </div>
                          )}
                        </div>
                        );
                      })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-gray-400" role="status">
                      {searchError || genreSearchError || countrySearchError
                        ? t('general_error_loading', 'Could not load results. Please try again.')
                        : t('search_no_results', 'No stations, genres or countries match your search.')}
                    </div>
                  )}
                </ScrollArea>
                </>
              )}

              {searchQuery.trim().length < 2 && (
                <div className="quick-search-empty">
                  <p>{t('search_min_chars_hint', 'Type at least 2 characters to start searching.')}</p>
                </div>
              )}

          </QuickSearchDialog>
        </Suspense>
      )}

      {/* Country Dropdown - Portal rendered for authenticated users (mobile + desktop) */}
      {isCountryDropdownOpen && isAuthenticated && (() => {
        // Use whichever button is actually visible in the DOM
        const desktopButtonRect = countryButtonDesktopRef.current?.getBoundingClientRect();
        const mobileButtonRect = countryButtonMobileRef.current?.getBoundingClientRect();
        const buttonRect = desktopButtonRect && desktopButtonRect.width > 0 ? desktopButtonRect : mobileButtonRect;
        const isDesktopVisible = !!(desktopButtonRect && desktopButtonRect.width > 0);
        const dropdownWidth = Math.min(window.innerWidth - 32, 320);
        const left = isDesktopVisible 
          ? Math.max(16, (buttonRect?.right ?? 0) - dropdownWidth)
          : 'auto';
        const right = !isDesktopVisible ? 16 : 'auto';
        const top = (buttonRect?.bottom ?? 70) + 12;
        
        return createPortal(
        <div 
          data-country-dropdown
          className="fixed bg-[#0E0E0E]/95 border border-[#2F2F2F] rounded-lg shadow-2xl backdrop-blur z-50"
          style={{
            width: dropdownWidth,
            maxHeight: '70vh',
            top: top,
            left: left,
            right: right
          }}
          data-testid="country-dropdown-authenticated"
        >
          <div className="overflow-hidden rounded-lg bg-[#0E0E0E]/95 p-4 shadow-lg ring-1 ring-black ring-opacity-5 backdrop-blur">
            <div className="relative mb-4">
              <input
                type="text"
                value={countrySearchQuery}
                onChange={(e) => setCountrySearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleCountryKeyDown}
                role="combobox"
                aria-label={t('general_search_countries', 'Search countries')}
                aria-expanded={true}
                aria-controls="header-country-list-auth"
                aria-activedescendant={activeCountryId ? `header-country-auth-${activeCountryId}` : undefined}
                aria-autocomplete="list"
                className="w-full rounded-lg bg-[#2A2A2A] border border-[#444] px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-[#FF4199] transition-colors"
                placeholder={t('general_search_countries', 'Search countries...')}
                autoFocus
              />
            </div>
            <div
              id="header-country-list-auth"
              role="listbox"
              className="max-h-80 overflow-y-auto scrollbar-none scroll-smooth"
                 style={{ 
                   scrollbarWidth: 'none', 
                   msOverflowStyle: 'none',
                   WebkitOverflowScrolling: 'touch'
                 }}>
              <div 
                ref={setCountryItemRef('global')}
                id="header-country-auth-global"
                role="option"
                aria-selected={activeCountryId === 'global'}
                onMouseEnter={() => setActiveCountryById('global')}
                className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${activeCountryId === 'global' ? countryFocusRingClass : ''}`}
                onClick={() => {
                  onCountryChange?.("all", true);
                  closeCountryDropdownAndRestoreFocus();
                }}
              >
                <span className="pr-4">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 fill-[#FF4199]">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                  </svg>
                </span>
                <span className="block truncate text-white">{t('nav_global', 'Global')}</span>
              </div>
              {filteredCountries.map((country, index: number) => {
                // Unique per row even when ISO-code fallbacks collide.
                const itemId = `country-${index}-${country.code || country.name}`;
                const isActive = activeCountryId === itemId;
                return (
                <div 
                  key={`mobile-portal-${index}-${country.name}`}
                  ref={setCountryItemRef(itemId)}
                  id={`header-country-auth-${itemId}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveCountryById(itemId)}
                  className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${isActive ? countryFocusRingClass : ''}`}
                  onClick={() => {
                    onCountryChange?.(country.name, true);
                    setSelectedCountryObj({ name: country.name, code: country.code });
                    localStorage.setItem('selectedCountry', country.name);
                    localStorage.setItem('countryPreference', 'manual'); // Persist manual selection
                    closeCountryDropdownAndRestoreFocus();
                    // NOTE: No URL navigation - country is just a content filter, not a URL change
                    // User's language preference (URL slug) stays unchanged
                  }}
                  title={country.displayName}
                >
                  <span className="pr-3 flex items-center justify-center w-10 flex-shrink-0">
                    {country.code ? (
                      <img
                        src={`/flags/${country.code?.toLowerCase()}-40.webp`}
                        alt={country.displayName}
                        className="w-7 h-5 object-cover rounded border border-gray-500 shadow-sm"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-xs font-bold text-white bg-gray-600 px-1.5 py-0.5 rounded shadow-sm">
                        {country.displayName.split(' ').map(word => word.charAt(0)).join('').substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-white">{country.displayName}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      );
      })()}

      {/* Country Dropdown - Portal rendered for unauthenticated users */}
      {isCountryDropdownOpen && !isAuthenticated && (() => {
        // Use whichever button is actually visible in the DOM
        const desktopButtonRect = countryButtonRef.current?.getBoundingClientRect();
        const mobileButtonRect = countryButtonMobileRef.current?.getBoundingClientRect();
        const buttonRect = desktopButtonRect && desktopButtonRect.width > 0 ? desktopButtonRect : mobileButtonRect;
        const isDesktopVisible = !!(desktopButtonRect && desktopButtonRect.width > 0);
        const dropdownWidth = Math.min(window.innerWidth - 32, 320);
        const left = isDesktopVisible 
          ? Math.max(16, (buttonRect?.right ?? 0) - dropdownWidth)
          : 'auto';
        const right = !isDesktopVisible ? 16 : 'auto';
        const top = (buttonRect?.bottom ?? 70) + 12;
        
        return createPortal(
        <div 
          data-country-dropdown
          className="fixed bg-[#0E0E0E]/95 border border-[#2F2F2F] rounded-lg shadow-2xl backdrop-blur z-50"
          style={{
            width: dropdownWidth,
            maxHeight: '70vh',
            top: top,
            left: left,
            right: right
          }}
          data-testid="country-dropdown-unauthenticated"
        >
          <div className="overflow-hidden rounded-lg bg-[#0E0E0E]/95 p-4 shadow-lg ring-1 ring-black ring-opacity-5 backdrop-blur">
            <div className="relative mb-4">
              <input
                type="text"
                value={countrySearchQuery}
                onChange={(e) => setCountrySearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleCountryKeyDown}
                role="combobox"
                aria-label={t('general_search_countries', 'Search countries')}
                aria-expanded={true}
                aria-controls="header-country-list-unauth"
                aria-activedescendant={activeCountryId ? `header-country-unauth-${activeCountryId}` : undefined}
                aria-autocomplete="list"
                className="w-full rounded-lg bg-[#2A2A2A] border border-[#444] px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-[#FF4199] transition-colors"
                placeholder={t('general_search_countries', 'Search countries...')}
                autoFocus
              />
            </div>
            <div
              id="header-country-list-unauth"
              role="listbox"
              className="max-h-80 overflow-y-auto scrollbar-none scroll-smooth"
                 style={{ 
                   scrollbarWidth: 'none', 
                   msOverflowStyle: 'none',
                   WebkitOverflowScrolling: 'touch'
                 }}>
              <div 
                ref={setCountryItemRef('global')}
                id="header-country-unauth-global"
                role="option"
                aria-selected={activeCountryId === 'global'}
                onMouseEnter={() => setActiveCountryById('global')}
                className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${activeCountryId === 'global' ? countryFocusRingClass : ''}`}
                onClick={() => {
                  onCountryChange?.("all", true);
                  closeCountryDropdownAndRestoreFocus();
                }}
              >
                <span className="pr-3 flex items-center justify-center w-10 flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 fill-[#FF4199]">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                  </svg>
                </span>
                <span className="flex-1 min-w-0 truncate text-white font-medium">{t('nav_global', 'Global')}</span>
              </div>
              {filteredCountries.map((country, index: number) => {
                // Unique per row even when ISO-code fallbacks collide.
                const itemId = `country-${index}-${country.code || country.name}`;
                const isActive = activeCountryId === itemId;
                return (
                <div 
                  key={`unauth-${index}-${country.name}`}
                  ref={setCountryItemRef(itemId)}
                  id={`header-country-unauth-${itemId}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveCountryById(itemId)}
                  className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${isActive ? countryFocusRingClass : ''}`}
                  onClick={() => {
                    onCountryChange?.(country.name, true);
                    localStorage.setItem('selectedCountry', country.name);
                    localStorage.setItem('countryPreference', 'manual');
                    closeCountryDropdownAndRestoreFocus();
                    // NOTE: No URL navigation - country is just a content filter, not a URL change
                    // User's language preference (URL slug) stays unchanged
                  }}
                  title={country.displayName}
                >
                  <span className="pr-3 flex items-center justify-center w-10 flex-shrink-0">
                    {country.code ? (
                      <img
                        src={`/flags/${country.code?.toLowerCase()}-40.webp`}
                        alt={country.displayName}
                        className="w-7 h-5 object-cover rounded border border-gray-500 shadow-sm"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-xs font-bold text-white bg-gray-600 px-1.5 py-0.5 rounded shadow-sm">
                        {country.displayName.split(' ').map(word => word.charAt(0)).join('').substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-white">{country.displayName}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      );
      })()}

      {/* Notification Dropdown - Portal rendered - Figma: 331x312px, border-radius 4px, border 1px #4D4D4D */}
      {isNotificationDropdownOpen && isAuthenticated && (() => {
        const isDesktop = window.innerWidth >= 1280;
        const rect = isDesktop
          ? notificationButtonDesktopRef.current?.getBoundingClientRect()
          : notificationButtonRef.current?.getBoundingClientRect();
        const dropdownWidth = isDesktop ? 331 : Math.min(window.innerWidth - 32, 331);
        const left = isDesktop 
          ? (rect ? rect.right - dropdownWidth : 'auto')
          : undefined;
        const right = !isDesktop ? 16 : undefined;
        const top = rect ? (window.scrollY + rect.bottom + 12) : 'auto';
        
        return createPortal(
        <div 
          ref={notificationDropdownRef}
          data-notification-dropdown
          className="fixed bg-black shadow-2xl z-50"
          style={{
            width: dropdownWidth,
            height: '312px',
            top: top,
            left: left,
            right: right,
            borderRadius: '4px',
            border: '1px solid #4D4D4D'
          }}
          role="dialog"
          aria-label={t('notifications_title', 'Notifications')}
          tabIndex={-1}
          onKeyDown={buildDropdownKeyHandler(
            notificationDropdownRef,
            closeNotificationDropdownAndRestoreFocus
          )}
          data-testid="notification-dropdown"
        >
          {/* Header - Figma: Ubuntu Medium 14px, no icon */}
          <div className="px-[19px] py-[14px]">
            <span className="font-ubuntu font-medium text-white" style={{ fontSize: '14px', lineHeight: '100%' }}>
              {t('notifications_title', 'Notifications')}
            </span>
          </div>
          
          {/* Notifications List - Figma: item layout 248x32px, left 19px - scrollbar hidden */}
          <div className="overflow-y-auto scrollbar-hide" style={{ maxHeight: 'calc(312px - 42px)', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
            {notificationsError ? <p role="alert">{t('notifications_load_failed', 'Notifications could not be loaded.')}</p> : notificationsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-500 border-t-white"></div>
              </div>
            ) : notifications.length > 0 ? (
              notifications.map((notification: any, index: number) => {
                const fromUser = typeof notification.fromUserId === 'object' ? notification.fromUserId : null;
                const isMessage = notification.type === 'new_message';
                const isFollow = notification.type === 'follow' || notification.type === 'unfollow';
                const isStation = notification.type === 'new_station';
                const isUnread = !notification.read && !notification.isRead;

                const handleNotifClick = async () => {
                  const destination = notificationTarget(notification, currentLanguage);
                  if (destination) { setIsNotificationDropdownOpen(false); setLocation(destination); }
                  if (notification._id && isUnread) {
                    apiRequest('PATCH', `/api/user/notifications/${encodeURIComponent(notification._id)}/read`)
                      .then(() => notificationQueryClient.invalidateQueries({ queryKey: ['/api/user/notifications'] })).catch(() => {});
                  }
                };

                return (
                <div 
                  key={notification._id || index}
                  onClick={handleNotifClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNotifClick();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-3 hover:bg-[#1A1A1A] focus:bg-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#FF4199] focus:ring-inset transition-colors cursor-pointer relative"
                  style={{ padding: '8px 19px', minHeight: '48px', background: isUnread ? 'rgba(255,65,153,0.05)' : undefined }}
                  data-testid={`notification-item-${index}`}
                >
                  {isUnread && <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#FF4199]" />}
                  {/* Icon - 32x32px */}
                  <div 
                    className="flex-shrink-0 overflow-hidden"
                    style={{ width: '32px', height: '32px', borderRadius: '16.49px' }}
                    aria-hidden="true"
                  >
                    {isStation && notification.data?.stationFavicon ? (
                      <img 
                        src={notification.data.stationFavicon} 
                        alt="" 
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (isFollow || isMessage) && fromUser ? (
                      <PublicProfileAvatar profile={fromUser} name="" size={32} className="h-full w-full" />
                    ) : (
                      <div className="w-full h-full bg-[#2F2F2F] flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-400">
                          <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="font-ubuntu font-medium text-white truncate" style={{ fontSize: '14px', lineHeight: '100%' }}>
                      {isStation
                        ? `${notification.data?.stationSlug?.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || notification.title?.replace(' Added', '') || 'Station'} added. Click to listen!`
                        : isMessage && fromUser
                          ? `${fromUser.fullName || fromUser.username || 'Someone'} size mesaj yazdı`
                          : notification.title || t('notifications_new_station', 'New notification')}
                    </div>
                    <div className="font-ubuntu font-normal mt-1" style={{ fontSize: '14px', lineHeight: '100%', color: '#777777' }}>
                      {notification.createdAt ? (
                        (() => {
                          const date = new Date(notification.createdAt);
                          const now = new Date();
                          const diffMs = now.getTime() - date.getTime();
                          const diffMins = Math.floor(diffMs / (1000 * 60));
                          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                          const diffDays = Math.floor(diffHours / 24);
                          if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                          if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                          if (diffMins > 0) return `${diffMins} min ago`;
                          return 'Just now';
                        })()
                      ) : '1 day ago'}
                    </div>
                  </div>
                </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div 
                  className="flex items-center justify-center bg-[#2F2F2F] mb-3"
                  style={{ width: '32px', height: '32px', borderRadius: '16.49px' }}
                >
                  <img src={notificationIcon} alt="" style={{ width: '16px', height: '16px', opacity: 0.5 }} />
                </div>
                <span className="font-ubuntu" style={{ fontSize: '14px', color: '#777777' }}>
                  {t('notifications_empty', 'No notifications yet')}
                </span>
              </div>
            )}
          </div>
        </div>,
        document.body
      );
      })()}

      {/* Mobile Profile Dropdown Portal */}
      {isMobileProfileMenuOpen && mobileProfileButtonRef.current && createPortal(
        <div 
          ref={mobileProfileDropdownRef}
          className="fixed w-56 bg-[#1D1D1D] rounded-lg shadow-xl py-2 border border-[#2D2D2D] focus:outline-none"
          style={{
            top: mobileProfileButtonRef.current.getBoundingClientRect().bottom + 8,
            right: window.innerWidth - mobileProfileButtonRef.current.getBoundingClientRect().right,
            zIndex: 9999
          }}
          role="menu"
          aria-label={t('nav_profile_menu', 'Profile menu')}
          tabIndex={-1}
          onKeyDown={buildDropdownKeyHandler(
            mobileProfileDropdownRef,
            closeMobileProfileMenuAndRestoreFocus
          )}
          data-testid="mobile-profile-dropdown"
        >
          <Link
            href={getLocalizedUrl("/profile/favorites")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <Heart className="w-5 h-5 mr-3 text-[#FF4199]" />
            <span className="text-white text-sm font-medium">{profileNavLabel('nav_your_favorites', 'favorites')}</span>
          </Link>

          <Link
            href={getLocalizedUrl("/profile/discover")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <Compass className="w-5 h-5 mr-3 text-[#FF4199]" />
            <span className="text-white text-sm font-medium">{profileNavLabel('user_menu_discover', 'discover')}</span>
          </Link>

          <Link
            href={getLocalizedUrl("/profile/settings")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <User className="w-5 h-5 mr-3 text-[#FF4199]" />
            <span className="text-white text-sm font-medium">{profileNavLabel('user_menu_profile', 'profile')}</span>
          </Link>

          <Link
            href={getLocalizedUrl("/profile/messages")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <MessageCircle className="w-5 h-5 mr-3 text-[#FF4199]" />
            <span className="text-white text-sm font-medium">{profileNavLabel('messages', 'messages')}</span>
          </Link>

          <div className="border-t border-[#2D2D2D] my-1"></div>

          <Link
            href={getLocalizedUrl("/feedback")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <MessageSquareWarning className="w-5 h-5 mr-3 text-[#FF4199]" />
            <span className="text-white text-sm font-medium">{profileNavLabel('feedback', 'feedback')}</span>
          </Link>

          <button
            onClick={() => {
              setIsMobileProfileMenuOpen(false);
              logoutAccount()
                .then(() => { window.location.href = getLocalizedUrl('/'); })
                .catch(() => { toast({ title: t('auth_logout_failed', 'Logout failed. Please try again.'), variant: 'destructive' }); });
            }}
            className="flex items-center w-full px-4 py-3 hover:bg-[#2D2D2D] transition-colors text-left"
          >
            <LogOut className="w-5 h-5 mr-3 text-gray-400" />
            <span className="text-white text-sm font-medium">{profileNavLabel('nav_logout', 'logout')}</span>
          </button>
        </div>,
        document.body
      )}

      {/* Modals — lazy-loaded; Suspense gates the chunk fetch on first open */}
      {(showAddStationModal || internalAddStationOpen) && (
        <Suspense fallback={null}>
          <AddYourStationModal 
            isOpen={showAddStationModal || internalAddStationOpen}
            onClose={() => { setShowAddStationModal?.(false); setInternalAddStationOpen(false); }}
          />
        </Suspense>
      )}
    </>
  );
}
