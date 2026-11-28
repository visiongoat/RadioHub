import type { CSSProperties, ReactNode } from 'react';
import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRoute } from 'wouter';
import { SeoHead } from '@/components/SeoHead';
import StationCard from '@/components/ui/station-card';
import { GenrePageTitle } from '@/components/layout/genre-page-title';
import { CODE_TO_COUNTRY, SEO_LANGUAGES, GENRE_STATIONS_PAGE_SIZE, MAX_GENRE_DIRECTORY_PAGE } from '@workspace/seo-shared/seo-config';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import { useGenreMobileViewport, useGenreDirectoryPagination } from '@/hooks/useGenrePageState';
import { getGenrePageLabels } from '@/utils/genre-page-labels';
import { stationQueryFreshness } from '@/lib/station-query-policy';

// Import arrow icons for pagination
import arrowLeftIcon from "@assets/arrow-left.png";
import arrowRightIcon from "@assets/arrow-right.png";

interface GenreLandingProps {
  selectedCountry?: string;
  onCountryChange?: (country: string, isManual?: boolean) => void;
}

function PaginationControl({ href, onClick, disabled, children, ...props }: {
  href?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className: string;
  style: CSSProperties;
  'aria-current'?: 'page';
}) {
  if (href && !disabled) {
    return <a {...props} href={href} onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onClick();
    }}>{children}</a>;
  }
  return <button {...props} type="button" disabled={disabled} onClick={onClick}>{children}</button>;
}

