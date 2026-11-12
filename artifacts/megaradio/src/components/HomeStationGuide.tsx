import { Link } from 'wouter';
import { getHomeStationGuide } from '@workspace/seo-shared/home-station-guide';
import { useSeoRouting } from '@/hooks/useSeoRouting';

export default function HomeStationGuide() {
  const { currentLanguage } = useSeoRouting();
  const guide = getHomeStationGuide(currentLanguage);
  if (!guide) return null;

  return (
    <section className="container relative pt-8 pb-4 text-white" lang={currentLanguage}
      aria-labelledby="home-station-guide-title" data-testid="home-station-guide">
      <h2 id="home-station-guide-title" className="section-header pb-4">{guide.heading}</h2>
      <p className="max-w-3xl text-sm leading-relaxed text-gray-400 md:text-base">{guide.description}</p>
      <Link href={guide.href} hrefLang={guide.language}
        className="mt-4 inline-block text-sm text-gray-300 underline underline-offset-4 hover:text-[#FF4199] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">
        {guide.label}
      </Link>
    </section>
  );
}
