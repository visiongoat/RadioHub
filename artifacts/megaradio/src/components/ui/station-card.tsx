import { useState, memo } from "react";
import { Heart, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import FavoriteButton from "@/components/ui/favorite-button";
import { StationLogo } from "@/components/ui/station-logo";
import { getStationUrl } from "@/utils/slugs";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useLocation, Link } from "wouter";
import { getStationImageAlt } from "@workspace/seo-shared/station-image-alt";
import { getStationListenLabel } from '@/utils/station-accessible-text';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';
import { isExplicitlyFailedStation } from '@/utils/station-availability';

const formatVoteCount = (count: number): string => {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return count.toString();
};

const truncateText = (text: string, maxLength: number = 35): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
};

// Display-only country name abbreviations (does NOT affect API/database)
const COUNTRY_DISPLAY_NAMES: Record<string, string> = {
  // 25+ character countries - MUST abbreviate
  'The United Kingdom Of Great Britain And Northern Ireland': 'UK',
  'Ascension And Tristan Da Cunha Saint Helena': 'St. Helena',
  'The United States Minor Outlying Islands': 'US Minor Islands',
  'The Democratic Peoples Republic Of Korea': 'North Korea',
  'The Democratic Republic Of The Congo': 'DR Congo',
  'The Lao Peoples Democratic Republic': 'Laos',
  'Bolivarian Republic Of Venezuela': 'Venezuela',
  'Saint Vincent And The Grenadines': 'St. Vincent',
  'The French Southern Territories': 'French S. Terr.',
  'British Indian Ocean Territory': 'BIOT',
  'The Falkland Islands Malvinas': 'Falkland Islands',
  'The Central African Republic': 'Central African Rep.',
  'The United States Of America': 'USA',
  'Republic Of North Macedonia': 'North Macedonia',
  'United Republic Of Tanzania': 'Tanzania',
  // 21-25 character countries - optional but cleaner
  'Islamic Republic Of Iran': 'Iran',
  'The United Arab Emirates': 'UAE',
  'The Republic Of Moldova': 'Moldova',
  'The Russian Federation': 'Russia',
  'The Dominican Republic': 'Dominican Rep.',
  'The Republic Of Korea': 'South Korea',
};

const getDisplayCountryName = (country: string): string => {
  return COUNTRY_DISPLAY_NAMES[country] || country;
};

interface StationEngagement {
  totalFavorites?: number;
  averageRating?: number;
  totalRatings?: number;
  trendingScore?: number;
  weeklyFavorites?: number;
}

interface StationCardProps {
  station: any;
  playlistName?: string;
  onNavigate?: (station: any) => void;
  onPlay?: (station: any, playlistName: string) => void | Promise<void>;
  onStop?: () => void;
  onToggleFavorite?: (stationId: string, isFavorite: boolean) => void;
  onFavorite?: (stationId: string, isFavorite: boolean) => void;
  showVotes?: boolean; // Control whether to show votes
  headingLevel?: 2 | 3 | 4;
  variant?: 'genre';
  showEngagement?: boolean;
  engagement?: StationEngagement;
}

