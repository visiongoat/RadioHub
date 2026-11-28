import { useRecentlyPlayed } from '@/hooks/useRecentlyPlayed';
import { useTranslation } from '@/hooks/useTranslation';
import StationCard from '@/components/ui/station-card';

interface RecentlyPlayedSectionProps {
  onPlay: (station: any) => void;
}

export default function RecentlyPlayedSection({ onPlay }: RecentlyPlayedSectionProps) {
  const { recentlyPlayed, hasRecentlyPlayed, isLoading } = useRecentlyPlayed();
  const { t } = useTranslation();

  // Don't show if user hasn't played any stations and not loading
  if (!hasRecentlyPlayed && !isLoading) {
    return null;
  }

  // Show skeleton while loading
  if (isLoading && !hasRecentlyPlayed) {
    return (
      <div className="container">
        <div className="pb-5 md:pb-[30px]">
          <h2 className="section-header">
            {t('homepage_recently_played', 'Recently Played')}
          </h2>
        </div>
        <div className="home-station-grid">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="h-[102px] animate-pulse rounded-[10px] bg-[#2f2f2f] lg:h-[130px]" />
          ))}
        </div>
      </div>
    );
  }

  // If we have data, show it
  if (hasRecentlyPlayed && recentlyPlayed.length > 0) {
    return (
      <div className="container">
        <div className="pb-5 md:pb-[30px]">
          <h2 className="section-header">
            {t('homepage_recently_played', 'Recently Played')}
          </h2>
        </div>
        
        <div className="home-station-grid">
          {recentlyPlayed.slice(0, 6).map((station: any, i: number) => (
            <StationCard 
              key={`recently-played-${station._id || i}`} 
              station={station} 
              onPlay={onPlay}
              showVotes={false}
              headingLevel={3}
            />
          ))}
        </div>
      </div>
    );
  }

  // No data and not loading
  return null;
}
