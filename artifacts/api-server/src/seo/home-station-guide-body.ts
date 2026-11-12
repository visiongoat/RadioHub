import { getHomeStationGuide } from '@workspace/seo-shared/home-station-guide';

export function renderHomeStationGuideBody(language: string): string {
  const guide = getHomeStationGuide(language);
  if (!guide) return '';
  return `<section class="container relative pt-8 pb-4 text-white" lang="${language}" aria-labelledby="home-station-guide-title" data-testid="home-station-guide">
    <h2 id="home-station-guide-title" class="section-header pb-4">${guide.heading}</h2>
    <p class="max-w-3xl text-sm leading-relaxed text-gray-400 md:text-base">${guide.description}</p>
    <a href="${guide.href}" hreflang="${guide.language}" class="mt-4 inline-block text-sm text-gray-300 underline underline-offset-4 hover:text-[#FF4199] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">${guide.label}</a>
  </section>`;
}
