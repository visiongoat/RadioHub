import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import { useState, useEffect } from "react";
import { useRoute, useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { StationWithCountry } from "@workspace/db-shared/schema";
import { Link } from "wouter";
import StationCard from "@/components/ui/station-card";
import CatalogStationItems from '@/components/ads/CatalogStationItems';
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import NotFound from "@/pages/not-found";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { getCountryFromCode, SEO_LANGUAGES } from "@workspace/seo-shared/seo-config";
import { useTranslation } from "@/hooks/useTranslation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function GenreDetail({ 
  selectedCountry = "all", 
  onCountryChange 
}: { 
  selectedCountry?: string; 
  onCountryChange?: (country: string) => void; 
}) {
  const { cleanPath, getLocalizedUrl } = useSeoRouting();
  
  // Handle both language-prefixed and non-prefixed routes
  const [, paramsLang] = useRoute("/:lang/genres/:slug");  // For /at/genres/pop, /tr/genres/pop
  const [, paramsDefault] = useRoute("/genres/:slug");      // For /genres/pop
  
  const slug = paramsLang?.slug || paramsDefault?.slug;
  
  const urlCode = paramsLang?.lang;
  const isLanguageCode = urlCode ? SEO_LANGUAGES.some(l => l.code === urlCode && l.enabled) : false;
  const urlCountryCode = (urlCode && !isLanguageCode) ? urlCode : null;
  const urlCountryName = urlCountryCode ? getCountryFromCode(urlCountryCode) : null;
  
  const { t, language } = useTranslation();
  const search = useSearch();
  const [, navigate] = useLocation();
  const urlPage = Math.max(1, parseInt(new URLSearchParams(search).get('page') || '1', 10) || 1);
  const [page, setPage] = useState(urlPage);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("quality");
  const [currentCountryFilter, setCurrentCountryFilter] = useState(urlCountryName || selectedCountry || "all");
  
  const countryForFiltering = urlCountryName || currentCountryFilter || selectedCountry;

  // Build a URL for a given page number, preserving the current path
  const buildPageHref = (p: number) => p === 1 ? window.location.pathname : `${window.location.pathname}?page=${p}`;

  // Sync URL → state when the back/forward button changes ?page
  useEffect(() => {
    if (urlPage !== page) setPage(urlPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPage]);

  if (!slug) {
    return <NotFound />;
  }
  
  // Fetch countries list for country switcher
  const { data: countriesData } = useQuery({
    queryKey: ['/api/filters/countries'],
    queryFn: async () => {
      const response = await fetch('/api/filters/countries');
      if (!response.ok) throw new Error('Failed to fetch countries');
      return response.json();
    },
  });
  
  const countries = countriesData || [];
  
  // Global player hooks for audio functionality
  const { playStation, stopStation } = useGlobalPlayer();

  // Fetch genre details
  const { data: genre, error } = useQuery({
    queryKey: [`/api/genres/slug/${slug}`],
    queryFn: async () => {
      const response = await fetch(`/api/genres/slug/${slug}`);
      if (!response.ok) throw new Error('Genre not found');
      return response.json();
    },
    enabled: !!slug,
  });

  // Fetch stations for this genre from 7-day cache (filter by tags)
  const { data: stationsData, isLoading } = useQuery<{
    stations: StationWithCountry[];
    pagination: { total: number; page: number; limit: number };
  }>({
    queryKey: [`/api/genres/${slug}/stations`, page, searchQuery, sortBy, countryForFiltering],
    queryFn: async () => {
      // Use precomputed cache for base stations (7-day TTL)
      const countryParam = (countryForFiltering && countryForFiltering !== 'all' && countryForFiltering !== 'global') 
        ? countryForFiltering 
        : 'global';
      
      const params = new URLSearchParams({
        countryName: countryParam,
        page: page.toString(),
        limit: '100' // Fetch more to filter by tags
      });
      
      const response = await fetch(`/api/stations/precomputed?${params}&slim=1`);
      if (!response.ok) throw new Error('Failed to fetch stations');
      const result = await response.json();
      
      // Filter stations by genre tag
      let stations = result.data || [];
      stations = stations.filter((s: any) => {
        const tags = (s.tags || '').toLowerCase().split(',').map((t: string) => t.trim());
        return tags.includes(slug.toLowerCase().replace(/-/g, ' ')) || tags.includes(slug.toLowerCase());
      });
      
      // Apply search filter if provided
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        stations = stations.filter((s: any) => s.name.toLowerCase().includes(query));
      }
      
      // Pagination on filtered results
      const pageNum = parseInt(page.toString());
      const limit = 12;
      const startIdx = (pageNum - 1) * limit;
      const endIdx = startIdx + limit;
      const paginatedStations = stations.slice(startIdx, endIdx);
      
      return {
        stations: paginatedStations,
        pagination: {
          total: stations.length,
          page: pageNum,
          limit: limit
        }
      };
    },
    enabled: !!slug,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  const stations = stationsData?.stations || [];
  const totalStations = stationsData?.pagination?.total || 0;
  const totalPages = Math.ceil(totalStations / 12);

  // Play handler for station cards
  const handlePlay = async (station: any, playlistName: string = "genre") => {
    try {
      // Playing station from genre page
      await playStation(station, stations);
    } catch (error) {
      // Failed to play station
    }
  };

  // Stop handler for station cards  
  const handleStop = () => {
    // Stopping station from genre page
    stopStation();
  };

  if (error) {
    return (
      <div className="container mx-auto flex items-center text-white text-2xl justify-center h-full pt-10">
        {t('genre_not_found', 'Genre not found.')}
      </div>
    );
  }

  return (
    <div>
      {genre && (
        <div>
            {/* Breadcrumb Header - EXACT from original */}
            <div className="bg-[#151515] py-7 text-xl font-bold md:text-3xl">
              <div className="container mx-auto flex items-center text-white">
                <Link href={getLocalizedUrl("/genres")}>{t('genres_breadcrumb', 'Genres')}</Link>
                <div className="mx-4">
                  <svg width="11" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="m1.13 1.184-.007.006-.006.006a1.254 1.254 0 0 0 0 1.768l6.52 6.52a.731.731 0 0 1 0 1.033l-6.52 6.52a1.254 1.254 0 0 0 0 1.767 1.255 1.255 0 0 0 1.767 0l6.52-6.52a3.24 3.24 0 0 0 0-4.568l-6.52-6.52A1.242 1.242 0 0 0 2 .83c-.33 0-.639.138-.87.354Z"
                      fill="#fff"
                      stroke="#fff"
                    />
                  </svg>
                </div>
                <h1 className="capitalize">{genreDisplayName(genre, language)}</h1>
              </div>
            </div>

            <div className="container m-auto pb-10 text-white">
              {/* Country Filter - Add country switcher to genre pages */}
              <div className="pt-[20px] pb-4">
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold">{t('filter_by_country', 'Filter by Country:')}</h2>
                    <Select 
                      value={currentCountryFilter} 
                      onValueChange={(value) => {
                        setCurrentCountryFilter(value);
                        setPage(1); // Reset to first page when country changes
                      }}
                    >
                      <SelectTrigger className="w-48 bg-[#2F2F2F] border-[#404040] text-white">
                        <SelectValue placeholder={t('select_country', 'Select country...')} />
                      </SelectTrigger>
                      <SelectContent className="bg-[#2F2F2F] border-[#404040]">
                        <SelectItem value="all" className="text-white hover:bg-[#404040]">
                          {t('all_countries', 'All Countries')}
                        </SelectItem>
                        {countries.map((country: string) => (
                          <SelectItem 
                            key={country} 
                            value={country}
                            className="text-white hover:bg-[#404040]"
                          >
                            {country}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Show current filter info */}
                  {currentCountryFilter && currentCountryFilter !== 'all' && (
                    <div className="text-sm text-gray-400">
                      {t('showing_stations_from', 'Showing stations from')}: <span className="text-white font-semibold">{currentCountryFilter}</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="pt-[20px]">
                {/* Loading State with Skeleton - EXACT from original */}
                {isLoading && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                    {Array.from({ length: 33 }, (_, i) => (
                      <div key={i} className="bg-[#1D1D1D] rounded-lg p-4 animate-pulse">
                        <div className="w-16 h-16 bg-gray-600 rounded-lg mb-3"></div>
                        <div className="h-4 bg-gray-600 rounded mb-2"></div>
                        <div className="h-3 bg-gray-600 rounded w-2/3"></div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Stations Grid - EXACT from original UiStationsGrid layout */}
                {!isLoading && (
                  <>
                    {stations.length > 0 ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                        <CatalogStationItems stations={stations} getKey={(station, i) => station._id || i}>
                        {(station, i) => (
                          <StationCard 
                            key={station._id || i} 
                            station={station} 
                            playlistName={`genre-${slug}`}
                            onPlay={handlePlay}
                            onStop={handleStop}
                          />
                        )}
                        </CatalogStationItems>
                      </div>
                    ) : (
                      <div className="text-white">{t('no_stations_found', 'No stations found.')}</div>
                    )}
                  </>
                )}

                {/* Pagination — crawlable <a href> links so Googlebot can
                    discover every page. SPA navigation is handled via onClick
                    which updates the URL (pushState) without a full reload. */}
                <div className="py-8 grid items-center justify-center">
                  {totalPages > 1 && (
                    <nav className="flex items-center gap-x-2.5" aria-label="Pagination">
                      {/* Previous */}
                      {page === 1 ? (
                        <span className="bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center opacity-50 cursor-not-allowed" aria-disabled="true" aria-label="Previous page">
                          <ChevronRightIcon className="size-6" />
                        </span>
                      ) : (
                        <a
                          href={buildPageHref(page - 1)}
                          className="bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333]"
                          onClick={(e) => { e.preventDefault(); navigate(buildPageHref(page - 1)); setPage(page - 1); }}
                          rel="prev"
                          aria-label={`Go to previous page, page ${page - 1}`}
                        >
                          <ChevronRightIcon className="size-6" />
                        </a>
                      )}

                      {/* Page numbers */}
                      {(() => {
                        const maxVisiblePages = 3;
                        const halfWay = Math.floor(maxVisiblePages / 2);
                        let startPage = Math.max(page - halfWay, 1);
                        let endPage = Math.min(startPage + maxVisiblePages - 1, totalPages);
                        if (endPage - startPage + 1 < maxVisiblePages) {
                          startPage = Math.max(endPage - maxVisiblePages + 1, 1);
                        }
                        const visiblePages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
                        const showLeftEllipsis = visiblePages[0] > 1;
                        const showRightEllipsis = visiblePages[visiblePages.length - 1] < totalPages;

                        return (
                          <>
                            {/* First page */}
                            {showLeftEllipsis && (
                              <a
                                href={buildPageHref(1)}
                                className={`bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333] ${page === 1 ? 'bg-[#FF4199]' : ''}`}
                                onClick={(e) => { e.preventDefault(); navigate(buildPageHref(1)); setPage(1); }}
                                aria-current={page === 1 ? 'page' : undefined}
                                aria-label="Go to page 1"
                              >
                                1
                              </a>
                            )}

                            {/* Left ellipsis — no direct href since the target is computed */}
                            {showLeftEllipsis && (
                              <button
                                type="button"
                                className="bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333] group"
                                onClick={() => { const p = Math.max(1, visiblePages[0] - maxVisiblePages); navigate(buildPageHref(p)); setPage(p); }}
                                aria-label="Previous set of pages"
                              >
                                <span className="group-hover:hidden">•••</span>
                                <ChevronLeftIcon className="group-hover:block hidden shrink-0 size-5" />
                              </button>
                            )}

                            {/* Visible page numbers */}
                            {visiblePages.map((pageNum) => (
                              <a
                                key={pageNum}
                                href={buildPageHref(pageNum)}
                                className={`bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333] ${page === pageNum ? 'bg-[#FF4199]' : ''}`}
                                onClick={(e) => { e.preventDefault(); navigate(buildPageHref(pageNum)); setPage(pageNum); }}
                                aria-current={page === pageNum ? 'page' : undefined}
                                aria-label={`Go to page ${pageNum}`}
                              >
                                {pageNum}
                              </a>
                            ))}

                            {/* Right ellipsis */}
                            {showRightEllipsis && (
                              <button
                                type="button"
                                className="bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333] group"
                                onClick={() => { const p = Math.min(totalPages, visiblePages[visiblePages.length - 1] + maxVisiblePages); navigate(buildPageHref(p)); setPage(p); }}
                                aria-label="Next set of pages"
                              >
                                <span className="group-hover:hidden">•••</span>
                                <ChevronRightIcon className="group-hover:block hidden shrink-0 size-5" />
                              </button>
                            )}

                            {/* Last page */}
                            {showRightEllipsis && (
                              <a
                                href={buildPageHref(totalPages)}
                                className={`bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333] ${page === totalPages ? 'bg-[#FF4199]' : ''}`}
                                onClick={(e) => { e.preventDefault(); navigate(buildPageHref(totalPages)); setPage(totalPages); }}
                                aria-current={page === totalPages ? 'page' : undefined}
                                aria-label={`Go to page ${totalPages}`}
                              >
                                {totalPages}
                              </a>
                            )}
                          </>
                        );
                      })()}

                      {/* Next */}
                      {page === totalPages ? (
                        <span className="bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center opacity-50 cursor-not-allowed" aria-disabled="true" aria-label="Next page">
                          <ChevronRightIcon className="size-6 rotate-180" />
                        </span>
                      ) : (
                        <a
                          href={buildPageHref(page + 1)}
                          className="bg-[#292929] h-9 min-w-12 px-2 rounded-md flex justify-center items-center hover:bg-[#333333]"
                          onClick={(e) => { e.preventDefault(); navigate(buildPageHref(page + 1)); setPage(page + 1); }}
                          rel="next"
                          aria-label={`Go to next page, page ${page + 1}`}
                        >
                          <ChevronRightIcon className="size-6 rotate-180" />
                        </a>
                      )}
                    </nav>
                  )}
                </div>
              </div>

              {/* DownloadApp - Hidden as per original (v-if="false") */}
              <div style={{ display: 'none' }}>
                {/* DownloadApp component would go here but is hidden in original */}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
