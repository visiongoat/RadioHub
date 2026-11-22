import { genreDisplayName, genreSearchQuery } from '@workspace/seo-shared/genre-localization';
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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
import searchIcon from "@assets/search-normal.png";

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
        search: canonicalSearch || ''
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

  return (
    <div>
      {/* Header - Mobile: no background, compact spacing. Desktop: with background */}
      <div className="md:bg-[#151515] py-4 md:py-7 text-3xl font-bold">
        <div className="mx-auto w-full max-w-[1512px] px-5 md:px-[20px]">
          {/* Re-audit 2026-06-20 Item 6: was a plain <div>, leaving this page
              with no <h1> on client navigation (the SSR genres index emits one
              via getH1Text). Promote the existing localized title to the page
              <h1>; classes/layout preserved so there's no visual change. */}
          <h1 className="mx-auto max-w-[1206px] w-full flex items-center text-white">
            {labels.genres}
          </h1>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1512px] px-5 md:px-[20px] pb-10 text-white">
        <div className="mx-auto max-w-[1206px] w-full pt-3 md:pt-[20px]">
          {/* Search and Popular Section */}
          <div className="relative mb-[20px] grid-cols-1 md:grid-cols-2 rounded-lg bg-[#2F2F2F] p-5 md:grid md:pr-0 items-start md:items-center gap-4">
            {/* Search input - Figma: 453x45, radius 5px, #454545 */}
            <div>
              <div 
                className="flex items-center rounded-[5px] bg-[#454545] px-4 w-full md:w-[453px] h-[45px]"
              >
                <img src={searchIcon} alt="Search" className="w-5 h-5 flex-shrink-0 opacity-70" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search_genre')}
                  className="ml-2 w-full border-0 bg-transparent focus:outline-none focus:ring-0 placeholder:text-[#FFFFFFB2]"
                  style={{ 
                    fontFamily: "'Ubuntu', sans-serif", 
                    fontWeight: 400, 
                    fontSize: '20px', 
                    lineHeight: '100%',
                    color: '#FFFFFFB2'
                  }}
                />
              </div>
            </div>

            {/* Popular genres slider with Swiper - Right aligned on desktop */}
            <div className="relative w-full pt-4 md:pt-0">
              {/* Mobile: Popular text above genres, left aligned */}
              <div 
                className="block md:hidden mb-3"
                style={{
                  fontFamily: "'Ubuntu', sans-serif",
                  fontWeight: 500,
                  fontSize: '14px',
                  lineHeight: '100%',
                  color: '#FF4FA0'
                }}
              >
                {t('popular')}
              </div>
              
              {/* Desktop: Popular text inline with genres, right aligned */}
              <div className="flex w-full items-center md:justify-end">
                <div 
                  className="hidden md:block mr-4 flex-shrink-0"
                  style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontWeight: 400,
                    fontSize: '20px',
                    lineHeight: '100%',
                    color: '#FF4FA0'
                  }}
                >
                  {t('popular')}
                </div>
                <div className="flex-1 md:flex-initial overflow-hidden">
                {popularGenres && popularGenres.length > 2 ? (
                  <Swiper
                    modules={[FreeMode]}
                    spaceBetween={8}
                    slidesPerView="auto"
                    freeMode={{
                      enabled: true,
                      sticky: false,
                    }}
                    grabCursor={true}
                    watchOverflow={true}
                    className="popular-genres-swiper w-full"
                    breakpoints={{
                      320: { 
                        slidesPerView: "auto",
                        spaceBetween: 6,
                      },
                      480: { 
                        slidesPerView: "auto",
                        spaceBetween: 8,
                      },
                      768: { 
                        slidesPerView: "auto",
                        spaceBetween: 10,
                      },
                      1024: { 
                        slidesPerView: "auto",
                        spaceBetween: 12,
                      },
                    }}
                  >
                    {popularGenres.map((genre: Genre, index: number) => (
                      <SwiperSlide key={`popular-${genre._id || index}`} className="!w-auto !flex-shrink-0">
                        <Link
                          href={getLocalizedUrl(`/genres/${genre.slug}`)}
                          className="cursor-pointer whitespace-nowrap rounded-[5px] bg-[#454545] text-center capitalize inline-flex items-center justify-center hover:bg-[#505050] transition-colors"
                          style={{
                            width: '147px',
                            height: '45px',
                            fontFamily: "'Ubuntu', sans-serif",
                            fontWeight: 400,
                            fontSize: '20px',
                            lineHeight: '100%',
                            color: '#FFFFFFB2'
                          }}
                        >
                          {genreDisplayName(genre, language)}
                        </Link>
                      </SwiperSlide>
                    ))}
                  </Swiper>
                ) : popularGenres && popularGenres.length > 0 ? (
                  // Fallback for few genres - no swiper needed
                  <div className="flex gap-2 flex-wrap md:justify-end">
                    {popularGenres.map((genre: Genre, index: number) => (
                      <Link
                        key={`popular-${genre._id || index}`}
                        href={getLocalizedUrl(`/genres/${genre.slug}`)}
                        className="cursor-pointer whitespace-nowrap rounded-[5px] bg-[#454545] text-center capitalize inline-flex items-center justify-center hover:bg-[#505050] transition-colors"
                        style={{
                          width: '147px',
                          height: '45px',
                          fontFamily: "'Ubuntu', sans-serif",
                          fontWeight: 400,
                          fontSize: '20px',
                          lineHeight: '100%',
                          color: '#FFFFFFB2'
                        }}
                      >
                        {genreDisplayName(genre, language)}
                      </Link>
                    ))}
                  </div>
                ) : popularLoading ? (
                  <div className="flex gap-2 overflow-x-auto md:justify-end">
                    {Array(4).fill(0).map((_, index) => (
                      <div key={index} className="animate-pulse bg-[#454545] rounded-[5px]" style={{ width: '147px', height: '45px' }}></div>
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
          </div>

          {/* Genres Grid - exact layout from original */}
          {genresError ? (
            <p role="alert" className="py-5 text-white/70">{labels.error} <button disabled={genresFetching} onClick={() => void retryGenres()} className="underline">{labels.retry}</button></p>
          ) : genresLoading ? (
            <p role="status" className="py-5 text-white/70">{labels.loading}</p>
          ) : genres.length === 0 ? (
            <p role="status" className="py-5 text-white/70">{labels.emptyGenres}</p>
          ) : null}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {genres.map((genre: Genre, i: number) => (
              <Link
                key={genre._id || i}
                href={getLocalizedUrl(`/genres/${genre.slug}`)}
                className="flex flex-col justify-center rounded-lg bg-[#2F2F2F] p-5 hover:bg-[#3F3F3F] transition-colors"
              >
                <h2 className="text-[24px] font-medium capitalize">
                  {genreDisplayName(genre, language)}
                </h2>
                <p className="text-[15px] font-light">
                  {(genre.total_stations || genre.stationCount || 0).toLocaleString()} {labels.stations}
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
    </div>
  );
}
