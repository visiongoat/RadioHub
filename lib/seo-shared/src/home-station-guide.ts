export const HOME_STATION_GUIDE = {
  heading: 'Explore ORF Hitradio Ö3',
  description: 'Get to know this Austrian station with programme and podcast links, FM reception information and answers to common listening questions.',
  label: 'ORF Hitradio Ö3 station guide (in German)',
  href: '/de/sender/orf-hitradio-o3',
  language: 'de',
} as const;

export const FRENCH_HOME_STATION_GUIDE = {
  heading: 'Découvrir Radio Couleur Chartreuse',
  description: 'Une radio associative du massif de la Chartreuse : découvrez son histoire, ses reportages locaux, ses chroniques littéraires et les liens pour retrouver les émissions.',
  label: 'Radio Couleur Chartreuse : écouter le direct et découvrir la radio',
  href: '/fr/station/radio-couleur-chartreuse',
  language: 'fr',
} as const;

export function getHomeStationGuide(language: string) {
  if (language === 'en') return HOME_STATION_GUIDE;
  if (language === 'fr') return FRENCH_HOME_STATION_GUIDE;
  return null;
}