export default function GenreLanding({ selectedCountry, onCountryChange }: GenreLandingProps) {
  const { language, localeTranslations } = useTranslation();
  const labels = getGenrePageLabels(language, localeTranslations);
  const { getLocalizedUrl } = useSeoRouting();
  const { slug: paramsSlug } = useParams<{ slug: string }>();
  const stationsPerPage = GENRE_STATIONS_PAGE_SIZE;
  const isMobile = useGenreMobileViewport();
  
  // Extract country from URL route parameters
  const [, paramsLang] = useRoute("/:lang/:section/:slug");  // Includes localized genre segments.
  const [, paramsDefault] = useRoute("/genres/:slug");      // For /genres/classical
  
  // Get slug from multiple sources (priority: useParams > route params)
  const slug = paramsSlug || paramsLang?.slug || paramsDefault?.slug;
  
  const urlCode = paramsLang?.lang;
  const isLanguageCode = urlCode ? SEO_LANGUAGES.some(l => l.code === urlCode && l.enabled) : false;
  const urlCountryCode = (urlCode && !isLanguageCode) ? urlCode : null;
  const urlCountryName = urlCountryCode ? (CODE_TO_COUNTRY[urlCountryCode] || 'all') : null;
  
  const requestedCountry = (selectedCountry && selectedCountry !== 'all' && selectedCountry !== urlCountryName)
    ? selectedCountry 
    : (urlCountryName || selectedCountry || 'all');
  const currentCountry = requestedCountry === 'global' ? 'all' : requestedCountry;
  const {
    currentPage, currentCountry: stationCountry, isPublic, validPage, pageHref,
    changePage: handlePageChange,
  } = useGenreDirectoryPagination(currentCountry, urlCountryName || 'all');
  
  const { data: genre, isLoading: genreLoading, isError: genreError, refetch: retryGenre, isFetching: genreFetching } = useQuery<{name: string, slug: string}>({
    queryKey: [`/api/genres/slug/${slug}`],
    enabled: !!slug
  });


  const { data: stationsResponse, isLoading: stationsLoading, isError: stationsError, refetch: retryStations, isFetching: stationsFetching } = useQuery<{stations: any[], total: number, page: number, pages: number}>({
    queryKey: [`/api/genres/${slug}/stations`, { page: currentPage, limit: stationsPerPage }, stationCountry, urlCountryCode],
    ...stationQueryFreshness,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: stationsPerPage.toString()
      });
      
      // Add country filter if available
      if (stationCountry !== 'all') {
        params.append('country', stationCountry);
      }
      
      const response = await fetch(`/api/genres/${slug}/stations?${params}`, { signal });
      if (!response.ok) throw new Error('Failed to fetch stations');
      const result = await response.json();
      if (result.page !== currentPage) throw new Error('Unexpected genre station page');
      return result;
    },
    enabled: !!slug && validPage
  });

  const stations = stationsResponse?.stations || [];
  // API /api/genres/:slug/stations returns { stations, total, page, pages } —
  // there is no `pagination` wrapper, so the old `pagination?.total` read was
  // always 0 and pagination never rendered (only the first page of stations was
  // ever reachable). Read the flat `total`/`pages` fields the endpoint sends.
  const totalStations = stationsResponse?.total ?? 0;
  const totalPages = Math.min(MAX_GENRE_DIRECTORY_PAGE, stationsResponse?.pages ?? Math.ceil(totalStations / stationsPerPage));
  const buttonClass = "w-9 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center text-[13px] md:text-[16px] font-bold text-white hover:opacity-80";
  const getButtonStyle = (isActive: boolean) => ({
    borderRadius: '8px',
    backgroundColor: isActive ? '#FF4199' : '#2F2F2F',
    fontFamily: "'Ubuntu', sans-serif",
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  });
  const renderPageButton = (page: number) => (
    <PaginationControl key={page} href={isPublic ? pageHref(page) : undefined}
      onClick={() => handlePageChange(page)} className={buttonClass}
      style={getButtonStyle(page === currentPage)} aria-current={page === currentPage ? 'page' : undefined}>
      {page}
    </PaginationControl>
  );
  
  // NOTE (2026-07-01, Ahrefs "H1 tag missing or empty"): we intentionally do NOT
  // gate the whole page behind `genreLoading` any more. The heading below is the
  // page's single <h1>; a full-page loading spinner meant a crawler that snapshot
  // the rendered DOM before the genre query resolved saw ZERO <h1>. `genreName`
  // already has a synchronous slug-derived fallback, so the header/H1 render
  // immediately; only the station grid shows its own skeleton while it loads.
  void genreLoading;
  const genreName = genreDisplayName({ slug, name: genre?.name }, language);
  const gridClass = 'grid grid-cols-1 gap-x-[21px] gap-y-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-y-5';

  return (
    <>
      <SeoHead pageType="genres" genreName={genreName} />
      
      <div className="min-h-screen bg-[#0e0e0e]">
        <GenrePageTitle title={genreName || labels.genres}
          parent={{ label: labels.genres, href: getLocalizedUrl('/genres') }}
          currentHref={slug ? getLocalizedUrl(`/genres/${slug}`) : undefined} />

        <div className="container pb-12 pt-5 max-sm:!px-5 md:pb-20">

            {genreError || stationsError || !slug || !validPage ? (
              <p role="alert" className="py-5 text-white/70">{labels.error} <button disabled={genreFetching || stationsFetching || !slug || !validPage} onClick={() => { void retryGenre(); void retryStations(); }} className="underline">{labels.retry}</button></p>
            ) : stationsLoading ? (
              <div role="status" aria-label={labels.loading} className={gridClass}>
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="h-[102px] animate-pulse rounded-[10px] bg-[#2f2f2f] lg:h-[130px]" />
                ))}
              </div>
            ) : (
              <>
                {stations.length === 0 && <p role="status" className="py-5 text-white/70">{labels.emptyStations}</p>}
                <div className={gridClass}>
                  {stations.map((station: any) => (
                    <StationCard
                      key={station._id}
                      station={station}
                      variant="genre"
                      headingLevel={2}
                    />
                  ))}
                </div>
                
                {/* Pagination - Responsive: Desktop full, Mobile compact */}
                <div className="py-8 grid items-center justify-center">
                {totalPages > 1 && (
                  <div className="flex items-center gap-1 md:gap-2">
                    {/* Previous button - Desktop: 51x38, Mobile: 40x32 */}
                    <PaginationControl
                      href={isPublic && currentPage > 1 ? pageHref(currentPage - 1) : undefined}
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
                    </PaginationControl>
                    
                    {/* Page numbers - Responsive: Desktop 51x38, Mobile 36x32 */}
                    {(() => {
                      const buttons = [];
                      const maxVisible = isMobile ? 3 : 5;
                      
                      if (totalPages <= maxVisible + 2) {
                        for (let i = 1; i <= totalPages; i++) {
                          buttons.push(renderPageButton(i));
                        }
                      } else {
                        if (isMobile) {
                          if (currentPage <= 3) {
                            for (let i = 1; i <= 3; i++) {
                              buttons.push(renderPageButton(i));
                            }
                            buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(renderPageButton(totalPages));
                          } else if (currentPage >= totalPages - 2) {
                            buttons.push(renderPageButton(1));
                            buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            for (let i = totalPages - 2; i <= totalPages; i++) {
                              buttons.push(renderPageButton(i));
                            }
                          } else {
                            buttons.push(renderPageButton(1));
                            buttons.push(<span key="el1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(renderPageButton(currentPage));
                            buttons.push(<span key="el2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(renderPageButton(totalPages));
                          }
                        } else {
                          if (currentPage <= 4) {
                            for (let i = 1; i <= 5; i++) {
                              buttons.push(renderPageButton(i));
                            }
                            buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(renderPageButton(totalPages));
                          } else if (currentPage >= totalPages - 3) {
                            buttons.push(renderPageButton(1));
                            buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            for (let i = totalPages - 4; i <= totalPages; i++) {
                              buttons.push(renderPageButton(i));
                            }
                          } else {
                            buttons.push(renderPageButton(1));
                            buttons.push(<span key="ellipsis1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                              buttons.push(renderPageButton(i));
                            }
                            buttons.push(<span key="ellipsis2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(renderPageButton(totalPages));
                          }
                        }
                      }
                      
                      return buttons;
                    })()}
                    
                    {/* Next button - Desktop: 51x38, Mobile: 40x32 */}
                    <PaginationControl
                      href={isPublic && currentPage < totalPages ? pageHref(currentPage + 1) : undefined}
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
                    </PaginationControl>
                  </div>
                )}
                </div>
              </>
            )}
        </div>
      </div>
    </>
  );
}
