import { genreDisplayName, genreSearchQuery } from '@workspace/seo-shared/genre-localization';
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { GenrePageTitle } from "@/components/layout/genre-page-title";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";
import { useGenreMobileViewport, useGenrePagination } from '@/hooks/useGenrePageState';
import { getGenrePageLabels } from '@/utils/genre-page-labels';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';

// Import icons
import arrowLeftIcon from "@assets/arrow-left.png";
import arrowRightIcon from "@assets/arrow-right.png";

interface Genre {
  _id: string;
  name: string;
  slug: string;
  total_stations: number;
  stationCount?: number;
}

interface GenresResponse {
  data: Genre[];
  count: number;
  currentPage: number;
  perPage: number;
  totalPages: number;
}

function getPreferredCountryCode(selectedCountry?: string) {
  if (!selectedCountry || selectedCountry === 'all' || selectedCountry === 'global') {
    return null;
  }
  
  // Instead of country codes, pass the actual country name for exact matching
  // The backend API expects country names, not ISO codes
  return selectedCountry;
}

export default function GenresPage({ 
  selectedCountry = "all", 
  onCountryChange 
}: { 
  selectedCountry?: string; 
  onCountryChange?: (country: string) => void; 
}) {
  const { getLocalizedUrl } = useSeoRouting();
  const { t, language, localeTranslations } = useTranslation();
  const labels = getGenrePageLabels(language, localeTranslations);
  const [searchQuery, setSearchQuery] = useState("");
  const canonicalSearch = genreSearchQuery(searchQuery, language);
  const isMobile = useGenreMobileViewport();
  const limit = isMobile ? 9 : 27;
  const countryParam = getPreferredCountryCode(selectedCountry) || 'global';
  const { currentPage, changePage: handlePageChange } = useGenrePagination(JSON.stringify([countryParam, canonicalSearch, limit]));

  // Fetch genres from 7-day cache (precomputed endpoint)
  const { data: genresResponse, isLoading: genresLoading, isError: genresError, refetch: retryGenres, isFetching: genresFetching } = useQuery({
    queryKey: ['/api/genres/precomputed', currentPage, canonicalSearch, countryParam, limit],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        countryName: countryParam,
        page: currentPage.toString(),
        limit: String(limit),
        search: canonicalSearch
      });
      
      const response = await fetch(`/api/genres/precomputed?${params}`, { signal });
      if (!response.ok) throw new Error('Failed to fetch genres');
      return await response.json() as GenresResponse;
    },
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  // Fetch popular genres from 7-day cache (top 5 by station count)
  const { data: popularGenresResponse, isLoading: popularLoading, isError: popularError, refetch: retryPopular, isFetching: popularFetching } = useQuery({
    queryKey: ['/api/genres/popular', countryParam],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        countryName: countryParam,
        page: '1',
        limit: '5'
      });
      
      const response = await fetch(`/api/genres/precomputed?${params}`, { signal });
      if (!response.ok) throw new Error('Failed to fetch popular genres');
      const data = await response.json();
      return data.data; // Return just the genres array
    },
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  const popularGenres = popularGenresResponse || [];
  const genres = genresResponse?.data || [];
  const totalGenres = genresResponse?.count || 0;
  const totalPages = genresResponse?.totalPages || 1;

  const searchLabel = t('search_genre', 'Search genre');

  return (
    <div>
      <GenrePageTitle title={labels.genres} />
      <div className="container pb-10 pt-4 text-white max-sm:!px-5 md:pt-5">
        <div className="mb-2.5 grid gap-4 overflow-hidden rounded-[8px] bg-[#2f2f2f] pb-3 ps-[11px] pt-3 md:mb-5 md:min-h-[91px] md:grid-cols-[minmax(0,453px)_minmax(0,1fr)] md:items-center md:gap-[35px] md:py-5 md:ps-[18px]">
          <label className="me-[11px] flex h-[34px] min-w-0 items-center gap-2.5 rounded-[5px] bg-[#454545] px-2.5 focus-within:ring-2 focus-within:ring-[#ff4199] md:me-0 md:h-[45px] md:gap-4 md:px-6">
            <img src="/icons/search-normal.svg" width="20" height="20" alt="" className="size-4 shrink-0 opacity-70 md:size-6" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              aria-label={searchLabel}
              placeholder={searchLabel}
              className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-xs text-white outline-none placeholder:text-white/70 focus:ring-0 md:text-xl"
            />
          </label>

          <div className="flex min-w-0 flex-col gap-2.5 md:flex-row md:items-center md:gap-6">
            <span className="shrink-0 text-sm font-medium text-[#ff4fa0] md:text-xl md:font-normal">{t('popular', 'Popular')}</span>
            <div className="min-w-0 flex-1">
              {popularGenres.length > 0 ? (
                <Swiper
                  modules={[FreeMode]}
                  spaceBetween={10}
                  slidesPerView="auto"
                  freeMode
                  grabCursor
                  watchOverflow
                  breakpoints={{ 768: { spaceBetween: 20 } }}
                  className="popular-genres-swiper w-full"
                >
                  {popularGenres.map((genre: Genre, index: number) => (
                    <SwiperSlide key={genre._id || index} className="!w-auto">
                      <Link
                        href={getLocalizedUrl(`/genres/${genre.slug}`)}
                        className="inline-flex min-h-8 min-w-[83px] items-center justify-center whitespace-nowrap rounded-[5px] bg-[#454545] px-3 text-xs text-white/80 transition-colors hover:bg-[#505050] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white md:min-h-[45px] md:min-w-[147px] md:text-xl"
                      >
                        {genreDisplayName(genre, language)}
                      </Link>
                    </SwiperSlide>
                  ))}
                </Swiper>
              ) : popularLoading ? (
                <div className="flex gap-2.5 overflow-hidden md:gap-5">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="h-8 w-[83px] shrink-0 animate-pulse rounded-[5px] bg-[#454545] md:h-[45px] md:w-[147px]" />
                  ))}
                </div>
              ) : popularError ? (
                <p role="alert" className="text-sm text-white/70">{labels.error} <button disabled={popularFetching} onClick={() => void retryPopular()} className="underline">{labels.retry}</button></p>
              ) : (
                <p role="status" className="text-sm text-white/70">{labels.emptyGenres}</p>
              )}
            </div>
          </div>
        </div>

          {/* Genres Grid - exact layout from original */}
          {genresError ? (
            <p role="alert" className="py-5 text-white/70">{labels.error} <button disabled={genresFetching} onClick={() => void retryGenres()} className="underline">{labels.retry}</button></p>
          ) : genresLoading ? (
            <p role="status" className="py-5 text-white/70">{labels.loading}</p>
          ) : genres.length === 0 ? (
            <p role="status" className="py-5 text-white/70">{labels.emptyGenres}</p>
          ) : null}
          <div className="grid grid-cols-1 gap-x-[21px] gap-y-2.5 md:grid-cols-2 lg:grid-cols-3 lg:gap-y-5">
            {genres.map((genre: Genre, i: number) => (
              <Link
                key={genre._id || i}
                href={getLocalizedUrl(`/genres/${genre.slug}`)}
                className="flex min-h-[78px] flex-col justify-center gap-1 rounded-[10px] bg-[#2f2f2f] px-3.5 py-3 text-white transition-colors hover:bg-[#3f3f3f] md:px-5 lg:min-h-[130px]"
              >
                <h2 className="text-base font-medium leading-tight md:text-[24px]">
                  {genreDisplayName(genre, language)}
                </h2>
                <p className="text-sm font-normal text-white/75 md:text-[15px]">
                  {(genre.total_stations ?? genre.stationCount ?? 0).toLocaleString(language)} {labels.stations}
                </p>
              </Link>
            ))}
          </div>

          {/* Pagination - Responsive: Desktop full, Mobile compact */}
          <div className="py-8 grid items-center justify-center">
          {totalPages > 1 && (
            <div className="flex items-center gap-1 md:gap-2">
              {/* Previous button - Desktop: 51x38, Mobile: 40x32 */}
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className={`flex items-center justify-center transition-colors ${
                  currentPage <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'
                }`}
                style={{ borderRadius: '8px', backgroundColor: '#2F2F2F' }}
              >
                <div className="w-10 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center">
                  <img 
                    src={arrowLeftIcon} 
                    alt={labels.previous}
                    className="w-5 h-5 md:w-[26px] md:h-[26px]"
                  />
                </div>
              </button>
              
              {/* Page numbers - Responsive: Desktop 51x38, Mobile 36x32 */}
              {(() => {
                const buttons = [];
                const maxVisible = isMobile ? 3 : 5;
                
                const buttonClass = "w-9 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center text-[13px] md:text-[16px] font-bold text-white hover:opacity-80";
                
                const getButtonStyle = (isActive: boolean) => ({
                  borderRadius: '8px',
                  backgroundColor: isActive ? '#FF4199' : '#2F2F2F',
                  fontFamily: "'Ubuntu', sans-serif",
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                });
                
                if (totalPages <= maxVisible + 2) {
                  for (let i = 1; i <= totalPages; i++) {
                    buttons.push(
                      <button
                        key={i}
                        onClick={() => handlePageChange(i)}
                        className={buttonClass}
                        style={getButtonStyle(i === currentPage)}
                      >
                        {i}
                      </button>
                    );
                  }
                } else {
                  if (isMobile) {
                    if (currentPage <= 3) {
                      for (let i = 1; i <= 3; i++) {
                        buttons.push(
                          <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                            {i}
                          </button>
                        );
                      }
                      buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPage)}>
                          {totalPages}
                        </button>
                      );
                    } else if (currentPage >= totalPages - 2) {
                      buttons.push(
                        <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(1 === currentPage)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      for (let i = totalPages - 2; i <= totalPages; i++) {
                        buttons.push(
                          <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                            {i}
                          </button>
                        );
                      }
                    } else {
                      buttons.push(
                        <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(false)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="el1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={currentPage} onClick={() => handlePageChange(currentPage)} className={buttonClass} style={getButtonStyle(true)}>
                          {currentPage}
                        </button>
                      );
                      buttons.push(<span key="el2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(false)}>
                          {totalPages}
                        </button>
                      );
                    }
                  } else {
                    if (currentPage <= 4) {
                      for (let i = 1; i <= 5; i++) {
                        buttons.push(
                          <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                            {i}
                          </button>
                        );
                      }
                      buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPage)}>
                          {totalPages}
                        </button>
                      );
                    } else if (currentPage >= totalPages - 3) {
                      buttons.push(
                        <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(1 === currentPage)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      for (let i = totalPages - 4; i <= totalPages; i++) {
                        buttons.push(
                          <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                            {i}
                          </button>
                        );
                      }
                    } else {
                      buttons.push(
                        <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(1 === currentPage)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="ellipsis1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                        buttons.push(
                          <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                            {i}
                          </button>
                        );
                      }
                      buttons.push(<span key="ellipsis2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPage)}>
                          {totalPages}
                        </button>
                      );
                    }
                  }
                }
                
                return buttons;
              })()}
              
              {/* Next button - Desktop: 51x38, Mobile: 40x32 */}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className={`flex items-center justify-center transition-colors ${
                  currentPage >= totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'
                }`}
                style={{ borderRadius: '8px', backgroundColor: '#2F2F2F' }}
              >
                <div className="w-10 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center">
                  <img 
                    src={arrowRightIcon} 
                    alt={labels.next}
                    className="w-5 h-5 md:w-[26px] md:h-[26px]"
                  />
                </div>
              </button>
            </div>
          )}
          </div>
      </div>
    </div>
  );
}
