import type { ReviewedStationEditorial, StationEditorialLink } from './station-editorial-types';
import { REVIEWED_STATION_EDITORIALS } from './reviewed-station-editorials';

export { applyReviewedStationMetadata, getStationEditorialLabels } from './station-editorial-types';
export type { ReviewedStationEditorial, StationEditorialLink } from './station-editorial-types';
export { REVIEWED_STATION_EDITORIALS };

export interface PilotStationEditorial {
  kind: 'pilot';
  summary: string;
  historyHeading: string;
  historyText: string;
  relatedLinks: readonly StationEditorialLink[];
  aboutHeading: string;
  paragraphs: readonly string[];
  programmeHeading: string;
  programmeText: string;
  programmeLink: StationEditorialLink;
  podcastHeading: string;
  podcasts: readonly { name: string; text: string; link: StationEditorialLink }[];
  podcastLink: StationEditorialLink;
  listeningHeading: string;
  listeningText: string;
  listeningLink: StationEditorialLink;
  frequencies?: {
    caption: string;
    columns: readonly [string, string, string];
    rows: readonly { place: string; transmitter: string; mhz: string }[];
    note: string;
    source: StationEditorialLink;
    sourceDate: string;
    sourceDateLabel: string;
    checkedAt: string;
    checkedLabel: string;
  };
  faqHeading: string;
  questions: readonly { question: string; answer: string; link?: StationEditorialLink }[];
  sourcesHeading: string;
  sources: readonly StationEditorialLink[];
  reviewedAt: string;
  reviewedLabel: string;
}

const official = 'https://oe3.orf.at';
const profile = 'https://der.orf.at/unternehmen/programmangebote/radio/oe-drei/index.html';
const playerHelp = `${official}/kontakt/stories/faq/`;

