/**
 * Multilingual SEO templates for genre detail pages (e.g. /tr/turler/pop, /de/genres/pop).
 *
 * Each language entry returns a natural, idiomatic title/description/keywords/H1/body
 * for a given genre. Falls back to English when the language is not yet covered.
 *
 * NOTE: Used by server/seo-renderer.ts in the `pageType === 'genres' && additionalData.genreName`
 * branch (title/description/keywords) AND in the genres SSR body branch (H1 + intro + availability),
 * AND by the client SeoHead.tsx hydration so React doesn't overwrite SSR meta after mount.
 *
 * Database translation keys (`seo_radio_stations`, `seo_listen_live_online`, etc.) take precedence
 * for the title/description override path when ALL relevant keys are present — but the H1 and body
 * always use the per-language template to avoid mid-sentence English fragments like
 * "Pop Radio Stations - Canlı Dinle".
 */

export interface GenreSeoTemplate {
  title: (genre: string) => string;
  description: (genre: string) => string;
  keywords: (genre: string) => string;
  h1: (genre: string) => string;
  bodyIntro: (genre: string) => string;
  bodyAvailability: (genre: string) => string;
}

// All 57 supported languages — natural, locale-aware phrasing.
// Any language not present here falls back to English.
export const GENRE_SEO_TEMPLATES: Record<string, GenreSeoTemplate> = {
  en: {
    title: (g) => `${g} Radio Stations - Listen Live Online | Mega Radio`,
    description: (g) => `Listen to live ${g} radio online. Discover the best ${g} music stations and shows on Mega Radio — free and unlimited.`,
    keywords: (g) => `${g} radio, ${g} music, ${g} stations, live ${g}, online ${g} radio`,
    h1: (g) => `${g} Radio Stations — Listen Live Online`,
    bodyIntro: (g) => `Listen to live ${g} radio online. Discover the best ${g} music stations and shows streaming for free on Mega Radio.`,
    bodyAvailability: (g) => `Browse 60,000+ radio stations from 120+ countries — ${g} stations available 24/7 for free streaming.`,
  },
  tr: {
    title: (g) => `${g} Radyo İstasyonları - Canlı Dinle | Mega Radio`,
    description: (g) => `${g} türünde canlı radyo dinleyin. Mega Radio'da en iyi ${g} müzik istasyonlarını ve programlarını ücretsiz keşfedin.`,
    keywords: (g) => `${g} radyo, ${g} müzik, ${g} istasyonları, canlı ${g}, online ${g} radyo`,
    h1: (g) => `${g} Radyo İstasyonları — Canlı Dinle`,
    bodyIntro: (g) => `${g} türünde canlı radyo dinleyin. Mega Radio'da en iyi ${g} müzik istasyonlarını ve programlarını ücretsiz keşfedin.`,
    bodyAvailability: (g) => `120'den fazla ülkeden 60.000'den fazla radyo istasyonuna göz atın — ${g} istasyonları 7/24 ücretsiz yayında.`,
  },
  de: {
    title: (g) => `${g} Radiosender - Live online hören | Mega Radio`,
    description: (g) => `Höre kostenlos Live-Radio im Genre ${g}. Entdecke die besten ${g}-Musiksender und Sendungen auf Mega Radio.`,
    keywords: (g) => `${g} Radio, ${g} Musik, ${g} Sender, Live-${g}, ${g} Radiosender`,
    h1: (g) => `${g} Radiosender — Live online hören`,
    bodyIntro: (g) => `Höre kostenlos Live-Radio im Genre ${g}. Entdecke die besten ${g}-Musiksender und Sendungen auf Mega Radio.`,
    bodyAvailability: (g) => `Stöbere durch 60.000+ Radiosender aus 120+ Ländern — ${g}-Sender rund um die Uhr kostenlos verfügbar.`,
  },
  es: {
    title: (g) => `Emisoras de Radio ${g} - Escucha en Vivo Online | Mega Radio`,
    description: (g) => `Escucha radio ${g} en vivo y gratis. Descubre las mejores emisoras y programas de música ${g} en Mega Radio.`,
    keywords: (g) => `radio ${g}, música ${g}, emisoras ${g}, ${g} en vivo, ${g} online`,
    h1: (g) => `Emisoras de Radio ${g} — Escucha en Vivo Online`,
    bodyIntro: (g) => `Escucha radio ${g} en vivo y gratis. Descubre las mejores emisoras y programas de música ${g} en Mega Radio.`,
    bodyAvailability: (g) => `Explora más de 60.000 emisoras de radio de más de 120 países — emisoras de ${g} disponibles las 24 horas, gratis.`,
  },
  fr: {
    title: (g) => `Stations Radio ${g} - Écoute en Direct en Ligne | Mega Radio`,
    description: (g) => `Écoutez la radio ${g} en direct et gratuitement. Découvrez les meilleures stations et émissions de musique ${g} sur Mega Radio.`,
    keywords: (g) => `radio ${g}, musique ${g}, stations ${g}, ${g} en direct, ${g} en ligne`,
    h1: (g) => `Stations Radio ${g} — Écoute en Direct en Ligne`,
    bodyIntro: (g) => `Écoutez la radio ${g} en direct et gratuitement. Découvrez les meilleures stations et émissions de musique ${g} sur Mega Radio.`,
    bodyAvailability: (g) => `Parcourez plus de 60 000 stations radio de plus de 120 pays — stations ${g} disponibles 24h/24, gratuitement.`,
  },
  it: {
    title: (g) => `Radio ${g} - Ascolta in Diretta Online | Mega Radio`,
    description: (g) => `Ascolta radio ${g} in diretta gratis. Scopri le migliori stazioni e programmi musicali ${g} su Mega Radio.`,
    keywords: (g) => `radio ${g}, musica ${g}, stazioni ${g}, ${g} in diretta, ${g} online`,
    h1: (g) => `Radio ${g} — Ascolta in Diretta Online`,
    bodyIntro: (g) => `Ascolta radio ${g} in diretta gratis. Scopri le migliori stazioni e programmi musicali ${g} su Mega Radio.`,
    bodyAvailability: (g) => `Sfoglia oltre 60.000 stazioni radio da più di 120 paesi — stazioni ${g} disponibili 24 ore su 24, gratis.`,
  },
  pt: {
    title: (g) => `Rádios ${g} - Ouça Ao Vivo Online | Mega Radio`,
    description: (g) => `Ouça rádio ${g} ao vivo e grátis. Descubra as melhores estações e programas de música ${g} na Mega Radio.`,
    keywords: (g) => `rádio ${g}, música ${g}, estações ${g}, ${g} ao vivo, ${g} online`,
    h1: (g) => `Rádios ${g} — Ouça Ao Vivo Online`,
    bodyIntro: (g) => `Ouça rádio ${g} ao vivo e grátis. Descubra as melhores estações e programas de música ${g} na Mega Radio.`,
    bodyAvailability: (g) => `Navegue por mais de 60.000 estações de rádio de mais de 120 países — estações de ${g} disponíveis 24/7, grátis.`,
  },
  ru: {
    title: (g) => `${g} Радиостанции - Слушать Онлайн в Прямом Эфире | Mega Radio`,
    description: (g) => `Слушайте ${g} радио онлайн бесплатно. Откройте лучшие ${g} музыкальные станции и шоу на Mega Radio.`,
    keywords: (g) => `${g} радио, ${g} музыка, ${g} станции, ${g} онлайн, ${g} прямой эфир`,
    h1: (g) => `${g} Радиостанции — Слушать Онлайн в Прямом Эфире`,
    bodyIntro: (g) => `Слушайте ${g} радио онлайн бесплатно. Откройте лучшие ${g} музыкальные станции и шоу на Mega Radio.`,
    bodyAvailability: (g) => `Просматривайте более 60 000 радиостанций из 120+ стран — ${g} станции доступны 24/7 бесплатно.`,
  },
  ar: {
    title: (g) => `محطات راديو ${g} - استمع مباشر عبر الإنترنت | Mega Radio`,
    description: (g) => `استمع إلى راديو ${g} مباشرة ومجاناً. اكتشف أفضل محطات وبرامج موسيقى ${g} على Mega Radio.`,
    keywords: (g) => `راديو ${g}, موسيقى ${g}, محطات ${g}, ${g} مباشر, ${g} اونلاين`,
    h1: (g) => `محطات راديو ${g} — استمع مباشر عبر الإنترنت`,
    bodyIntro: (g) => `استمع إلى راديو ${g} مباشرة ومجاناً. اكتشف أفضل محطات وبرامج موسيقى ${g} على Mega Radio.`,
    bodyAvailability: (g) => `تصفح أكثر من 60,000 محطة راديو من أكثر من 120 دولة — محطات ${g} متاحة على مدار الساعة طوال أيام الأسبوع مجاناً.`,
  },
  nl: {
    title: (g) => `${g} Radiostations - Luister Live Online | Mega Radio`,
    description: (g) => `Luister gratis live naar ${g} radio. Ontdek de beste ${g} muziekzenders en programma's op Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} muziek, ${g} zenders, live ${g}, ${g} online`,
    h1: (g) => `${g} Radiostations — Luister Live Online`,
    bodyIntro: (g) => `Luister gratis live naar ${g} radio. Ontdek de beste ${g} muziekzenders en programma's op Mega Radio.`,
    bodyAvailability: (g) => `Blader door 60.000+ radiostations uit 120+ landen — ${g}-zenders 24/7 gratis beschikbaar.`,
  },
  pl: {
    title: (g) => `Stacje Radiowe ${g} - Słuchaj Na Żywo Online | Mega Radio`,
    description: (g) => `Słuchaj radia ${g} na żywo za darmo. Odkryj najlepsze stacje i programy muzyczne ${g} w Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} muzyka, ${g} stacje, ${g} na żywo, ${g} online`,
    h1: (g) => `Stacje Radiowe ${g} — Słuchaj Na Żywo Online`,
    bodyIntro: (g) => `Słuchaj radia ${g} na żywo za darmo. Odkryj najlepsze stacje i programy muzyczne ${g} w Mega Radio.`,
    bodyAvailability: (g) => `Przeglądaj ponad 60 000 stacji radiowych z ponad 120 krajów — stacje ${g} dostępne 24/7 za darmo.`,
  },
  zh: {
    title: (g) => `${g} 电台 - 在线直播收听 | Mega Radio`,
    description: (g) => `免费在线收听 ${g} 电台直播。在 Mega Radio 上发现最好的 ${g} 音乐和节目。`,
    keywords: (g) => `${g} 电台, ${g} 音乐, ${g} 节目, 在线 ${g}, ${g} 直播`,
    h1: (g) => `${g} 电台 — 在线直播收听`,
    bodyIntro: (g) => `免费在线收听 ${g} 电台直播。在 Mega Radio 上发现最好的 ${g} 音乐和节目。`,
    bodyAvailability: (g) => `浏览来自 120+ 国家的 60,000+ 个电台 — ${g} 电台 24/7 全天候免费收听。`,
  },
  ja: {
    title: (g) => `${g} ラジオ局 - ライブで聴くオンライン | Mega Radio`,
    description: (g) => `${g} のラジオを無料でライブ視聴。Mega Radio で最高の ${g} 音楽と番組を発見しましょう。`,
    keywords: (g) => `${g} ラジオ, ${g} 音楽, ${g} 番組, ${g} オンライン, ${g} ライブ`,
    h1: (g) => `${g} ラジオ局 — ライブで聴くオンライン`,
    bodyIntro: (g) => `${g} のラジオを無料でライブ視聴。Mega Radio で最高の ${g} 音楽と番組を発見しましょう。`,
    bodyAvailability: (g) => `120ヶ国以上の60,000以上のラジオ局を閲覧 — ${g} 局は24時間365日無料でストリーミング可能。`,
  },
  ko: {
    title: (g) => `${g} 라디오 방송국 - 실시간 온라인 청취 | Mega Radio`,
    description: (g) => `${g} 라디오를 실시간으로 무료로 들어보세요. Mega Radio에서 최고의 ${g} 음악과 프로그램을 만나보세요.`,
    keywords: (g) => `${g} 라디오, ${g} 음악, ${g} 방송, ${g} 온라인, ${g} 실시간`,
    h1: (g) => `${g} 라디오 방송국 — 실시간 온라인 청취`,
    bodyIntro: (g) => `${g} 라디오를 실시간으로 무료로 들어보세요. Mega Radio에서 최고의 ${g} 음악과 프로그램을 만나보세요.`,
    bodyAvailability: (g) => `120개국 이상의 60,000개 이상의 라디오 방송국을 둘러보세요 — ${g} 방송국은 24시간 무료 스트리밍 가능합니다.`,
  },
  hi: {
    title: (g) => `${g} रेडियो स्टेशन - ऑनलाइन लाइव सुनें | Mega Radio`,
    description: (g) => `${g} रेडियो ऑनलाइन मुफ्त में लाइव सुनें। Mega Radio पर सबसे अच्छे ${g} संगीत स्टेशन और शो खोजें।`,
    keywords: (g) => `${g} रेडियो, ${g} संगीत, ${g} स्टेशन, ${g} ऑनलाइन, ${g} लाइव`,
    h1: (g) => `${g} रेडियो स्टेशन — ऑनलाइन लाइव सुनें`,
    bodyIntro: (g) => `${g} रेडियो ऑनलाइन मुफ्त में लाइव सुनें। Mega Radio पर सबसे अच्छे ${g} संगीत स्टेशन और शो खोजें।`,
    bodyAvailability: (g) => `120+ देशों के 60,000+ रेडियो स्टेशन ब्राउज़ करें — ${g} स्टेशन 24/7 मुफ्त स्ट्रीमिंग के लिए उपलब्ध।`,
  },
  sv: {
    title: (g) => `${g} Radiostationer - Lyssna Live Online | Mega Radio`,
    description: (g) => `Lyssna på ${g}-radio live och gratis. Upptäck de bästa ${g}-musikstationerna och programmen på Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} musik, ${g} stationer, ${g} live, ${g} online`,
    h1: (g) => `${g} Radiostationer — Lyssna Live Online`,
    bodyIntro: (g) => `Lyssna på ${g}-radio live och gratis. Upptäck de bästa ${g}-musikstationerna och programmen på Mega Radio.`,
    bodyAvailability: (g) => `Bläddra bland över 60 000 radiostationer från 120+ länder — ${g}-stationer dygnet runt, helt gratis.`,
  },
  da: {
    title: (g) => `${g} Radiostationer - Lyt Live Online | Mega Radio`,
    description: (g) => `Lyt til ${g}-radio live og gratis. Opdag de bedste ${g}-musikstationer og programmer på Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} musik, ${g} stationer, ${g} live, ${g} online`,
    h1: (g) => `${g} Radiostationer — Lyt Live Online`,
    bodyIntro: (g) => `Lyt til ${g}-radio live og gratis. Opdag de bedste ${g}-musikstationer og programmer på Mega Radio.`,
    bodyAvailability: (g) => `Gennemse 60.000+ radiostationer fra 120+ lande — ${g}-stationer døgnet rundt, helt gratis.`,
  },
  no: {
    title: (g) => `${g} Radiostasjoner - Hør Live på Nett | Mega Radio`,
    description: (g) => `Hør ${g}-radio live og gratis. Oppdag de beste ${g}-musikkstasjonene og programmene på Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} musikk, ${g} stasjoner, ${g} live, ${g} på nett`,
    h1: (g) => `${g} Radiostasjoner — Hør Live på Nett`,
    bodyIntro: (g) => `Hør ${g}-radio live og gratis. Oppdag de beste ${g}-musikkstasjonene og programmene på Mega Radio.`,
    bodyAvailability: (g) => `Bla gjennom 60 000+ radiostasjoner fra 120+ land — ${g}-stasjoner døgnet rundt, helt gratis.`,
  },
  fi: {
    title: (g) => `${g} Radioasemat - Kuuntele Suorana Verkossa | Mega Radio`,
    description: (g) => `Kuuntele ${g}-radiota suorana ja ilmaiseksi. Löydä parhaat ${g}-musiikkiasemat ja ohjelmat Mega Radiosta.`,
    keywords: (g) => `${g} radio, ${g} musiikki, ${g} asemat, ${g} suora, ${g} verkossa`,
    h1: (g) => `${g} Radioasemat — Kuuntele Suorana Verkossa`,
    bodyIntro: (g) => `Kuuntele ${g}-radiota suorana ja ilmaiseksi. Löydä parhaat ${g}-musiikkiasemat ja ohjelmat Mega Radiosta.`,
    bodyAvailability: (g) => `Selaa yli 60 000 radioasemaa yli 120 maasta — ${g}-asemat saatavilla 24/7 ilmaiseksi.`,
  },
  el: {
    title: (g) => `Ραδιοφωνικοί Σταθμοί ${g} - Ακούστε Ζωντανά Online | Mega Radio`,
    description: (g) => `Ακούστε ${g} ραδιόφωνο ζωντανά και δωρεάν. Ανακαλύψτε τους καλύτερους ${g} μουσικούς σταθμούς και εκπομπές στο Mega Radio.`,
    keywords: (g) => `${g} ραδιόφωνο, ${g} μουσική, ${g} σταθμοί, ${g} ζωντανά, ${g} online`,
    h1: (g) => `Ραδιοφωνικοί Σταθμοί ${g} — Ακούστε Ζωντανά Online`,
    bodyIntro: (g) => `Ακούστε ${g} ραδιόφωνο ζωντανά και δωρεάν. Ανακαλύψτε τους καλύτερους ${g} μουσικούς σταθμούς και εκπομπές στο Mega Radio.`,
    bodyAvailability: (g) => `Περιηγηθείτε σε 60.000+ ραδιοφωνικούς σταθμούς από 120+ χώρες — σταθμοί ${g} διαθέσιμοι 24/7 δωρεάν.`,
  },
  hu: {
    title: (g) => `${g} Rádióállomások - Hallgasd Élőben Online | Mega Radio`,
    description: (g) => `Hallgass ${g} rádiót élőben, ingyen. Fedezd fel a legjobb ${g} zenei állomásokat és műsorokat a Mega Radión.`,
    keywords: (g) => `${g} rádió, ${g} zene, ${g} állomások, ${g} élő, ${g} online`,
    h1: (g) => `${g} Rádióállomások — Hallgasd Élőben Online`,
    bodyIntro: (g) => `Hallgass ${g} rádiót élőben, ingyen. Fedezd fel a legjobb ${g} zenei állomásokat és műsorokat a Mega Radión.`,
    bodyAvailability: (g) => `Böngéssz 60 000+ rádióállomás között 120+ országból — ${g} állomások 0–24-ben, ingyen.`,
  },
  cs: {
    title: (g) => `Rádiové Stanice ${g} - Poslouchejte Živě Online | Mega Radio`,
    description: (g) => `Poslouchejte ${g} rádio živě a zdarma. Objevte nejlepší ${g} hudební stanice a pořady na Mega Radio.`,
    keywords: (g) => `${g} rádio, ${g} hudba, ${g} stanice, ${g} živě, ${g} online`,
    h1: (g) => `Rádiové Stanice ${g} — Poslouchejte Živě Online`,
    bodyIntro: (g) => `Poslouchejte ${g} rádio živě a zdarma. Objevte nejlepší ${g} hudební stanice a pořady na Mega Radio.`,
    bodyAvailability: (g) => `Procházejte více než 60 000 rádiových stanic ze 120+ zemí — stanice ${g} dostupné 24/7 zdarma.`,
  },
  sk: {
    title: (g) => `Rádiové Stanice ${g} - Počúvajte Naživo Online | Mega Radio`,
    description: (g) => `Počúvajte ${g} rádio naživo a zadarmo. Objavte najlepšie ${g} hudobné stanice a relácie na Mega Radio.`,
    keywords: (g) => `${g} rádio, ${g} hudba, ${g} stanice, ${g} naživo, ${g} online`,
    h1: (g) => `Rádiové Stanice ${g} — Počúvajte Naživo Online`,
    bodyIntro: (g) => `Počúvajte ${g} rádio naživo a zadarmo. Objavte najlepšie ${g} hudobné stanice a relácie na Mega Radio.`,
    bodyAvailability: (g) => `Prechádzajte viac ako 60 000 rádiových staníc zo 120+ krajín — stanice ${g} dostupné 24/7 zadarmo.`,
  },
  ro: {
    title: (g) => `Posturi Radio ${g} - Ascultă Live Online | Mega Radio`,
    description: (g) => `Ascultă radio ${g} live și gratuit. Descoperă cele mai bune posturi și emisiuni de muzică ${g} pe Mega Radio.`,
    keywords: (g) => `radio ${g}, muzică ${g}, posturi ${g}, ${g} live, ${g} online`,
    h1: (g) => `Posturi Radio ${g} — Ascultă Live Online`,
    bodyIntro: (g) => `Ascultă radio ${g} live și gratuit. Descoperă cele mai bune posturi și emisiuni de muzică ${g} pe Mega Radio.`,
    bodyAvailability: (g) => `Răsfoiește peste 60.000 de posturi radio din peste 120 de țări — posturi ${g} disponibile 24/7, gratuit.`,
  },
  bg: {
    title: (g) => `${g} Радиостанции - Слушайте На Живо Онлайн | Mega Radio`,
    description: (g) => `Слушайте ${g} радио на живо и безплатно. Открийте най-добрите ${g} музикални станции и предавания в Mega Radio.`,
    keywords: (g) => `${g} радио, ${g} музика, ${g} станции, ${g} на живо, ${g} онлайн`,
    h1: (g) => `${g} Радиостанции — Слушайте На Живо Онлайн`,
    bodyIntro: (g) => `Слушайте ${g} радио на живо и безплатно. Открийте най-добрите ${g} музикални станции и предавания в Mega Radio.`,
    bodyAvailability: (g) => `Разгледайте 60 000+ радиостанции от 120+ държави — ${g} станции достъпни 24/7 безплатно.`,
  },
  hr: {
    title: (g) => `Radio Stanice ${g} - Slušajte Uživo Online | Mega Radio`,
    description: (g) => `Slušajte ${g} radio uživo i besplatno. Otkrijte najbolje ${g} glazbene stanice i emisije na Mega Radiju.`,
    keywords: (g) => `${g} radio, ${g} glazba, ${g} stanice, ${g} uživo, ${g} online`,
    h1: (g) => `Radio Stanice ${g} — Slušajte Uživo Online`,
    bodyIntro: (g) => `Slušajte ${g} radio uživo i besplatno. Otkrijte najbolje ${g} glazbene stanice i emisije na Mega Radiju.`,
    bodyAvailability: (g) => `Pregledajte više od 60.000 radio stanica iz 120+ zemalja — ${g} stanice dostupne 24/7 besplatno.`,
  },
  sr: {
    title: (g) => `${g} Radio Stanice - Slušajte Uživo Online | Mega Radio`,
    description: (g) => `Slušajte ${g} radio uživo i besplatno. Otkrijte najbolje ${g} muzičke stanice i emisije na Mega Radiju.`,
    keywords: (g) => `${g} radio, ${g} muzika, ${g} stanice, ${g} uživo, ${g} online`,
    h1: (g) => `${g} Radio Stanice — Slušajte Uživo Online`,
    bodyIntro: (g) => `Slušajte ${g} radio uživo i besplatno. Otkrijte najbolje ${g} muzičke stanice i emisije na Mega Radiju.`,
    bodyAvailability: (g) => `Pregledajte preko 60.000 radio stanica iz 120+ zemalja — ${g} stanice dostupne 24/7 besplatno.`,
  },
  sl: {
    title: (g) => `Radijske Postaje ${g} - Poslušajte v Živo Online | Mega Radio`,
    description: (g) => `Poslušajte ${g} radio v živo in brezplačno. Odkrijte najboljše ${g} glasbene postaje in oddaje na Mega Radiu.`,
    keywords: (g) => `${g} radio, ${g} glasba, ${g} postaje, ${g} v živo, ${g} online`,
    h1: (g) => `Radijske Postaje ${g} — Poslušajte v Živo Online`,
    bodyIntro: (g) => `Poslušajte ${g} radio v živo in brezplačno. Odkrijte najboljše ${g} glasbene postaje in oddaje na Mega Radiu.`,
    bodyAvailability: (g) => `Brskajte med več kot 60.000 radijskimi postajami iz več kot 120 držav — ${g} postaje na voljo 24/7 brezplačno.`,
  },
  lv: {
    title: (g) => `${g} Radiostacijas - Klausieties Tiešraidē Tiešsaistē | Mega Radio`,
    description: (g) => `Klausieties ${g} radio tiešraidē bez maksas. Atklājiet labākās ${g} mūzikas stacijas un raidījumus Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} mūzika, ${g} stacijas, ${g} tiešraide, ${g} tiešsaistē`,
    h1: (g) => `${g} Radiostacijas — Klausieties Tiešraidē Tiešsaistē`,
    bodyIntro: (g) => `Klausieties ${g} radio tiešraidē bez maksas. Atklājiet labākās ${g} mūzikas stacijas un raidījumus Mega Radio.`,
    bodyAvailability: (g) => `Pārlūkojiet vairāk nekā 60 000 radiostaciju no 120+ valstīm — ${g} stacijas pieejamas 24/7 bez maksas.`,
  },
  lt: {
    title: (g) => `${g} Radijo Stotys - Klausykitės Tiesiogiai Internetu | Mega Radio`,
    description: (g) => `Klausykitės ${g} radijo tiesiogiai ir nemokamai. Atraskite geriausias ${g} muzikos stotis ir laidas Mega Radio.`,
    keywords: (g) => `${g} radijas, ${g} muzika, ${g} stotys, ${g} tiesiogiai, ${g} internetu`,
    h1: (g) => `${g} Radijo Stotys — Klausykitės Tiesiogiai Internetu`,
    bodyIntro: (g) => `Klausykitės ${g} radijo tiesiogiai ir nemokamai. Atraskite geriausias ${g} muzikos stotis ir laidas Mega Radio.`,
    bodyAvailability: (g) => `Naršykite daugiau nei 60 000 radijo stočių iš 120+ šalių — ${g} stotys pasiekiamos 24/7 nemokamai.`,
  },
  et: {
    title: (g) => `${g} Raadiojaamad - Kuula Otse Internetis | Mega Radio`,
    description: (g) => `Kuula ${g} raadiot otse ja tasuta. Avasta parimad ${g} muusikajaamad ja saated Mega Radios.`,
    keywords: (g) => `${g} raadio, ${g} muusika, ${g} jaamad, ${g} otse, ${g} internetis`,
    h1: (g) => `${g} Raadiojaamad — Kuula Otse Internetis`,
    bodyIntro: (g) => `Kuula ${g} raadiot otse ja tasuta. Avasta parimad ${g} muusikajaamad ja saated Mega Radios.`,
    bodyAvailability: (g) => `Sirvi rohkem kui 60 000 raadiojaama 120+ riigist — ${g} jaamad saadaval 24/7 tasuta.`,
  },
  th: {
    title: (g) => `สถานีวิทยุ ${g} - ฟังสดออนไลน์ | Mega Radio`,
    description: (g) => `ฟังวิทยุ ${g} สดออนไลน์ฟรี ค้นพบสถานีและรายการเพลง ${g} ที่ดีที่สุดบน Mega Radio`,
    keywords: (g) => `วิทยุ ${g}, เพลง ${g}, สถานี ${g}, ${g} สด, ${g} ออนไลน์`,
    h1: (g) => `สถานีวิทยุ ${g} — ฟังสดออนไลน์`,
    bodyIntro: (g) => `ฟังวิทยุ ${g} สดออนไลน์ฟรี ค้นพบสถานีและรายการเพลง ${g} ที่ดีที่สุดบน Mega Radio`,
    bodyAvailability: (g) => `เลือกฟังจากสถานีวิทยุกว่า 60,000 แห่งจาก 120+ ประเทศ — สถานี ${g} พร้อมให้ฟังฟรีตลอด 24 ชั่วโมง`,
  },
  vi: {
    title: (g) => `Đài Phát Thanh ${g} - Nghe Trực Tuyến Trực Tiếp | Mega Radio`,
    description: (g) => `Nghe radio ${g} trực tiếp miễn phí. Khám phá những đài và chương trình âm nhạc ${g} hay nhất trên Mega Radio.`,
    keywords: (g) => `radio ${g}, nhạc ${g}, đài ${g}, ${g} trực tiếp, ${g} trực tuyến`,
    h1: (g) => `Đài Phát Thanh ${g} — Nghe Trực Tuyến Trực Tiếp`,
    bodyIntro: (g) => `Nghe radio ${g} trực tiếp miễn phí. Khám phá những đài và chương trình âm nhạc ${g} hay nhất trên Mega Radio.`,
    bodyAvailability: (g) => `Duyệt hơn 60.000 đài phát thanh từ hơn 120 quốc gia — đài ${g} phát 24/7 miễn phí.`,
  },
  id: {
    title: (g) => `Stasiun Radio ${g} - Dengarkan Langsung Online | Mega Radio`,
    description: (g) => `Dengarkan radio ${g} langsung secara gratis. Temukan stasiun dan acara musik ${g} terbaik di Mega Radio.`,
    keywords: (g) => `radio ${g}, musik ${g}, stasiun ${g}, ${g} langsung, ${g} online`,
    h1: (g) => `Stasiun Radio ${g} — Dengarkan Langsung Online`,
    bodyIntro: (g) => `Dengarkan radio ${g} langsung secara gratis. Temukan stasiun dan acara musik ${g} terbaik di Mega Radio.`,
    bodyAvailability: (g) => `Jelajahi lebih dari 60.000 stasiun radio dari 120+ negara — stasiun ${g} tersedia 24/7 gratis.`,
  },
  ms: {
    title: (g) => `Stesen Radio ${g} - Dengar Secara Langsung Dalam Talian | Mega Radio`,
    description: (g) => `Dengar radio ${g} secara langsung dan percuma. Temui stesen dan rancangan muzik ${g} terbaik di Mega Radio.`,
    keywords: (g) => `radio ${g}, muzik ${g}, stesen ${g}, ${g} langsung, ${g} dalam talian`,
    h1: (g) => `Stesen Radio ${g} — Dengar Secara Langsung Dalam Talian`,
    bodyIntro: (g) => `Dengar radio ${g} secara langsung dan percuma. Temui stesen dan rancangan muzik ${g} terbaik di Mega Radio.`,
    bodyAvailability: (g) => `Layari lebih 60,000 stesen radio dari 120+ negara — stesen ${g} tersedia 24/7 secara percuma.`,
  },
  tl: {
    title: (g) => `Mga Istasyon ng Radyo na ${g} - Makinig Live Online | Mega Radio`,
    description: (g) => `Makinig sa ${g} radyo nang live at libre. Tuklasin ang pinakamahusay na ${g} musika at mga palabas sa Mega Radio.`,
    keywords: (g) => `${g} radyo, ${g} musika, ${g} istasyon, ${g} live, ${g} online`,
    h1: (g) => `Mga Istasyon ng Radyo na ${g} — Makinig Live Online`,
    bodyIntro: (g) => `Makinig sa ${g} radyo nang live at libre. Tuklasin ang pinakamahusay na ${g} musika at mga palabas sa Mega Radio.`,
    bodyAvailability: (g) => `Mag-browse ng 60,000+ istasyon ng radyo mula sa 120+ bansa — ${g} istasyon na available 24/7 nang libre.`,
  },
  he: {
    title: (g) => `תחנות רדיו ${g} - האזינו בשידור חי אונליין | Mega Radio`,
    description: (g) => `האזינו לרדיו ${g} בשידור חי ובחינם. גלו את תחנות המוזיקה והתוכניות הטובות ביותר של ${g} ב-Mega Radio.`,
    keywords: (g) => `רדיו ${g}, מוזיקה ${g}, תחנות ${g}, ${g} שידור חי, ${g} אונליין`,
    h1: (g) => `תחנות רדיו ${g} — האזינו בשידור חי אונליין`,
    bodyIntro: (g) => `האזינו לרדיו ${g} בשידור חי ובחינם. גלו את תחנות המוזיקה והתוכניות הטובות ביותר של ${g} ב-Mega Radio.`,
    bodyAvailability: (g) => `עיינו ביותר מ-60,000 תחנות רדיו מ-120+ מדינות — תחנות ${g} זמינות 24/7 בחינם.`,
  },
  fa: {
    title: (g) => `ایستگاه‌های رادیو ${g} - پخش زنده آنلاین | Mega Radio`,
    description: (g) => `رادیو ${g} را زنده و رایگان آنلاین گوش دهید. بهترین ایستگاه‌ها و برنامه‌های موسیقی ${g} را در Mega Radio کشف کنید.`,
    keywords: (g) => `رادیو ${g}, موسیقی ${g}, ایستگاه‌های ${g}, ${g} زنده, ${g} آنلاین`,
    h1: (g) => `ایستگاه‌های رادیو ${g} — پخش زنده آنلاین`,
    bodyIntro: (g) => `رادیو ${g} را زنده و رایگان آنلاین گوش دهید. بهترین ایستگاه‌ها و برنامه‌های موسیقی ${g} را در Mega Radio کشف کنید.`,
    bodyAvailability: (g) => `بیش از ۶۰٬۰۰۰ ایستگاه رادیویی از بیش از ۱۲۰ کشور را مرور کنید — ایستگاه‌های ${g} ۲۴ ساعته رایگان در دسترس هستند.`,
  },
  ur: {
    title: (g) => `${g} ریڈیو اسٹیشنز - آن لائن لائیو سنیں | Mega Radio`,
    description: (g) => `${g} ریڈیو آن لائن مفت میں لائیو سنیں۔ Mega Radio پر بہترین ${g} موسیقی اسٹیشنز اور شوز دریافت کریں۔`,
    keywords: (g) => `${g} ریڈیو, ${g} موسیقی, ${g} اسٹیشنز, ${g} لائیو, ${g} آن لائن`,
    h1: (g) => `${g} ریڈیو اسٹیشنز — آن لائن لائیو سنیں`,
    bodyIntro: (g) => `${g} ریڈیو آن لائن مفت میں لائیو سنیں۔ Mega Radio پر بہترین ${g} موسیقی اسٹیشنز اور شوز دریافت کریں۔`,
    bodyAvailability: (g) => `120+ ممالک کے 60,000+ ریڈیو اسٹیشنز براؤز کریں — ${g} اسٹیشنز 24/7 مفت دستیاب۔`,
  },
  bn: {
    title: (g) => `${g} রেডিও স্টেশন - অনলাইনে লাইভ শুনুন | Mega Radio`,
    description: (g) => `${g} রেডিও অনলাইনে বিনামূল্যে লাইভ শুনুন। Mega Radio-এ সেরা ${g} সঙ্গীত স্টেশন এবং শো আবিষ্কার করুন।`,
    keywords: (g) => `${g} রেডিও, ${g} সঙ্গীত, ${g} স্টেশন, ${g} লাইভ, ${g} অনলাইন`,
    h1: (g) => `${g} রেডিও স্টেশন — অনলাইনে লাইভ শুনুন`,
    bodyIntro: (g) => `${g} রেডিও অনলাইনে বিনামূল্যে লাইভ শুনুন। Mega Radio-এ সেরা ${g} সঙ্গীত স্টেশন এবং শো আবিষ্কার করুন।`,
    bodyAvailability: (g) => `120+ দেশের 60,000+ রেডিও স্টেশন ব্রাউজ করুন — ${g} স্টেশন 24/7 বিনামূল্যে উপলব্ধ।`,
  },
  ta: {
    title: (g) => `${g} வானொலி நிலையங்கள் - இணையத்தில் நேரலையில் கேளுங்கள் | Mega Radio`,
    description: (g) => `${g} வானொலியை இணையத்தில் இலவசமாக நேரலையில் கேளுங்கள். Mega Radio-வில் சிறந்த ${g} இசை நிலையங்கள் மற்றும் நிகழ்ச்சிகளைக் கண்டறியவும்.`,
    keywords: (g) => `${g} வானொலி, ${g} இசை, ${g} நிலையங்கள், ${g} நேரலை, ${g} இணையம்`,
    h1: (g) => `${g} வானொலி நிலையங்கள் — இணையத்தில் நேரலையில் கேளுங்கள்`,
    bodyIntro: (g) => `${g} வானொலியை இணையத்தில் இலவசமாக நேரலையில் கேளுங்கள். Mega Radio-வில் சிறந்த ${g} இசை நிலையங்கள் மற்றும் நிகழ்ச்சிகளைக் கண்டறியவும்.`,
    bodyAvailability: (g) => `120+ நாடுகளிலிருந்து 60,000+ வானொலி நிலையங்களை உலாவவும் — ${g} நிலையங்கள் 24/7 இலவசமாகக் கிடைக்கின்றன.`,
  },
  te: {
    title: (g) => `${g} రేడియో స్టేషన్‌లు - ఆన్‌లైన్‌లో ప్రత్యక్షంగా వినండి | Mega Radio`,
    description: (g) => `${g} రేడియోను ఆన్‌లైన్‌లో ఉచితంగా ప్రత్యక్షంగా వినండి. Mega Radio లో ఉత్తమ ${g} సంగీత స్టేషన్‌లు మరియు షోలను కనుగొనండి.`,
    keywords: (g) => `${g} రేడియో, ${g} సంగీతం, ${g} స్టేషన్‌లు, ${g} ప్రత్యక్షం, ${g} ఆన్‌లైన్`,
    h1: (g) => `${g} రేడియో స్టేషన్‌లు — ఆన్‌లైన్‌లో ప్రత్యక్షంగా వినండి`,
    bodyIntro: (g) => `${g} రేడియోను ఆన్‌లైన్‌లో ఉచితంగా ప్రత్యక్షంగా వినండి. Mega Radio లో ఉత్తమ ${g} సంగీత స్టేషన్‌లు మరియు షోలను కనుగొనండి.`,
    bodyAvailability: (g) => `120+ దేశాల నుండి 60,000+ రేడియో స్టేషన్‌లను బ్రౌజ్ చేయండి — ${g} స్టేషన్‌లు 24/7 ఉచితంగా అందుబాటులో ఉన్నాయి.`,
  },
  mr: {
    title: (g) => `${g} रेडिओ स्टेशन्स - ऑनलाइन थेट ऐका | Mega Radio`,
    description: (g) => `${g} रेडिओ ऑनलाइन मोफत थेट ऐका. Mega Radio वर सर्वोत्तम ${g} संगीत स्टेशन्स आणि शो शोधा.`,
    keywords: (g) => `${g} रेडिओ, ${g} संगीत, ${g} स्टेशन्स, ${g} थेट, ${g} ऑनलाइन`,
    h1: (g) => `${g} रेडिओ स्टेशन्स — ऑनलाइन थेट ऐका`,
    bodyIntro: (g) => `${g} रेडिओ ऑनलाइन मोफत थेट ऐका. Mega Radio वर सर्वोत्तम ${g} संगीत स्टेशन्स आणि शो शोधा.`,
    bodyAvailability: (g) => `120+ देशांतील 60,000+ रेडिओ स्टेशन्स ब्राउझ करा — ${g} स्टेशन्स 24/7 मोफत उपलब्ध.`,
  },
  gu: {
    title: (g) => `${g} રેડિયો સ્ટેશનો - ઑનલાઇન લાઇવ સાંભળો | Mega Radio`,
    description: (g) => `${g} રેડિયો ઑનલાઇન મફતમાં લાઇવ સાંભળો. Mega Radio પર શ્રેષ્ઠ ${g} સંગીત સ્ટેશનો અને શો શોધો.`,
    keywords: (g) => `${g} રેડિયો, ${g} સંગીત, ${g} સ્ટેશનો, ${g} લાઇવ, ${g} ઑનલાઇન`,
    h1: (g) => `${g} રેડિયો સ્ટેશનો — ઑનલાઇન લાઇવ સાંભળો`,
    bodyIntro: (g) => `${g} રેડિયો ઑનલાઇન મફતમાં લાઇવ સાંભળો. Mega Radio પર શ્રેષ્ઠ ${g} સંગીત સ્ટેશનો અને શો શોધો.`,
    bodyAvailability: (g) => `120+ દેશોમાંથી 60,000+ રેડિયો સ્ટેશનો બ્રાઉઝ કરો — ${g} સ્ટેશનો 24/7 મફત ઉપલબ્ધ.`,
  },
  kn: {
    title: (g) => `${g} ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳು - ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ನೇರವಾಗಿ ಆಲಿಸಿ | Mega Radio`,
    description: (g) => `${g} ರೇಡಿಯೋವನ್ನು ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಉಚಿತವಾಗಿ ನೇರವಾಗಿ ಆಲಿಸಿ. Mega Radio ನಲ್ಲಿ ಅತ್ಯುತ್ತಮ ${g} ಸಂಗೀತ ಸ್ಟೇಷನ್‌ಗಳು ಮತ್ತು ಪ್ರದರ್ಶನಗಳನ್ನು ಅನ್ವೇಷಿಸಿ.`,
    keywords: (g) => `${g} ರೇಡಿಯೋ, ${g} ಸಂಗೀತ, ${g} ಸ್ಟೇಷನ್‌ಗಳು, ${g} ನೇರ, ${g} ಆನ್‌ಲೈನ್`,
    h1: (g) => `${g} ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳು — ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ನೇರವಾಗಿ ಆಲಿಸಿ`,
    bodyIntro: (g) => `${g} ರೇಡಿಯೋವನ್ನು ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಉಚಿತವಾಗಿ ನೇರವಾಗಿ ಆಲಿಸಿ. Mega Radio ನಲ್ಲಿ ಅತ್ಯುತ್ತಮ ${g} ಸಂಗೀತ ಸ್ಟೇಷನ್‌ಗಳು ಮತ್ತು ಪ್ರದರ್ಶನಗಳನ್ನು ಅನ್ವೇಷಿಸಿ.`,
    bodyAvailability: (g) => `120+ ದೇಶಗಳಿಂದ 60,000+ ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳನ್ನು ಬ್ರೌಸ್ ಮಾಡಿ — ${g} ಸ್ಟೇಷನ್‌ಗಳು 24/7 ಉಚಿತವಾಗಿ ಲಭ್ಯ.`,
  },
  ml: {
    title: (g) => `${g} റേഡിയോ സ്റ്റേഷനുകൾ - ഓൺലൈനിൽ തത്സമയം കേൾക്കുക | Mega Radio`,
    description: (g) => `${g} റേഡിയോ ഓൺലൈനിൽ സൗജന്യമായി തത്സമയം കേൾക്കുക. Mega Radio-യിൽ മികച്ച ${g} സംഗീത സ്റ്റേഷനുകളും ഷോകളും കണ്ടെത്തുക.`,
    keywords: (g) => `${g} റേഡിയോ, ${g} സംഗീതം, ${g} സ്റ്റേഷനുകൾ, ${g} തത്സമയം, ${g} ഓൺലൈൻ`,
    h1: (g) => `${g} റേഡിയോ സ്റ്റേഷനുകൾ — ഓൺലൈനിൽ തത്സമയം കേൾക്കുക`,
    bodyIntro: (g) => `${g} റേഡിയോ ഓൺലൈനിൽ സൗജന്യമായി തത്സമയം കേൾക്കുക. Mega Radio-യിൽ മികച്ച ${g} സംഗീത സ്റ്റേഷനുകളും ഷോകളും കണ്ടെത്തുക.`,
    bodyAvailability: (g) => `120+ രാജ്യങ്ങളിൽ നിന്നുള്ള 60,000+ റേഡിയോ സ്റ്റേഷനുകൾ ബ്രൗസ് ചെയ്യുക — ${g} സ്റ്റേഷനുകൾ 24/7 സൗജന്യമായി ലഭ്യം.`,
  },
  pa: {
    title: (g) => `${g} ਰੇਡੀਓ ਸਟੇਸ਼ਨ - ਔਨਲਾਈਨ ਲਾਈਵ ਸੁਣੋ | Mega Radio`,
    description: (g) => `${g} ਰੇਡੀਓ ਔਨਲਾਈਨ ਮੁਫ਼ਤ ਵਿੱਚ ਲਾਈਵ ਸੁਣੋ। Mega Radio 'ਤੇ ਸਭ ਤੋਂ ਵਧੀਆ ${g} ਸੰਗੀਤ ਸਟੇਸ਼ਨ ਅਤੇ ਸ਼ੋਅ ਖੋਜੋ।`,
    keywords: (g) => `${g} ਰੇਡੀਓ, ${g} ਸੰਗੀਤ, ${g} ਸਟੇਸ਼ਨ, ${g} ਲਾਈਵ, ${g} ਔਨਲਾਈਨ`,
    h1: (g) => `${g} ਰੇਡੀਓ ਸਟੇਸ਼ਨ — ਔਨਲਾਈਨ ਲਾਈਵ ਸੁਣੋ`,
    bodyIntro: (g) => `${g} ਰੇਡੀਓ ਔਨਲਾਈਨ ਮੁਫ਼ਤ ਵਿੱਚ ਲਾਈਵ ਸੁਣੋ। Mega Radio 'ਤੇ ਸਭ ਤੋਂ ਵਧੀਆ ${g} ਸੰਗੀਤ ਸਟੇਸ਼ਨ ਅਤੇ ਸ਼ੋਅ ਖੋਜੋ।`,
    bodyAvailability: (g) => `120+ ਦੇਸ਼ਾਂ ਦੇ 60,000+ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਬ੍ਰਾਊਜ਼ ਕਰੋ — ${g} ਸਟੇਸ਼ਨ 24/7 ਮੁਫ਼ਤ ਉਪਲਬਧ।`,
  },
  sw: {
    title: (g) => `Vituo vya Redio vya ${g} - Sikiliza Moja kwa Moja Mtandaoni | Mega Radio`,
    description: (g) => `Sikiliza redio ya ${g} moja kwa moja bila malipo. Gundua vituo bora vya muziki na vipindi vya ${g} kwenye Mega Radio.`,
    keywords: (g) => `redio ${g}, muziki ${g}, vituo ${g}, ${g} moja kwa moja, ${g} mtandaoni`,
    h1: (g) => `Vituo vya Redio vya ${g} — Sikiliza Moja kwa Moja Mtandaoni`,
    bodyIntro: (g) => `Sikiliza redio ya ${g} moja kwa moja bila malipo. Gundua vituo bora vya muziki na vipindi vya ${g} kwenye Mega Radio.`,
    bodyAvailability: (g) => `Vinjari vituo vya redio zaidi ya 60,000 kutoka nchi 120+ — vituo vya ${g} vinapatikana 24/7 bila malipo.`,
  },
  am: {
    title: (g) => `${g} የራዲዮ ጣቢያዎች - በቀጥታ በመስመር ላይ ያዳምጡ | Mega Radio`,
    description: (g) => `${g} ራዲዮን በቀጥታ በነፃ ያዳምጡ። በ Mega Radio ላይ ምርጥ የ${g} ሙዚቃ ጣቢያዎችን እና ትዕይንቶችን ያግኙ።`,
    keywords: (g) => `${g} ራዲዮ, ${g} ሙዚቃ, ${g} ጣቢያዎች, ${g} ቀጥታ, ${g} መስመር`,
    h1: (g) => `${g} የራዲዮ ጣቢያዎች — በቀጥታ በመስመር ላይ ያዳምጡ`,
    bodyIntro: (g) => `${g} ራዲዮን በቀጥታ በነፃ ያዳምጡ። በ Mega Radio ላይ ምርጥ የ${g} ሙዚቃ ጣቢያዎችን እና ትዕይንቶችን ያግኙ።`,
    bodyAvailability: (g) => `ከ120+ አገራት 60,000+ የራዲዮ ጣቢያዎችን ይጎብኙ — የ${g} ጣቢያዎች 24/7 በነፃ ይገኛሉ።`,
  },
  zu: {
    title: (g) => `Iziteshi Zomsakazo ze-${g} - Lalela Bukhoma Kwi-Inthanethi | Mega Radio`,
    description: (g) => `Lalela umsakazo we-${g} bukhoma mahhala. Thola iziteshi zomculo nezinhlelo ze-${g} ezingcono kakhulu ku-Mega Radio.`,
    keywords: (g) => `umsakazo we-${g}, umculo we-${g}, iziteshi ze-${g}, ${g} bukhoma, ${g} kwi-inthanethi`,
    h1: (g) => `Iziteshi Zomsakazo ze-${g} — Lalela Bukhoma Kwi-Inthanethi`,
    bodyIntro: (g) => `Lalela umsakazo we-${g} bukhoma mahhala. Thola iziteshi zomculo nezinhlelo ze-${g} ezingcono kakhulu ku-Mega Radio.`,
    bodyAvailability: (g) => `Phequlula iziteshi zomsakazo ezingu-60,000+ ezivela emazweni angu-120+ — iziteshi ze-${g} ziyatholakala 24/7 mahhala.`,
  },
  af: {
    title: (g) => `${g} Radiostasies - Luister Regstreeks Aanlyn | Mega Radio`,
    description: (g) => `Luister gratis regstreeks na ${g}-radio. Ontdek die beste ${g}-musiekstasies en -programme op Mega Radio.`,
    keywords: (g) => `${g} radio, ${g} musiek, ${g} stasies, ${g} regstreeks, ${g} aanlyn`,
    h1: (g) => `${g} Radiostasies — Luister Regstreeks Aanlyn`,
    bodyIntro: (g) => `Luister gratis regstreeks na ${g}-radio. Ontdek die beste ${g}-musiekstasies en -programme op Mega Radio.`,
    bodyAvailability: (g) => `Blaai deur 60 000+ radiostasies uit 120+ lande — ${g}-stasies 24/7 gratis beskikbaar.`,
  },
  sq: {
    title: (g) => `Stacione Radio ${g} - Dëgjo Drejtpërdrejt Online | Mega Radio`,
    description: (g) => `Dëgjo radio ${g} drejtpërdrejt dhe falas. Zbulo stacionet dhe programet më të mira të muzikës ${g} në Mega Radio.`,
    keywords: (g) => `radio ${g}, muzikë ${g}, stacione ${g}, ${g} drejtpërdrejt, ${g} online`,
    h1: (g) => `Stacione Radio ${g} — Dëgjo Drejtpërdrejt Online`,
    bodyIntro: (g) => `Dëgjo radio ${g} drejtpërdrejt dhe falas. Zbulo stacionet dhe programet më të mira të muzikës ${g} në Mega Radio.`,
    bodyAvailability: (g) => `Shfleto mbi 60.000 stacione radio nga 120+ vende — stacionet ${g} të disponueshme 24/7 falas.`,
  },
  az: {
    title: (g) => `${g} Radio Stansiyaları - Onlayn Canlı Dinləyin | Mega Radio`,
    description: (g) => `${g} radiosunu canlı və pulsuz dinləyin. Mega Radio-da ən yaxşı ${g} musiqi stansiyalarını və verilişlərini kəşf edin.`,
    keywords: (g) => `${g} radio, ${g} musiqi, ${g} stansiyalar, ${g} canlı, ${g} onlayn`,
    h1: (g) => `${g} Radio Stansiyaları — Onlayn Canlı Dinləyin`,
    bodyIntro: (g) => `${g} radiosunu canlı və pulsuz dinləyin. Mega Radio-da ən yaxşı ${g} musiqi stansiyalarını və verilişlərini kəşf edin.`,
    bodyAvailability: (g) => `120+ ölkədən 60.000+ radio stansiyasına baxın — ${g} stansiyaları 24/7 pulsuz mövcuddur.`,
  },
  hy: {
    title: (g) => `${g} Ռադիոկայաններ - Ուղիղ Եթերում Առցանց Լսել | Mega Radio`,
    description: (g) => `Լսեք ${g} ռադիոն ուղիղ եթերում անվճար։ Բացահայտեք լավագույն ${g} երաժշտական կայաններն ու հաղորդումները Mega Radio-ում։`,
    keywords: (g) => `${g} ռադիո, ${g} երաժշտություն, ${g} կայաններ, ${g} ուղիղ, ${g} առցանց`,
    h1: (g) => `${g} Ռադիոկայաններ — Ուղիղ Եթերում Առցանց Լսել`,
    bodyIntro: (g) => `Լսեք ${g} ռադիոն ուղիղ եթերում անվճար։ Բացահայտեք լավագույն ${g} երաժշտական կայաններն ու հաղորդումները Mega Radio-ում։`,
    bodyAvailability: (g) => `Թերթեք 60,000+ ռադիոկայան 120+ երկրներից — ${g} կայանները հասանելի են 24/7 անվճար։`,
  },
  so: {
    title: (g) => `Idaacadaha Raadiyaha ${g} - Dhageyso Toos ah Onleen | Mega Radio`,
    description: (g) => `Dhageyso raadiyaha ${g} toos ah oo bilaash ah. Ka hel idaacadaha iyo barnaamijyada muusiga ${g} ee ugu fiican Mega Radio.`,
    keywords: (g) => `raadiyaha ${g}, muusiga ${g}, idaacadaha ${g}, ${g} toos, ${g} onleen`,
    h1: (g) => `Idaacadaha Raadiyaha ${g} — Dhageyso Toos ah Onleen`,
    bodyIntro: (g) => `Dhageyso raadiyaha ${g} toos ah oo bilaash ah. Ka hel idaacadaha iyo barnaamijyada muusiga ${g} ee ugu fiican Mega Radio.`,
    bodyAvailability: (g) => `Daalaco in ka badan 60,000 idaacadood oo raadiyo ah oo ka socda 120+ dal — idaacadaha ${g} ayaa la heli karaa 24/7 bilaash.`,
  },
  uk: {
    title: (g) => `${g} Радіостанції - Слухайте Наживо Онлайн | Mega Radio`,
    description: (g) => `Слухайте ${g} радіо наживо й безкоштовно. Відкрийте найкращі ${g} музичні станції та шоу на Mega Radio.`,
    keywords: (g) => `${g} радіо, ${g} музика, ${g} станції, ${g} наживо, ${g} онлайн`,
    h1: (g) => `${g} Радіостанції — Слухайте Наживо Онлайн`,
    bodyIntro: (g) => `Слухайте ${g} радіо наживо й безкоштовно. Відкрийте найкращі ${g} музичні станції та шоу на Mega Radio.`,
    bodyAvailability: (g) => `Перегляньте понад 60 000 радіостанцій із 120+ країн — ${g} станції доступні 24/7 безкоштовно.`,
  },
  bs: {
    title: (g) => `Radio Stanice ${g} - Slušajte Uživo Online | Mega Radio`,
    description: (g) => `Slušajte ${g} radio uživo i besplatno. Otkrijte najbolje ${g} muzičke stanice i emisije na Mega Radiju.`,
    keywords: (g) => `${g} radio, ${g} muzika, ${g} stanice, ${g} uživo, ${g} online`,
    h1: (g) => `Radio Stanice ${g} — Slušajte Uživo Online`,
    bodyIntro: (g) => `Slušajte ${g} radio uživo i besplatno. Otkrijte najbolje ${g} muzičke stanice i emisije na Mega Radiju.`,
    bodyAvailability: (g) => `Pretražujte preko 60.000 radio stanica iz 120+ zemalja — ${g} stanice dostupne 24/7 besplatno.`,
  },
};

