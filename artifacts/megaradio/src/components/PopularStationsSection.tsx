import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import StationCard from '@/components/ui/station-card';
import { InView } from '@/components/ui/in-view';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';

interface PopularStationsSectionProps {
  stations: any[];
  isPending: boolean;
  activeCountry: string;
  onPlay: (station: any, playlistName?: string) => void | Promise<void>;
}

export default function PopularStationsSection({ stations, isPending, activeCountry, onPlay }: PopularStationsSectionProps) {
  const { t, language } = useTranslation();
  const [offsets, setOffsets] = useState<Record<string, number>>(() => { try { const saved=JSON.parse(sessionStorage.getItem('home-popular-offsets')||'{}'); return saved && typeof saved==='object' ? saved : {}; } catch {return {};} });
  const offset = Number.isSafeInteger(offsets[activeCountry]) && offsets[activeCountry]>=0 ? offsets[activeCountry] : 0;
  // A failed/empty request must not leave a permanent 1,400px mobile gap
  // below Recently Played. Preserve the reservation only while data is pending.
  if (!isPending && stations.length === 0) return null;
  const visibleStations = Array.from({ length: Math.min(12, stations.length) }, (_, index) => stations[(offset + index) % stations.length]);
  return (
    <InView rootMargin="150px" className={isPending ? 'min-h-[1400px] lg:min-h-[750px] xl:min-h-[530px]' : undefined}>
      {(inView) => (
        <div className="container">
          <div className="my-8">
            <div className="flex items-start justify-between gap-4">
            <h2 className="section-header pb-4">
              {t('homepage_popular_stations', 'Popular Stations')}
              {!isPending && activeCountry !== 'all' && (
                <span className="text-sm font-normal text-gray-400 ml-2">{t('from', 'from')} {getLocalizedCountryDisplayName(activeCountry, language)}</span>
              )}
            </h2>
            <button type="button" disabled={isPending || stations.length <= 12}
              aria-label={language === 'tr' ? 'İstasyonları değiştir' : language === 'de' ? 'Sender wechseln' : 'Change stations'}
              onClick={() => { const next={...offsets,[activeCountry]:(offset+12)%stations.length}; setOffsets(next); try{sessionStorage.setItem('home-popular-offsets',JSON.stringify(next));}catch{} }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[#292929] bg-[#1c1c1c] text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff2f92] hover:bg-[#292929]">
              <RefreshCw size={20} strokeWidth={1.5}/>
            </button>
            </div>
            <div className="relative">
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
                {!isPending && inView ? visibleStations.map((station, i) => (
                  <StationCard key={`popular-${station._id || i}`} station={station} onPlay={onPlay} showVotes={true} headingLevel={3} />
                )) : Array.from({ length: isPending ? 12 : visibleStations.length }, (_, index) => (
                  <div key={index} className="animate-pulse h-32 bg-gray-600 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </InView>
  );
}
