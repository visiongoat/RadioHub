import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import { Link } from 'wouter';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination, Mousewheel } from 'swiper/modules';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import { useTranslation } from '@/hooks/useTranslation';
import DiscoverableGenreImage, { getGenreImageSources } from './DiscoverableGenreImage';
import 'swiper/css';
import 'swiper/css/pagination';

interface Genre {
  _id: string;
  name: string;
  slug: string;
  discoverableImage?: string;
  discoverable_label?: string;
}

interface DiscoverableGenreSliderProps {
  genres: Genre[];
  headingLevel?: 3 | 4;
}

export default function DiscoverableGenreSlider({ genres, headingLevel = 4 }: DiscoverableGenreSliderProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const { getLocalizedUrl } = useSeoRouting();
  const { t, language } = useTranslation();
  
  // Genre background gradients - EXACT from original megaradio design
  const getGenreGradient = (index: number) => {
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // Purple-blue
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', // Pink-red
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // Blue-cyan
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'  // Green-cyan
    ];
    return gradients[index % gradients.length];
  };

  return (
    <div className="discoverable-genre-slider">
      {/* Mobile-first: Full width cards with horizontal scroll */}
      <style>{`
        .discoverable-genre-slider .swiper-pagination {
          position: relative !important;
          bottom: auto !important;
          margin-top: 16px !important;
        }
        .discoverable-genre-slider :is(h3, h4) {
          /* Industry-standard typography scaling */
          font-size: 30px;
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (min-width: 640px) {
          .discoverable-genre-slider :is(h3, h4) {
            font-size: 24px;
          }
        }
        @media (min-width: 1024px) {
          .discoverable-genre-slider :is(h3, h4) {
            font-size: clamp(32px, 3vw, 44px);
          }
        }
        .discoverable-genre-slider p {
          /* Industry-standard subtitle typography */
          font-size: 15px;
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (min-width: 640px) {
          .discoverable-genre-slider p {
            font-size: 14px;
          }
        }
        @media (min-width: 1024px) {
          .discoverable-genre-slider p {
            font-size: clamp(16px, 1.6vw, 24px);
          }
        }
      `}</style>
      <div className="w-full overflow-hidden">
        <Swiper
          modules={[Pagination, Mousewheel]}
          spaceBetween={16}
          pagination={{
            clickable: true,
            dynamicBullets: false,
          }}
          mousewheel={true}
          allowTouchMove={true}
          simulateTouch={true}
          grabCursor={true}
          slidesPerView={1}
          breakpoints={{
            768: {
              slidesPerView: 1.8,
              spaceBetween: 20,
            },
            1024: {
              slidesPerView: 2,
              spaceBetween: 20,
            },
            1280: {
              slidesPerView: 2,
              spaceBetween: 20,
            },
          }}
          className="w-full"
        >
          {genres.map((genre, index) => {
            const imageSources = getGenreImageSources(genre);
            return (
            <SwiperSlide key={genre._id || index}>
              <Link
                to={getLocalizedUrl(`/genres/${genre.slug || genre._id}`)}
                className="relative flex aspect-[16/7] sm:aspect-[16/8] md:aspect-[593/214] lg:aspect-[593/214] items-center rounded-xl overflow-hidden group"
              >
                {/* Keep a visible background when an uploaded image is unavailable. */}
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    backgroundImage: getGenreGradient(index),
                  }}
                />
                <DiscoverableGenreImage key={JSON.stringify(imageSources)} sources={imageSources} />
                
                {/* Text content - right half, left aligned inside */}
                <div 
                  className="relative z-10 flex flex-col items-start justify-center h-full w-1/2 ml-auto px-3 sm:px-4 md:px-5 lg:px-8"
                >
                  <Heading className="font-bold text-white leading-tight drop-shadow-lg">
                    {genreDisplayName(genre, language)}
                  </Heading>
                  <p className="text-white mt-1 sm:mt-2 md:mt-3 font-medium drop-shadow-md">
                    {((!language || language === 'en') && genre.discoverable_label) || t('discover_all_stations', 'Discover all the stations')}
                  </p>
                </div>
              </Link>
            </SwiperSlide>
            );
          })}
        </Swiper>
      </div>


    </div>
  );
}