const StationCard = memo(function StationCard({ 
  station, 
  playlistName = "random",
  onNavigate,
  onPlay,
  onStop,
  onToggleFavorite,
  showVotes = false,
  headingLevel = 4,
  variant,
}: StationCardProps) {
  const Heading = `h${headingLevel}` as const;
  const inGenre = variant === 'genre';
  const playButtonSize = inGenre ? 'size-11 border-2 border-transparent bg-clip-padding lg:size-10 lg:border-0' : 'w-12 h-12';
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const hasDistance = typeof station.distance === 'number' && Number.isFinite(station.distance) && station.distance >= 0;
  const [location, setLocation] = useLocation();
  
  // Get global player state to check if this station is currently playing
  const { currentStation, isPlaying: globalIsPlaying, stopStation, playStation } = useGlobalPlayer();
  
  // Check if this specific station is currently playing
  const isThisStationPlaying = globalIsPlaying && currentStation?._id === station._id;

  const handleNavigateAndPlay = async () => {
    if (isExplicitlyFailedStation(station)) return;
    try {
      // Navigate to station detail page
      if (onNavigate) {
        onNavigate(station);
      } else {
        // Generate country-specific localized station URL
        const stationUrl = getStationUrl(station);
        setLocation(stationUrl);
      }
      
      // Also play the station
      if (onPlay) {
        await onPlay(station, playlistName);
      } else {
        // Fallback to global player if no onPlay provided
        await playStation(station);
      }
    } catch (error) {
      // Failed to navigate and play station
      toast({ title: t('errors_failed_to_play_station'), variant: "destructive" });
    }
  };

  const handlePlay = async () => {
    if (isExplicitlyFailedStation(station)) return;
    try {
      setIsLoading(true);
      // Only play the station - no navigation
      if (onPlay) {
        await onPlay(station, playlistName);
      } else {
        // Fallback to global player if no onPlay provided
        await playStation(station);
      }
    } catch (error) {
      toast({ title: t('errors_failed_to_play_station'), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = () => {
    if (isExplicitlyFailedStation(station)) return;
    try {
      // Only navigate to station detail page
      if (onNavigate) {
        onNavigate(station);
      } else {
        // Generate country-specific localized station URL
        const stationUrl = getStationUrl(station);
        setLocation(stationUrl);
      }
    } catch (error) {
      // Failed to navigate to station
    }
  };

  const handleStop = () => {
    if (onStop) {
      onStop();
    } else {
      // Use global stop function if no local onStop provided
      stopStation();
    }
  };

  const handleToggleFavorite = async () => {
    try {
      const newFavoriteState = !isFavorite;
      if (onToggleFavorite) {
        await onToggleFavorite(station._id, newFavoriteState);
      }
      setIsFavorite(newFavoriteState);
      toast({ 
        title: newFavoriteState ? t('general_added_to_favorites') : t('general_removed_from_favorites')
      });
    } catch (error) {
      toast({ title: t('auth_please_login_to_add_favorites'), variant: "destructive" });
    }
  };

  if (isExplicitlyFailedStation(station)) return null;

  return (
    <div 
      className={`group flex items-center rounded-[10px] bg-[#2F2F2F] overflow-hidden w-full md:w-full h-[102px] lg:h-[130px] lg:p-[20px] transition-colors duration-300 ease-out hover:bg-[#383838] cursor-pointer ${inGenre ? 'px-[13px]' : 'p-3'}`}
      style={{ maxWidth: '100%' }}
    >
      <Link
        href={getStationUrl(station)}
        onClick={(e: any) => {
          e.preventDefault();
          handleNavigateAndPlay();
        }}
        aria-label={getStationListenLabel(station.name, t, language)}
        className={`flex-shrink-0 cursor-pointer relative bg-[#1a1a1a] rounded-[9px] overflow-hidden block ${inGenre ? 'size-[73px] lg:size-[90px]' : 'w-[70px] h-[70px] md:w-[90px] md:h-[90px]'}`}
      >
        <StationLogo
          station={station}
          size="card"
          sizes={inGenre ? '(min-width: 1024px) 90px, 73px' : '(min-width: 768px) 90px, 70px'}
          alt={getStationImageAlt(station, language, t)}
          className="absolute inset-0 rounded-[9px]"
        />
      </Link>

      {/* Text Content - Figma: width 106px, height 48px, positioned at left 130px (logo 90px + gap 20px + padding 20px) */}
      <Link
        href={getStationUrl(station)}
        onClick={(e: any) => {
          e.preventDefault();
          handleNavigateAndPlay();
        }}
        className={`${inGenre ? 'ms-[18px] lg:ms-5' : 'ml-3 md:ml-[20px]'} min-w-0 truncate flex-1 cursor-pointer pr-2 flex flex-col justify-center gap-[4px] text-inherit no-underline`}
      >
        <Heading className="text-base md:text-[20px] font-medium text-white truncate leading-[20px] md:leading-[23px]">
          {station.name}
        </Heading>
        {(() => {
          const originalCountry = station.country || 'Unknown';
          const displayCountry = getDisplayCountryName(getLocalizedCountryDisplayName(originalCountry, language));
          // Prefer state field (which contains city data in radio-browser API)
          const city = station.state && station.state.trim() !== '' ? station.state.trim() : '';
          
          // Full location for tooltip (original country name)
          const fullLocationOriginal = city ? `${originalCountry}, ${city}` : originalCountry;
          // Display location (abbreviated country name)
          const displayLocation = city ? `${displayCountry}, ${city}` : displayCountry;
          
          const MAX_LOCATION_LENGTH = 25;
          const isTruncated = displayLocation.length > MAX_LOCATION_LENGTH;
          const truncatedLocation = truncateText(displayLocation, MAX_LOCATION_LENGTH);
          
          return (
            <p 
              className={`text-sm md:text-[15px] font-medium text-white leading-[16px] md:leading-[17px] ${inGenre ? 'truncate' : ''}`}
              title={fullLocationOriginal}
            >
              {isTruncated ? (
                <>
                  {truncatedLocation.includes(',') ? (
                    <>
                      {truncatedLocation.split(',')[0]}
                      <span className="font-normal text-gray-400">, {truncatedLocation.split(',').slice(1).join(',')}</span>
                    </>
                  ) : (
                    truncatedLocation
                  )}
                </>
              ) : (
                <>
                  {displayCountry}
                  {city && <span className="font-normal text-gray-400">, {city}</span>}
                </>
              )}
            </p>
          );
        })()}
        {/* Distance display for nearby stations */}
        {hasDistance && (
          <div 
            className="flex items-center gap-1 text-gray-400"
            title={`${station.distance}km away from your location`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            <span className="text-xs">{station.distance}km</span>
          </div>
        )}
        {/* Likes/Popularity Display */}
        {showVotes && station.votes !== undefined && station.votes > 0 && (
          <div 
            className="flex items-center gap-1 text-gray-400" 
            title={`${station.votes.toLocaleString()} listeners liked this station`}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
            <span className="text-xs">{formatVoteCount(station.votes)}</span>
          </div>
        )}
      </Link>

      <div className="ml-auto flex items-center gap-[10px]">
        {/* Favorite Button - Mobile Only - 44x44 mobile tap target (was 40x40
            in Figma; bumped to meet WCAG 2.5.5 / Apple HIG 44px minimum
            without disturbing the existing visual border-radius look). */}
        <div className="md:hidden">
          <FavoriteButton 
            stationId={station._id} 
            className="!w-11 !h-11 !rounded-[32.22px] !border-[1.6px] !border-black !bg-transparent"
            iconSizeOverride="22.4px"
            borderWidth="1.6px"
          />
        </div>

        {/* Play/Stop Button - Figma: 40x40, bg #656565, border-radius 20px */}
        {isLoading ? (
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#656565]">
            <svg className="h-6 w-6 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : !isThisStationPlaying ? (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
            className={`flex items-center justify-center ${playButtonSize} rounded-full bg-[#656565] hover:bg-[#FF4199] transition-colors duration-300 group-hover:bg-[#FF4199]`}
          >
            <span className="sr-only">{t('player_play_station', t('btn_play', 'Play Radio'))}</span>
            <svg className="h-[26px] w-[26px] text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
            </svg>
          </button>
        ) : (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              handleStop();
            }}
            className={`flex items-center justify-center ${playButtonSize} rounded-full bg-[#FF4199] hover:bg-[#E63A87] transition-colors duration-300`}
          >
            <span className="sr-only">{t('player_stop', t('btn_stop', 'Stop Radio'))}</span>
            <svg className="h-[26px] w-[26px] text-white" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});

export default StationCard;