// An explicitly scoped editorial pilot, not a fallback for other stations/locales.
const oe3German: PilotStationEditorial = {
  kind: 'pilot',
  summary: 'Bei Hitradio Ö3 treffen neue Popsongs auf bekannte Titel aus den Achtzigern, Neunzigern und Zweitausendern. Dazwischen informiert der österreichweite ORF-Sender mit Nachrichten, Wetter und Verkehr. Auf MegaRadio hörst du das laufende Ö3-Programm als Livestream.',
  historyHeading: 'Ö3: Sendestart und Studio in Wien',
  historyText: 'Ö3 ging am 1. Oktober 1967 im Zuge der ORF-Programmreform auf Sendung. Heute gehört das deutschsprachige Programm zum österreichweiten Radioangebot des ORF. Im November 2022 wechselte die Redaktion nach fast 25 Jahren in Heiligenstadt auf den ORF-Mediencampus am Küniglberg. Die Studios liegen in der Hugo-Portisch-Gasse 1 in Wien.',
  relatedLinks: [
    { label: 'Weitere Pop-Radios', href: '/de/genres/pop' },
    { label: 'Radios aus Österreich entdecken', href: '/de/regionen/europe/austria' },
  ],
  aboutHeading: 'Österreichische Musik bei Ö3',
  paragraphs: [
    'Wer über Ö3 einen österreichischen Act entdeckt, kann häufig mehr als dessen aktuelle Single finden. Der Sender lädt Musikerinnen und Musiker zu Gesprächen und Studio-Sessions ein. Auch außerhalb des Studios ist Ö3 beteiligt, etwa mit Konzertpartnerschaften und der eigenen Bühne beim Donauinselfest.',
  ],
  programmeHeading: 'Aktuelles Ö3-Programm',
  programmeText: 'Du möchtest eine bestimmte Ö3-Sendung hören? Die Programmübersicht beim ORF zeigt die Sendezeiten nach Wochentag. Hier läuft der Livestream; zum Nachhören früherer Sendungen führt dich das offizielle Ö3-Angebot weiter.',
  programmeLink: { label: 'Zur aktuellen Programmübersicht beim ORF', href: `${official}/sendungen/` },
  podcastHeading: 'Ö3-Podcasts zum Weiterhören',
  podcasts: [
    { name: 'Frühstück bei mir', text: 'Claudia Stöckl spricht mit ihren Gästen über deren Lebenswege. Auf ORF Sound kannst du das gesamte Gespräch nachhören, teilweise mit zusätzlichen Interviewpassagen.', link: { label: 'Frühstück bei mir auf ORF Sound', href: 'https://sound.orf.at/podcast/oe3/fruehstueck-bei-mir' } },
    { name: 'Ö3-Pop-Podcast', text: 'Im Radio bleibt für ein Interview oft nur ein kurzer Ausschnitt. Dieser Podcast bietet längere Gespräche mit Musikerinnen und Musikern aus Österreich und anderen Ländern: über ihre Musik, ihre Projekte und die Geschichten dahinter.', link: { label: 'Ö3-Pop-Podcast auf ORF Sound', href: 'https://sound.orf.at/podcast/oe3/oe3-pop-podcast' } },
    { name: 'OFF Records', text: 'Sandra König und Tom Walek erzählen, was rund um den Ö3-Wecker abseits der Sendung passiert. Es geht um Erlebnisse in der Redaktion und persönliche Geschichten aus ihrem Alltag.', link: { label: 'OFF Records auf ORF Sound', href: 'https://sound.orf.at/podcast/oe3/off-records---der-oe3-wecker-podcast' } },
  ],
  podcastLink: { label: 'Alle Ö3-Podcasts auf ORF Sound', href: 'https://sound.orf.at/podcast/oe3' },
  listeningHeading: 'Ö3-Frequenzen und Online-Empfang',
  listeningText: 'Der Ö3-Livestream nutzt deine Internetverbindung, keine UKW-Frequenz. Bei einem UKW-Radio entscheidet dagegen der Empfangsort. Diese Auswahl aus dem Frequenzbuch der KommAustria ordnet neun Ö3-Frequenzen ihren Senderstandorten zu.',
  listeningLink: { label: 'Offizielle Ö3-Empfangsübersicht', href: `${official}/kontakt/stories/2994869` },
  frequencies: {
    caption: 'Ausgewählte UKW-Frequenzen für Hitradio Ö3',
    columns: ['Ort', 'Senderstandort', 'MHz'],
    rows: [
      { place: 'Wien', transmitter: 'Kahlenberg', mhz: '99,9' },
      { place: 'St. Pölten', transmitter: 'Jauerling', mhz: '89,4' },
      { place: 'Linz', transmitter: 'Lichtenberg', mhz: '88,8' },
      { place: 'Salzburg', transmitter: 'Gaisberg', mhz: '99,0' },
      { place: 'Graz', transmitter: 'Schöckl', mhz: '89,2' },
      { place: 'Klagenfurt', transmitter: 'Dobratsch', mhz: '90,4' },
      { place: 'Innsbruck', transmitter: 'Patscherkofel', mhz: '88,5' },
      { place: 'Bregenz', transmitter: 'Pfänder', mhz: '89,6' },
      { place: 'Rechnitz', transmitter: 'Hirschenstein', mhz: '87,9' },
    ],
    note: 'Die Tabelle ist keine vollständige Frequenzliste. Ort und Senderstandort bezeichnen die eingetragene Sendeanlage, nicht ihr garantiertes Empfangsgebiet. Ein Eintrag im Frequenzbuch belegt außerdem weder den aktuellen Sendebetrieb noch einen störungsfreien Empfang bei dir.',
    source: { label: 'Quelle: KommAustria / RTR-Frequenzbuch', href: 'https://data.rtr.at/pages/open-data/m-freqbuch' },
    sourceDate: '2026-11-08',
    sourceDateLabel: 'Datenstand: 8. November 2026',
    checkedAt: '2026-11-08',
    checkedLabel: 'Abgeglichen am 8. November 2026',
  },
  faqHeading: 'Häufige Fragen zu Hitradio Ö3',
  questions: [
    { question: 'Kann ich eine verpasste Ö3-Sendung nachhören?', answer: 'Für eine frühere Sendung brauchst du das Nachhörangebot des ORF, nicht den Livestream auf dieser Seite. Laut Ö3 ist das Programm dort grundsätzlich sieben Tage abrufbar. Ausnahmen sind möglich, etwa bei Konzertmitschnitten ohne Nachhörrechte. MegaRadio führt kein eigenes Ö3-Sendungsarchiv.', link: { label: 'Nachhören im Ö3-Player erklärt', href: playerHelp } },
    { question: 'Wie finde ich einen Song, der auf Ö3 gelaufen ist?', answer: 'Notiere möglichst den Tag und die ungefähre Uhrzeit. Damit lässt sich im offiziellen Ö3-Player die passende Stelle im Programm der letzten sieben Tage aufrufen; die Zeitleiste nennt die erfassten Titel und Interpreten. Bei DJ-Sets oder Spezialsendungen kann die Liste unvollständig sein.', link: { label: 'Song-Suche beim ORF', href: playerHelp } },
    { question: 'Warum fehlt manchmal der Name des laufenden Songs?', answer: 'Ton und Titelanzeige sind zwei verschiedene Dinge: Läuft die Musik weiter, ist ein leerer Titel allein kein Hinweis auf einen unterbrochenen Stream. Ö3 weist darauf hin, dass bei Live-Übertragungen und voraufgezeichneten Elementen Songdaten fehlen können. Für solche Sendungen lohnt sich ein Blick auf die Playlists der Ö3-Website.' },
  ],
  sourcesHeading: 'Offizielle Quellen',
  sources: [
    { label: 'Ö3-Website', href: `${official}/` },
    { label: 'ORF-Senderporträt', href: profile },
    { label: 'ORF-Radioreform 1967', href: 'https://science.orf.at/stories/3210395/' },
    { label: 'Ö3-Studios in Wien', href: 'https://oe3.orf.at/m/stories/3028942/' },
    { label: 'Österreichische Musik im ORF', href: 'https://der.orf.at/public-value/oesterreichische-musik100.html' },
    { label: 'Ö3-Player: Hilfe und Verfügbarkeit', href: playerHelp },
  ],
  reviewedAt: '2026-11-08',
  reviewedLabel: 'Quellen geprüft am 8. November 2026',
};

export type StationEditorial = PilotStationEditorial | ReviewedStationEditorial;

const reviewedByPath = new Map(REVIEWED_STATION_EDITORIALS.map(record => [record.path, record]));

export function getStationEditorial(
  station: { _id?: string; slug?: string; stationPageMode?: string } | null | undefined,
  language: string,
  pathname?: string,
): StationEditorial | null {
  if (station?.stationPageMode === 'information') return null;
  // The reviewed pilot's original record was merged into this verified survivor.
  if (language === 'de' && (station?._id === '68a8c483bd66579311ab2ffa'
    || station?._id === '68a8c483bd66579311ab2ffe')
    && station.slug === 'orf-hitradio-o3'
    && (!pathname || pathname === '/de/sender/orf-hitradio-o3')) return oe3German;
  if (!pathname) return null;
  const record = reviewedByPath.get(pathname);
  return record && record.language === language && record.stationId === station?._id
    && record.slug === station.slug ? record : null;
}