/**
 * Returns a multilingual SEO template for the requested language, falling back to English.
 */
export function getGenreSeoTemplate(language: string): GenreSeoTemplate {
  return GENRE_SEO_TEMPLATES[language] || GENRE_SEO_TEMPLATES.en;
}

/**
 * Grapheme-aware truncation. Uses Intl.Segmenter when available (Node 16+, all modern browsers)
 * so Arabic combining marks, emoji ZWJ sequences, and surrogate pairs are not split mid-cluster.
 * Falls back to code-point iteration via `Array.from()` if Intl.Segmenter is unavailable.
 *
 * `maxChars` is interpreted as max UTF-16 code units in the output to match the caller's 145-cap
 * accounting; the function stops adding clusters once the next one would exceed `maxChars`.
 */
function clampGraphemes(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let out = '';
  if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
    const seg = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment } of seg.segment(text)) {
      if (out.length + segment.length > maxChars) break;
      out += segment;
    }
  } else {
    for (const ch of Array.from(text)) {
      if (out.length + ch.length > maxChars) break;
      out += ch;
    }
  }
  return out;
}

/**
 * Builds title/description/keywords for a genre detail page in the given language.
 * If `dbTranslations` provides any of the legacy SEO keys IN THE REQUESTED LANGUAGE,
 * they win — but the description stays in the chosen language (no English-template padding).
 *
 * Defensive: enforces a 145-character maximum description length.
 */
