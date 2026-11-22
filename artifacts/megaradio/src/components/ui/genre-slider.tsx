import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GenreSliderProps {
  genres: any[];
}

export default function GenreSlider({ genres }: GenreSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const { language } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();

  // Genre background gradients - matching the original design
  const getGenreGradient = (index: number) => {
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // Purple-blue
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', // Pink-red
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // Blue-cyan
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'  // Green-cyan
    ];
    return gradients[index % gradients.length];
  };

  const scrollLeft = () => {
    if (sliderRef.current) {
      sliderRef.current.scrollBy({ left: -300, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (sliderRef.current) {
      sliderRef.current.scrollBy({ left: 300, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative">
      {/* Navigation Buttons */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-8 h-8 p-0"
        onClick={scrollLeft}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-8 h-8 p-0"
        onClick={scrollRight}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>

      {/* Slider Container */}
      <div 
        ref={sliderRef}
        className="flex gap-5 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {genres?.map((genre, index) => (
          <div
            key={genre._id || index}
            className="inline-block h-[85px] min-w-56 md:min-w-80 lg:min-w-60 cursor-pointer select-none rounded-xl bg-cover bg-center-top flex-shrink-0 hover:scale-105 transition-transform"
            style={{
              background: getGenreGradient(index),
            }}
          >
            <a 
              href={getLocalizedUrl(`/genres/${genre.slug || genre.name.toLowerCase()}`)}
              className="h-[85px] flex items-center justify-center rounded-xl"
            >
              <h2 className="px-4 text-2xl font-bold capitalize text-center text-white drop-shadow-lg">
                {genreDisplayName(genre, language)}
              </h2>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}