export function buildGenreSeo(
  genreName: string,
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string; keywords: string; h1: string; bodyIntro: string; bodyAvailability: string } {
  const tpl = getGenreSeoTemplate(language);

  // DB override path — only use it when ALL three legacy keys are filled in the requested
  // language; otherwise we'd mix English fragments into a Turkish/German sentence.
  const radioStations = dbTranslations?.seo_radio_stations?.trim();
  const listenLive = dbTranslations?.seo_listen_live_online?.trim();
  const listenFrom = dbTranslations?.seo_listen_to_live_radio_from?.trim();
  const discoverLocal = dbTranslations?.seo_discover_local?.trim();
  const musicAndShows = dbTranslations?.seo_music_and_shows?.trim();

  const title =
    radioStations && listenLive
      ? `${genreName} ${radioStations} - ${listenLive} | Mega Radio`
      : tpl.title(genreName);

  let description =
    listenFrom && discoverLocal && musicAndShows
      ? `${listenFrom} ${genreName}. ${discoverLocal} ${genreName} ${musicAndShows}.`
      : tpl.description(genreName);

  // Defensive 145-char clamp at word boundary (matches shared/seo-config.ts truncateAtWordBoundary policy).
  // Grapheme-safe so Arabic combining marks, surrogate pairs, and CJK extension chars are not split.
  if (description.length > 145) {
    const cutoff = description.lastIndexOf(' ', 142);
    if (cutoff > 100) {
      description = description.slice(0, cutoff) + '...';
    } else {
      description = clampGraphemes(description, 142) + '...';
    }
  }

  const keywords = tpl.keywords(genreName);
  const h1 = tpl.h1(genreName);
  const bodyIntro = tpl.bodyIntro(genreName);
  const bodyAvailability = tpl.bodyAvailability(genreName);

  return { title, description, keywords, h1, bodyIntro, bodyAvailability };
}
