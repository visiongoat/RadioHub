/**
 * Multilingual SEO templates for the search results page (e.g. /de/search?q=jazz,
 * /th/search?q=rock).
 *
 * Each language entry returns a natural, idiomatic title/description/keywords/H1/body
 * for the static search landing copy. Falls back to English when the language is not
 * yet covered.
 *
 * NOTE: Used by server/seo-renderer.ts in the `pageType === 'search'` branch
 * (title/description) AND in the search SSR body branch (H1 + intro).
 *
 * Database translation keys (`search_page_title`, `search_page_description`,
 * `search_page_h1`, `search_page_intro`) take precedence when present in the
 * requested language — otherwise we'd serve a Turkish page with an English
 * `<title>`. Without per-language templates, every non-top-15 language served
 * the SAME English title and description across /xx/search, which Google
 * collapsed as duplicates the same way it did for regions and genres before
 * those were localised.
 *
 * Search pages are `noindex, follow` so they aren't indexed, but localized copy
 * still matters for users who land on the page from in-app navigation and for
 * preventing duplicate-content signal accumulation across crawled-but-not-
 * indexed URLs.
 *
 * Shape mirrors REGION_SEO_TEMPLATES and GENRE_SEO_TEMPLATES (Record<lang, T>),
 * but since the search page takes no name/parameter the entries are plain
 * strings rather than functions of a name.
 */

export interface SearchSeoTemplate {
  title: string;
  description: string;
  keywords: string;
  h1: string;
  bodyIntro: string;
}

// All 57 supported languages — natural, locale-aware phrasing.
// Any language not present here falls back to English.
export const SEARCH_SEO_TEMPLATES: Record<string, SearchSeoTemplate> = {
  en: {
    title: 'Search Radio Stations — Find Live Radio by Name, Genre or Country | Mega Radio',
    description: 'Search 60,000+ live radio stations from 120+ countries on Mega Radio. Find stations by name, genre, language, or country and listen free.',
    keywords: 'search radio, find radio stations, online radio search, live radio finder, radio station lookup',
    h1: 'Search Live Radio Stations',
    bodyIntro: "Search Mega Radio's catalogue of 60,000+ live radio stations from 120+ countries. Type a station name, music genre, language, or country to start streaming free online radio instantly.",
  },
  tr: {
    title: 'Radyo İstasyonu Ara — Ad, Tür veya Ülkeye Göre Canlı Radyo Bul | Mega Radio',
    description: '120+ ülkeden 60.000+ canlı radyo istasyonunu Mega Radio\'da arayın. Favori istasyonunuzu ad, tür, dil veya ülkeye göre bulun, ücretsiz dinleyin.',
    keywords: 'radyo ara, radyo istasyonu bul, online radyo arama, canlı radyo arama, istasyon bul',
    h1: 'Canlı Radyo İstasyonu Ara',
    bodyIntro: "Mega Radio'nun 120+ ülkeden 60.000'i aşkın canlı radyo istasyonu kataloğunda arama yapın. İstasyon adı, müzik türü, dil veya ülke yazarak ücretsiz online radyo dinlemeye anında başlayın.",
  },
  es: {
    title: 'Buscar Emisoras de Radio — Encuentra Radio en Vivo por Nombre, Género o País | Mega Radio',
    description: 'Busca entre 60.000+ emisoras en vivo de 120+ países en Mega Radio. Encuentra tu emisora por nombre, género, idioma o país y escucha gratis.',
    keywords: 'buscar radio, encontrar emisoras, búsqueda de radio online, buscador de radio en vivo, localizar emisoras',
    h1: 'Buscar Emisoras de Radio en Vivo',
    bodyIntro: 'Busca en el catálogo de Mega Radio: más de 60.000 emisoras en vivo de más de 120 países. Escribe el nombre de una emisora, género musical, idioma o país y empieza a escuchar radio gratis al instante.',
  },
  fr: {
    title: 'Rechercher des Stations Radio — Trouvez la Radio en Direct par Nom, Genre ou Pays | Mega Radio',
    description: 'Recherchez parmi 60 000+ stations radio en direct de 120+ pays sur Mega Radio. Trouvez votre station par nom, genre, langue ou pays.',
    keywords: 'rechercher radio, trouver stations radio, recherche radio en ligne, moteur de recherche radio, localiser stations',
    h1: 'Rechercher des Stations Radio en Direct',
    bodyIntro: 'Explorez le catalogue Mega Radio : plus de 60 000 stations radio en direct de plus de 120 pays. Tapez un nom de station, un genre musical, une langue ou un pays pour écouter la radio en ligne gratuitement, instantanément.',
  },
  de: {
    title: 'Radiosender suchen — Live-Radio nach Name, Genre oder Land finden | Mega Radio',
    description: 'Durchsuche 60.000+ Live-Radiosender aus 120+ Ländern auf Mega Radio. Finde deinen Sender nach Name, Genre, Sprache oder Land — kostenlos.',
    keywords: 'Radio suchen, Sender finden, Online-Radio-Suche, Live-Radio-Finder, Radiosender Suche',
    h1: 'Live-Radiosender suchen',
    bodyIntro: 'Durchsuche den Katalog von Mega Radio mit über 60.000 Live-Radiosendern aus mehr als 120 Ländern. Gib einen Sendernamen, ein Musikgenre, eine Sprache oder ein Land ein und starte sofort kostenloses Online-Radio.',
  },
  ar: {
    title: 'بحث عن محطات الراديو — اعثر على الراديو المباشر بالاسم أو النوع أو البلد | Mega Radio',
    description: 'ابحث في أكثر من 60,000 محطة راديو مباشرة من 120+ دولة على Mega Radio. اعثر على محطتك بالاسم أو النوع أو اللغة أو البلد مجانًا.',
    keywords: 'بحث راديو, اعثر على محطات الراديو, بحث راديو أونلاين, البحث عن محطة, راديو مباشر',
    h1: 'البحث عن محطات الراديو المباشرة',
    bodyIntro: 'ابحث في كتالوج Mega Radio الذي يضم أكثر من 60,000 محطة راديو مباشرة من أكثر من 120 دولة. اكتب اسم محطة أو نوعًا موسيقيًا أو لغة أو بلدًا وابدأ الاستماع إلى الراديو عبر الإنترنت مجانًا على الفور.',
  },
  it: {
    title: 'Cerca Stazioni Radio — Trova Radio in Diretta per Nome, Genere o Paese | Mega Radio',
    description: 'Cerca tra oltre 60.000 stazioni radio in diretta da 120+ paesi su Mega Radio. Trova la tua stazione per nome, genere, lingua o paese.',
    keywords: 'cerca radio, trovare stazioni radio, ricerca radio online, cercatore radio in diretta, localizza stazioni',
    h1: 'Cerca Stazioni Radio in Diretta',
    bodyIntro: "Esplora il catalogo di Mega Radio con oltre 60.000 stazioni radio in diretta da più di 120 paesi. Digita il nome di una stazione, un genere musicale, una lingua o un paese per ascoltare radio online gratis all'istante.",
  },
  pt: {
    title: 'Procurar Rádios — Encontre Rádio Ao Vivo por Nome, Género ou País | Mega Radio',
    description: 'Procure entre 60.000+ rádios ao vivo de 120+ países na Mega Radio. Encontre a sua rádio por nome, género, idioma ou país e ouça grátis.',
    keywords: 'procurar rádio, encontrar estações de rádio, pesquisa de rádio online, procurar rádio ao vivo, localizar estações',
    h1: 'Procurar Rádios Ao Vivo',
    bodyIntro: 'Explore o catálogo da Mega Radio com mais de 60.000 rádios ao vivo de mais de 120 países. Escreva o nome de uma estação, género musical, idioma ou país e comece a ouvir rádio online grátis instantaneamente.',
  },
  nl: {
    title: 'Radiostations zoeken — Vind live radio op naam, genre of land | Mega Radio',
    description: 'Doorzoek 60.000+ live radiostations uit 120+ landen op Mega Radio. Vind je station op naam, genre, taal of land en luister gratis online.',
    keywords: 'radio zoeken, radiostations vinden, online radio zoeken, live radio zoeker, station opzoeken',
    h1: 'Live radiostations zoeken',
    bodyIntro: 'Doorzoek de catalogus van Mega Radio met meer dan 60.000 live radiostations uit meer dan 120 landen. Typ een stationsnaam, muziekgenre, taal of land en begin direct met gratis online radio luisteren.',
  },
  ru: {
    title: 'Поиск радиостанций — Найдите прямой эфир по названию, жанру или стране | Mega Radio',
    description: 'Ищите среди 60 000+ прямых радиостанций из 120+ стран на Mega Radio. Найдите станцию по названию, жанру, языку или стране и слушайте бесплатно.',
    keywords: 'поиск радио, найти радиостанции, поиск онлайн-радио, поиск прямого эфира, найти станцию',
    h1: 'Поиск радиостанций в прямом эфире',
    bodyIntro: 'Ищите в каталоге Mega Radio: более 60 000 радиостанций в прямом эфире из более чем 120 стран. Введите название станции, музыкальный жанр, язык или страну и начните слушать онлайн-радио бесплатно мгновенно.',
  },
  pl: {
    title: 'Wyszukaj stacje radiowe — Znajdź radio na żywo po nazwie, gatunku lub kraju | Mega Radio',
    description: 'Przeszukaj 60 000+ stacji radiowych na żywo ze 120+ krajów w Mega Radio. Znajdź stację po nazwie, gatunku, języku lub kraju i słuchaj.',
    keywords: 'szukaj radio, znajdź stacje radiowe, wyszukiwanie radia online, wyszukiwarka radia na żywo, stacje radiowe',
    h1: 'Wyszukaj stacje radiowe na żywo',
    bodyIntro: 'Przeszukaj katalog Mega Radio: ponad 60 000 stacji radiowych na żywo ze 120+ krajów. Wpisz nazwę stacji, gatunek muzyczny, język lub kraj i zacznij słuchać darmowego radia online od razu.',
  },
  sv: {
    title: 'Sök radiostationer — Hitta liveradio efter namn, genre eller land | Mega Radio',
    description: 'Sök bland 60 000+ liveradiostationer från 120+ länder på Mega Radio. Hitta din station via namn, genre, språk eller land och lyssna gratis.',
    keywords: 'sök radio, hitta radiostationer, online radiosökning, liveradio sökare, radiokanaler',
    h1: 'Sök liveradiostationer',
    bodyIntro: 'Sök i Mega Radios katalog med över 60 000 liveradiostationer från fler än 120 länder. Skriv ett stationsnamn, musikgenre, språk eller land och börja lyssna på gratis onlineradio direkt.',
  },
  da: {
    title: 'Søg radiostationer — Find live radio efter navn, genre eller land | Mega Radio',
    description: 'Søg blandt 60.000+ live radiostationer fra 120+ lande på Mega Radio. Find din favoritstation via navn, genre, sprog eller land og lyt gratis.',
    keywords: 'søg radio, find radiostationer, online radiosøgning, live radio finder, radiokanaler',
    h1: 'Søg live radiostationer',
    bodyIntro: 'Søg i Mega Radios katalog med over 60.000 live radiostationer fra mere end 120 lande. Skriv et stationsnavn, en musikgenre, et sprog eller et land og begynd at lytte til gratis onlineradio med det samme.',
  },
  no: {
    title: 'Søk radiostasjoner — Finn live radio etter navn, sjanger eller land | Mega Radio',
    description: 'Søk blant 60 000+ live radiostasjoner fra 120+ land på Mega Radio. Finn favorittstasjonen din via navn, sjanger, språk eller land og lytt gratis.',
    keywords: 'søk radio, finn radiostasjoner, online radiosøk, live radio finner, radiokanaler',
    h1: 'Søk live radiostasjoner',
    bodyIntro: 'Søk i Mega Radios katalog med over 60 000 live radiostasjoner fra mer enn 120 land. Skriv et stasjonsnavn, musikksjanger, språk eller land og begynn å høre på gratis nettradio umiddelbart.',
  },
  fi: {
    title: 'Etsi radioasemia — Löydä suora radio nimellä, genrellä tai maalla | Mega Radio',
    description: 'Etsi yli 60 000 suoraa radioasemaa yli 120 maasta Mega Radiosta. Löydä asemasi nimen, genren, kielen tai maan perusteella ja kuuntele ilmaiseksi.',
    keywords: 'etsi radio, löydä radioasemia, online-radion haku, suoran radion haku, radiokanavat',
    h1: 'Etsi suoria radioasemia',
    bodyIntro: 'Etsi Mega Radion luettelosta yli 60 000 suoraa radioasemaa yli 120 maasta. Kirjoita aseman nimi, musiikkigenre, kieli tai maa ja aloita ilmainen verkkoradion kuuntelu välittömästi.',
  },
  el: {
    title: 'Αναζήτηση Ραδιοφωνικών Σταθμών — Βρείτε Ζωντανό Ραδιόφωνο | Mega Radio',
    description: 'Αναζητήστε 60.000+ ζωντανούς ραδιοφωνικούς σταθμούς από 120+ χώρες στο Mega Radio. Βρείτε σταθμό ανά όνομα, είδος, γλώσσα ή χώρα.',
    keywords: 'αναζήτηση ραδιοφώνου, βρείτε ραδιοφωνικούς σταθμούς, online αναζήτηση ραδιοφώνου, ζωντανό ραδιόφωνο',
    h1: 'Αναζήτηση Ζωντανών Ραδιοφωνικών Σταθμών',
    bodyIntro: 'Αναζητήστε στον κατάλογο του Mega Radio με 60.000+ ζωντανούς ραδιοφωνικούς σταθμούς από 120+ χώρες. Πληκτρολογήστε όνομα σταθμού, μουσικό είδος, γλώσσα ή χώρα και ακούστε δωρεάν online ραδιόφωνο άμεσα.',
  },
  hu: {
    title: 'Rádióállomások keresése — Élő rádió név, műfaj vagy ország szerint | Mega Radio',
    description: 'Keress 60 000+ élő rádióállomás között 120+ országból a Mega Radio-n. Találd meg az állomást név, műfaj, nyelv vagy ország szerint.',
    keywords: 'rádió keresés, rádióállomások keresése, online rádió kereső, élő rádió kereső, rádió csatornák',
    h1: 'Élő rádióállomások keresése',
    bodyIntro: 'Keress a Mega Radio katalógusában: több mint 60 000 élő rádióállomás 120+ országból. Írj be egy állomásnevet, zenei műfajt, nyelvet vagy országot és kezdj el azonnal ingyenes online rádiót hallgatni.',
  },
  cs: {
    title: 'Hledat rozhlasové stanice — Najděte živé rádio podle názvu, žánru nebo země | Mega Radio',
    description: 'Prohledejte 60 000+ živých rozhlasových stanic ze 120+ zemí na Mega Radio. Najděte stanici podle názvu, žánru, jazyka nebo země zdarma.',
    keywords: 'hledat rádio, najít stanice, online vyhledávání rádia, živé rádio, vyhledávač stanic',
    h1: 'Hledat živé rozhlasové stanice',
    bodyIntro: 'Prohledejte katalog Mega Radio s více než 60 000 živými rozhlasovými stanicemi z více než 120 zemí. Zadejte název stanice, hudební žánr, jazyk nebo zemi a začněte ihned poslouchat online rádio zdarma.',
  },
  sk: {
    title: 'Hľadať rozhlasové stanice — Nájdite živé rádio podľa názvu, žánru alebo krajiny | Mega Radio',
    description: 'Prehľadajte 60 000+ živých staníc zo 120+ krajín na Mega Radio. Nájdite stanicu podľa názvu, žánru, jazyka alebo krajiny a počúvajte zadarmo.',
    keywords: 'hľadať rádio, nájsť stanice, online vyhľadávanie rádia, živé rádio, vyhľadávač staníc',
    h1: 'Hľadať živé rozhlasové stanice',
    bodyIntro: 'Prehľadajte katalóg Mega Radio s viac ako 60 000 živými rozhlasovými stanicami z viac ako 120 krajín. Zadajte názov stanice, hudobný žáner, jazyk alebo krajinu a začnite okamžite počúvať online rádio zadarmo.',
  },
  ro: {
    title: 'Caută posturi radio — Găsește radio live după nume, gen sau țară | Mega Radio',
    description: 'Caută printre 60.000+ posturi radio live din 120+ țări pe Mega Radio. Găsește postul tău după nume, gen, limbă sau țară și ascultă gratuit.',
    keywords: 'caută radio, găsește posturi radio, căutare radio online, motor căutare radio live, posturi radio',
    h1: 'Caută posturi radio live',
    bodyIntro: 'Caută în catalogul Mega Radio cu peste 60.000 de posturi radio live din peste 120 de țări. Tastează un nume de post, gen muzical, limbă sau țară și începe să asculți radio online gratuit instantaneu.',
  },
  bg: {
    title: 'Търсене на радиостанции — Намерете радио на живо | Mega Radio',
    description: 'Търсете сред 60 000+ радиостанции на живо от 120+ страни в Mega Radio. Намерете станция по име, жанр, език или страна — безплатно.',
    keywords: 'търсене радио, намери радиостанции, онлайн търсене на радио, радио на живо, радио станции',
    h1: 'Търсене на радиостанции на живо',
    bodyIntro: 'Търсете в каталога на Mega Radio с над 60 000 радиостанции на живо от над 120 страни. Въведете име на станция, музикален жанр, език или страна и започнете да слушате безплатно онлайн радио веднага.',
  },
  hr: {
    title: 'Pretraži radio stanice — Pronađi radio uživo po imenu, žanru ili državi | Mega Radio',
    description: 'Pretražite 60.000+ radio stanica uživo iz 120+ država na Mega Radiju. Pronađite stanicu po imenu, žanru, jeziku ili državi i slušajte besplatno.',
    keywords: 'pretraga radija, pronađi radio stanice, online pretraga radija, radio uživo, traženje stanica',
    h1: 'Pretraži radio stanice uživo',
    bodyIntro: 'Pretražujte katalog Mega Radija s više od 60.000 radio stanica uživo iz više od 120 država. Upišite ime stanice, glazbeni žanr, jezik ili državu i odmah počnite slušati besplatni online radio.',
  },
  sr: {
    title: 'Претрага радио станица — Пронађите радио уживо по имену, жанру или држави | Mega Radio',
    description: 'Претражите 60.000+ радио станица уживо из 120+ држава на Mega Radio. Пронађите станицу по имену, жанру, језику или држави и слушајте бесплатно.',
    keywords: 'претрага радија, пронађи радио станице, онлајн претрага радија, радио уживо, тражење станица',
    h1: 'Претрага радио станица уживо',
    bodyIntro: 'Претражујте каталог Mega Radio са преко 60.000 радио станица уживо из преко 120 држава. Унесите име станице, музички жанр, језик или државу и одмах почните да слушате бесплатан онлајн радио.',
  },
  sl: {
    title: 'Iskanje radijskih postaj — Najdi radio v živo po imenu, žanru ali državi | Mega Radio',
    description: 'Preiščite 60.000+ radijskih postaj v živo iz 120+ držav na Mega Radio. Najdite postajo po imenu, žanru, jeziku ali državi brezplačno.',
    keywords: 'iskanje radia, najdi radijske postaje, spletno iskanje radia, radio v živo, iskalnik postaj',
    h1: 'Iskanje radijskih postaj v živo',
    bodyIntro: 'Preiščite katalog Mega Radia z več kot 60.000 radijskimi postajami v živo iz več kot 120 držav. Vnesite ime postaje, glasbeni žanr, jezik ali državo in takoj začnite poslušati brezplačni spletni radio.',
  },
  lv: {
    title: 'Meklēt radio stacijas — Atrodi tiešraides radio | Mega Radio',
    description: 'Meklē 60 000+ tiešraides radio staciju no 120+ valstīm Mega Radio. Atrodi staciju pēc nosaukuma, žanra, valodas vai valsts bezmaksas.',
    keywords: 'meklēt radio, atrast radio stacijas, tiešsaistes radio meklēšana, tiešraides radio, radio kanāli',
    h1: 'Meklēt tiešraides radio stacijas',
    bodyIntro: 'Meklē Mega Radio katalogā ar vairāk nekā 60 000 tiešraides radio staciju no vairāk nekā 120 valstīm. Ieraksti stacijas nosaukumu, mūzikas žanru, valodu vai valsti un sāc klausīties bezmaksas tiešsaistes radio uzreiz.',
  },
  lt: {
    title: 'Ieškoti radijo stočių — Rask tiesioginį radiją | Mega Radio',
    description: 'Ieškokite 60 000+ tiesioginių radijo stočių iš 120+ šalių Mega Radio. Raskite stotį pagal pavadinimą, žanrą, kalbą ar šalį nemokamai.',
    keywords: 'ieškoti radijo, rasti radijo stotis, internetinė radijo paieška, tiesioginis radijas, radijo stotys',
    h1: 'Ieškoti tiesioginių radijo stočių',
    bodyIntro: 'Ieškokite Mega Radio kataloge su daugiau nei 60 000 tiesioginių radijo stočių iš daugiau nei 120 šalių. Įveskite stoties pavadinimą, muzikos žanrą, kalbą ar šalį ir iš karto pradėkite klausytis nemokamo internetinio radijo.',
  },
  et: {
    title: 'Otsi raadiojaamu — Leia otseülekanne nime, žanri või riigi järgi | Mega Radio',
    description: 'Otsi 60 000+ otseülekande raadiojaama hulgast 120+ riigist Mega Radios. Leia oma jaam nime, žanri, keele või riigi järgi ja kuula tasuta.',
    keywords: 'otsi raadiot, leia raadiojaamu, veebipõhine raadiootsing, otseülekanne raadio, raadiokanalid',
    h1: 'Otsi otseülekande raadiojaamu',
    bodyIntro: 'Otsi Mega Radio kataloogist üle 60 000 otseülekande raadiojaama enam kui 120 riigist. Sisesta jaama nimi, muusikažanr, keel või riik ja alusta kohe tasuta veebiraadio kuulamist.',
  },
  zh: {
    title: '搜索电台 — 按名称、流派或国家/地区查找直播电台 | Mega Radio',
    description: '在 Mega Radio 上搜索来自 120+ 个国家/地区的 60,000+ 个直播电台。按名称、流派、语言或国家/地区查找您喜爱的电台并免费收听。',
    keywords: '搜索电台, 查找电台, 在线电台搜索, 直播电台查找, 电台搜索',
    h1: '搜索直播电台',
    bodyIntro: '在 Mega Radio 的目录中搜索来自 120 多个国家/地区的 60,000 多个直播电台。输入电台名称、音乐流派、语言或国家/地区，立即开始免费在线收听电台。',
  },
  ja: {
    title: 'ラジオ局を検索 — 名前、ジャンル、国でライブラジオを見つける | Mega Radio',
    description: 'Mega Radio で 120 以上の国の 60,000 以上のライブラジオ局を検索。名前、ジャンル、言語、国でお気に入りの局を見つけて無料で聴けます。',
    keywords: 'ラジオ検索, ラジオ局を探す, オンラインラジオ検索, ライブラジオファインダー, ラジオ局検索',
    h1: 'ライブラジオ局を検索',
    bodyIntro: 'Mega Radio のカタログから、120 以上の国の 60,000 以上のライブラジオ局を検索しましょう。局名、音楽ジャンル、言語、国を入力して、無料のオンラインラジオを今すぐ聴き始めましょう。',
  },
  ko: {
    title: '라디오 방송국 검색 — 이름, 장르 또는 국가별로 라이브 라디오 찾기 | Mega Radio',
    description: 'Mega Radio에서 120개 이상 국가의 60,000개 이상의 라이브 라디오 방송국을 검색하세요. 이름, 장르, 언어, 국가별로 방송국을 찾아 무료로 들으세요.',
    keywords: '라디오 검색, 라디오 방송국 찾기, 온라인 라디오 검색, 라이브 라디오 검색기, 방송국 검색',
    h1: '라이브 라디오 방송국 검색',
    bodyIntro: 'Mega Radio 카탈로그에서 120개 이상 국가의 60,000개 이상의 라이브 라디오 방송국을 검색하세요. 방송국 이름, 음악 장르, 언어 또는 국가를 입력하면 무료 온라인 라디오를 즉시 들을 수 있습니다.',
  },
  hi: {
    title: 'रेडियो स्टेशन खोजें — नाम, शैली या देश के अनुसार लाइव रेडियो खोजें | Mega Radio',
    description: 'Mega Radio पर 120+ देशों के 60,000+ लाइव रेडियो स्टेशन खोजें। नाम, शैली, भाषा या देश के अनुसार अपना स्टेशन खोजें और मुफ्त सुनें।',
    keywords: 'रेडियो खोज, रेडियो स्टेशन खोजें, ऑनलाइन रेडियो खोज, लाइव रेडियो फाइंडर, स्टेशन खोज',
    h1: 'लाइव रेडियो स्टेशन खोजें',
    bodyIntro: 'Mega Radio की कैटलॉग में 120 से अधिक देशों के 60,000 से अधिक लाइव रेडियो स्टेशन खोजें। स्टेशन का नाम, संगीत शैली, भाषा या देश टाइप करें और तुरंत मुफ्त ऑनलाइन रेडियो सुनना शुरू करें।',
  },
  th: {
    title: 'ค้นหาสถานีวิทยุ — ค้นหาวิทยุสดตามชื่อ ประเภท หรือประเทศ | Mega Radio',
    description: 'ค้นหาสถานีวิทยุสดกว่า 60,000 สถานีจาก 120+ ประเทศบน Mega Radio ค้นหาสถานีที่คุณชื่นชอบตามชื่อ ประเภท ภาษา หรือประเทศและฟังฟรี',
    keywords: 'ค้นหาวิทยุ, ค้นหาสถานีวิทยุ, ค้นหาวิทยุออนไลน์, ค้นหาวิทยุสด, สถานีวิทยุ',
    h1: 'ค้นหาสถานีวิทยุสด',
    bodyIntro: 'ค้นหาในแคตตาล็อกของ Mega Radio ที่มีสถานีวิทยุสดมากกว่า 60,000 สถานีจากกว่า 120 ประเทศ พิมพ์ชื่อสถานี ประเภทเพลง ภาษา หรือประเทศเพื่อเริ่มฟังวิทยุออนไลน์ฟรีทันที',
  },
  vi: {
    title: 'Tìm kiếm đài phát thanh — Tìm radio trực tiếp theo tên, thể loại hoặc quốc gia | Mega Radio',
    description: 'Tìm trong 60.000+ đài phát thanh trực tiếp từ 120+ quốc gia trên Mega Radio. Tìm đài theo tên, thể loại, ngôn ngữ hoặc quốc gia miễn phí.',
    keywords: 'tìm radio, tìm đài phát thanh, tìm kiếm radio online, tìm radio trực tiếp, đài phát thanh',
    h1: 'Tìm kiếm đài phát thanh trực tiếp',
    bodyIntro: 'Tìm kiếm trong danh mục của Mega Radio với hơn 60.000 đài phát thanh trực tiếp từ hơn 120 quốc gia. Nhập tên đài, thể loại nhạc, ngôn ngữ hoặc quốc gia và bắt đầu nghe radio trực tuyến miễn phí ngay lập tức.',
  },
  id: {
    title: 'Cari stasiun radio — Temukan radio langsung berdasarkan nama, genre, atau negara | Mega Radio',
    description: 'Cari di antara 60.000+ stasiun radio langsung dari 120+ negara di Mega Radio. Temukan stasiun favorit berdasarkan nama, genre atau negara.',
    keywords: 'cari radio, temukan stasiun radio, pencarian radio online, pencari radio langsung, stasiun radio',
    h1: 'Cari stasiun radio langsung',
    bodyIntro: 'Cari di katalog Mega Radio dengan lebih dari 60.000 stasiun radio langsung dari lebih dari 120 negara. Ketik nama stasiun, genre musik, bahasa, atau negara dan mulailah mendengarkan radio online gratis seketika.',
  },
  ms: {
    title: 'Cari stesen radio — Cari radio langsung mengikut nama, genre atau negara | Mega Radio',
    description: 'Cari antara 60,000+ stesen radio langsung dari 120+ negara di Mega Radio. Cari stesen mengikut nama, genre, bahasa atau negara — percuma.',
    keywords: 'cari radio, cari stesen radio, carian radio dalam talian, pencari radio langsung, stesen radio',
    h1: 'Cari stesen radio langsung',
    bodyIntro: 'Cari dalam katalog Mega Radio dengan lebih 60,000 stesen radio langsung dari lebih 120 negara. Taip nama stesen, genre muzik, bahasa atau negara dan mula mendengar radio dalam talian percuma serta-merta.',
  },
  tl: {
    title: 'Maghanap ng mga istasyon ng radyo — Hanapin ang live na radyo | Mega Radio',
    description: 'Maghanap mula sa 60,000+ live na istasyon ng radyo mula sa 120+ bansa sa Mega Radio. Hanapin ayon sa pangalan, genre, wika, o bansa nang libre.',
    keywords: 'maghanap ng radyo, hanapin ang istasyon ng radyo, paghahanap ng online radyo, live na radyo',
    h1: 'Maghanap ng live na istasyon ng radyo',
    bodyIntro: 'Maghanap sa catalog ng Mega Radio na may higit sa 60,000 live na istasyon ng radyo mula sa higit sa 120 bansa. Mag-type ng pangalan ng istasyon, genre ng musika, wika, o bansa at simulang makinig ng libreng online na radyo agad.',
  },
  he: {
    title: 'חיפוש תחנות רדיו — מצא רדיו חי לפי שם, ז\'אנר או מדינה | Mega Radio',
    description: 'חפש בין 60,000+ תחנות רדיו חי מ-120+ מדינות ב-Mega Radio. מצא את התחנה האהובה עליך לפי שם, ז\'אנר, שפה או מדינה והאזן בחינם.',
    keywords: 'חיפוש רדיו, מצא תחנות רדיו, חיפוש רדיו אונליין, מאתר רדיו חי, תחנות רדיו',
    h1: 'חיפוש תחנות רדיו חי',
    bodyIntro: 'חפש בקטלוג של Mega Radio עם יותר מ-60,000 תחנות רדיו חי מיותר מ-120 מדינות. הקלד שם תחנה, ז\'אנר מוזיקלי, שפה או מדינה והתחל להאזין לרדיו אונליין חינמי באופן מיידי.',
  },
  fa: {
    title: 'جستجوی ایستگاه‌های رادیویی — رادیو زنده را بر اساس نام، ژانر یا کشور پیدا کنید | Mega Radio',
    description: 'در بیش از 60,000 ایستگاه رادیویی زنده از 120+ کشور در Mega Radio جستجو کنید. ایستگاه را بر اساس نام، ژانر، زبان یا کشور پیدا کنید.',
    keywords: 'جستجوی رادیو, پیدا کردن ایستگاه رادیویی, جستجوی رادیو آنلاین, یاب رادیو زنده, ایستگاه‌های رادیویی',
    h1: 'جستجوی ایستگاه‌های رادیویی زنده',
    bodyIntro: 'در کاتالوگ Mega Radio با بیش از 60,000 ایستگاه رادیویی زنده از بیش از 120 کشور جستجو کنید. نام ایستگاه، ژانر موسیقی، زبان یا کشور را وارد کنید و فوراً به رادیوی آنلاین رایگان گوش دهید.',
  },
  ur: {
    title: 'ریڈیو اسٹیشنز تلاش کریں — نام، صنف یا ملک کے لحاظ سے براہ راست ریڈیو تلاش کریں | Mega Radio',
    description: 'Mega Radio پر 120+ ممالک کے 60,000+ براہ راست ریڈیو اسٹیشنز تلاش کریں۔ نام، صنف، زبان یا ملک کے مطابق اسٹیشن تلاش کریں۔',
    keywords: 'ریڈیو تلاش, ریڈیو اسٹیشن تلاش, آن لائن ریڈیو تلاش, براہ راست ریڈیو فائنڈر, ریڈیو اسٹیشنز',
    h1: 'براہ راست ریڈیو اسٹیشنز تلاش کریں',
    bodyIntro: 'Mega Radio کی کیٹلاگ میں 120 سے زائد ممالک کے 60,000 سے زائد براہ راست ریڈیو اسٹیشنز تلاش کریں۔ اسٹیشن کا نام، موسیقی کی صنف، زبان یا ملک ٹائپ کریں اور فوراً مفت آن لائن ریڈیو سننا شروع کریں۔',
  },
  bn: {
    title: 'রেডিও স্টেশন খুঁজুন — নাম, ধরন বা দেশ অনুযায়ী লাইভ রেডিও খুঁজুন | Mega Radio',
    description: 'Mega Radio-তে 120+ দেশের 60,000+ লাইভ রেডিও স্টেশনের মধ্যে খুঁজুন। নাম, ধরন, ভাষা বা দেশ অনুযায়ী আপনার স্টেশন খুঁজে নিন এবং বিনামূল্যে শুনুন।',
    keywords: 'রেডিও অনুসন্ধান, রেডিও স্টেশন খুঁজুন, অনলাইন রেডিও অনুসন্ধান, লাইভ রেডিও ফাইন্ডার, রেডিও স্টেশন',
    h1: 'লাইভ রেডিও স্টেশন খুঁজুন',
    bodyIntro: 'Mega Radio-এর ক্যাটালগে 120টিরও বেশি দেশের 60,000টিরও বেশি লাইভ রেডিও স্টেশন খুঁজুন। স্টেশনের নাম, সঙ্গীতের ধরন, ভাষা বা দেশ টাইপ করুন এবং অবিলম্বে বিনামূল্যে অনলাইন রেডিও শুনতে শুরু করুন।',
  },
  ta: {
    title: 'வானொலி நிலையங்களைத் தேடு — பெயர், வகை அல்லது நாடு வாரியாக நேரலை வானொலியைக் கண்டறி | Mega Radio',
    description: 'Mega Radio இல் 120+ நாடுகளில் இருந்து 60,000+ நேரலை வானொலி நிலையங்களில் தேடுங்கள். பெயர், வகை, மொழி அல்லது நாட்டின்படி தேடுங்கள்.',
    keywords: 'வானொலி தேடல், வானொலி நிலையங்களைக் கண்டறி, ஆன்லைன் வானொலி தேடல், நேரலை வானொலி',
    h1: 'நேரலை வானொலி நிலையங்களைத் தேடு',
    bodyIntro: 'Mega Radio இன் பட்டியலில் 120க்கும் மேற்பட்ட நாடுகளில் இருந்து 60,000க்கும் மேற்பட்ட நேரலை வானொலி நிலையங்களைத் தேடுங்கள். நிலைய பெயர், இசை வகை, மொழி அல்லது நாட்டை உள்ளிட்டு உடனடியாக இலவச ஆன்லைன் வானொலியைக் கேட்கத் தொடங்குங்கள்.',
  },
  te: {
    title: 'రేడియో స్టేషన్‌లను శోధించండి — లైవ్ రేడియోని పేరు, శైలి లేదా దేశం ద్వారా కనుగొనండి | Mega Radio',
    description: 'Mega Radio లో 120+ దేశాల నుండి 60,000+ లైవ్ రేడియో స్టేషన్‌లను శోధించండి. మీ స్టేషన్‌ను పేరు, శైలి, భాష లేదా దేశం ద్వారా కనుగొని ఉచితంగా వినండి.',
    keywords: 'రేడియో శోధన, రేడియో స్టేషన్‌లను కనుగొనండి, ఆన్‌లైన్ రేడియో శోధన, లైవ్ రేడియో ఫైండర్',
    h1: 'లైవ్ రేడియో స్టేషన్‌లను శోధించండి',
    bodyIntro: 'Mega Radio కేటలాగ్‌లో 120+ దేశాల నుండి 60,000+ లైవ్ రేడియో స్టేషన్‌లను శోధించండి. స్టేషన్ పేరు, సంగీత శైలి, భాష లేదా దేశాన్ని టైప్ చేసి తక్షణమే ఉచిత ఆన్‌లైన్ రేడియోని వినడం ప్రారంభించండి.',
  },
  mr: {
    title: 'रेडिओ स्टेशन्स शोधा — नाव, प्रकार किंवा देशानुसार थेट रेडिओ शोधा | Mega Radio',
    description: 'Mega Radio वर 120+ देशांतील 60,000+ थेट रेडिओ स्टेशन्स शोधा. नाव, प्रकार, भाषा किंवा देशानुसार आपले स्टेशन शोधा आणि विनामूल्य ऐका.',
    keywords: 'रेडिओ शोध, रेडिओ स्टेशन्स शोधा, ऑनलाइन रेडिओ शोध, थेट रेडिओ शोधक, रेडिओ स्टेशन्स',
    h1: 'थेट रेडिओ स्टेशन्स शोधा',
    bodyIntro: 'Mega Radio च्या कॅटलॉगमध्ये 120 हून अधिक देशांतील 60,000 हून अधिक थेट रेडिओ स्टेशन्स शोधा. स्टेशनचे नाव, संगीत प्रकार, भाषा किंवा देश टाइप करा आणि लगेच विनामूल्य ऑनलाइन रेडिओ ऐकणे सुरू करा.',
  },
  gu: {
    title: 'રેડિયો સ્ટેશન શોધો — નામ, શૈલી અથવા દેશ દ્વારા લાઇવ રેડિયો શોધો | Mega Radio',
    description: 'Mega Radio પર 120+ દેશોના 60,000+ લાઇવ રેડિયો સ્ટેશન શોધો. નામ, શૈલી, ભાષા અથવા દેશ દ્વારા તમારું સ્ટેશન શોધો અને મફત સાંભળો.',
    keywords: 'રેડિયો શોધ, રેડિયો સ્ટેશન શોધો, ઓનલાઇન રેડિયો શોધ, લાઇવ રેડિયો ફાઇન્ડર, રેડિયો સ્ટેશન',
    h1: 'લાઇવ રેડિયો સ્ટેશન શોધો',
    bodyIntro: 'Mega Radio ની કેટેલોગમાં 120+ દેશોના 60,000+ લાઇવ રેડિયો સ્ટેશન શોધો. સ્ટેશનનું નામ, સંગીત શૈલી, ભાષા અથવા દેશ ટાઇપ કરો અને તરત જ મફત ઓનલાઇન રેડિયો સાંભળવાનું શરૂ કરો.',
  },
  kn: {
    title: 'ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳನ್ನು ಹುಡುಕಿ — ಹೆಸರು, ಪ್ರಕಾರ ಅಥವಾ ದೇಶದಿಂದ ಲೈವ್ ರೇಡಿಯೋ ಹುಡುಕಿ | Mega Radio',
    description: 'Mega Radio ನಲ್ಲಿ 120+ ದೇಶಗಳ 60,000+ ಲೈವ್ ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳನ್ನು ಹುಡುಕಿ. ಹೆಸರು, ಪ್ರಕಾರ, ಭಾಷೆ ಅಥವಾ ದೇಶದಿಂದ ನಿಮ್ಮ ಸ್ಟೇಷನ್ ಹುಡುಕಿ ಉಚಿತವಾಗಿ ಆಲಿಸಿ.',
    keywords: 'ರೇಡಿಯೋ ಹುಡುಕಾಟ, ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳನ್ನು ಹುಡುಕಿ, ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ಹುಡುಕಾಟ, ಲೈವ್ ರೇಡಿಯೋ',
    h1: 'ಲೈವ್ ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳನ್ನು ಹುಡುಕಿ',
    bodyIntro: 'Mega Radio ಕ್ಯಾಟಲಾಗ್‌ನಲ್ಲಿ 120ಕ್ಕೂ ಹೆಚ್ಚು ದೇಶಗಳ 60,000ಕ್ಕೂ ಹೆಚ್ಚು ಲೈವ್ ರೇಡಿಯೋ ಸ್ಟೇಷನ್‌ಗಳನ್ನು ಹುಡುಕಿ. ಸ್ಟೇಷನ್ ಹೆಸರು, ಸಂಗೀತ ಪ್ರಕಾರ, ಭಾಷೆ ಅಥವಾ ದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ ತಕ್ಷಣವೇ ಉಚಿತ ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ಆಲಿಸಲು ಪ್ರಾರಂಭಿಸಿ.',
  },
  ml: {
    title: 'റേഡിയോ സ്റ്റേഷനുകൾ തിരയുക — പേര്, ജോണർ അല്ലെങ്കിൽ രാജ്യം പ്രകാരം ലൈവ് റേഡിയോ കണ്ടെത്തുക | Mega Radio',
    description: 'Mega Radio-യിൽ 120+ രാജ്യങ്ങളിൽ നിന്നുള്ള 60,000+ ലൈവ് റേഡിയോ സ്റ്റേഷനുകൾ തിരയുക. പേര്, ജോണർ, ഭാഷ അല്ലെങ്കിൽ രാജ്യം പ്രകാരം കണ്ടെത്തുക.',
    keywords: 'റേഡിയോ തിരയൽ, റേഡിയോ സ്റ്റേഷനുകൾ കണ്ടെത്തുക, ഓൺലൈൻ റേഡിയോ തിരയൽ, ലൈവ് റേഡിയോ',
    h1: 'ലൈവ് റേഡിയോ സ്റ്റേഷനുകൾ തിരയുക',
    bodyIntro: 'Mega Radio-യുടെ കാറ്റലോഗിൽ 120-ലധികം രാജ്യങ്ങളിൽ നിന്നുള്ള 60,000-ലധികം ലൈവ് റേഡിയോ സ്റ്റേഷനുകൾ തിരയുക. സ്റ്റേഷൻ പേര്, സംഗീത ജോണർ, ഭാഷ അല്ലെങ്കിൽ രാജ്യം ടൈപ്പ് ചെയ്ത് ഉടൻ സൗജന്യ ഓൺലൈൻ റേഡിയോ കേൾക്കാൻ തുടങ്ങുക.',
  },
  pa: {
    title: 'ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ — ਨਾਮ, ਸ਼ੈਲੀ ਜਾਂ ਦੇਸ਼ ਅਨੁਸਾਰ ਲਾਈਵ ਰੇਡੀਓ ਲੱਭੋ | Mega Radio',
    description: 'Mega Radio ਤੇ 120+ ਦੇਸ਼ਾਂ ਦੇ 60,000+ ਲਾਈਵ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ। ਨਾਮ, ਸ਼ੈਲੀ, ਭਾਸ਼ਾ ਜਾਂ ਦੇਸ਼ ਅਨੁਸਾਰ ਆਪਣਾ ਸਟੇਸ਼ਨ ਲੱਭੋ ਅਤੇ ਮੁਫ਼ਤ ਸੁਣੋ।',
    keywords: 'ਰੇਡੀਓ ਖੋਜ, ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਲੱਭੋ, ਆਨਲਾਈਨ ਰੇਡੀਓ ਖੋਜ, ਲਾਈਵ ਰੇਡੀਓ ਫਾਈਂਡਰ, ਰੇਡੀਓ ਸਟੇਸ਼ਨ',
    h1: 'ਲਾਈਵ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ',
    bodyIntro: 'Mega Radio ਦੀ ਕੈਟਾਲਾਗ ਵਿੱਚ 120 ਤੋਂ ਵੱਧ ਦੇਸ਼ਾਂ ਦੇ 60,000 ਤੋਂ ਵੱਧ ਲਾਈਵ ਰੇਡੀਓ ਸਟੇਸ਼ਨ ਖੋਜੋ। ਸਟੇਸ਼ਨ ਦਾ ਨਾਮ, ਸੰਗੀਤ ਸ਼ੈਲੀ, ਭਾਸ਼ਾ ਜਾਂ ਦੇਸ਼ ਟਾਈਪ ਕਰੋ ਅਤੇ ਤੁਰੰਤ ਮੁਫ਼ਤ ਆਨਲਾਈਨ ਰੇਡੀਓ ਸੁਣਨਾ ਸ਼ੁਰੂ ਕਰੋ।',
  },
  sw: {
    title: 'Tafuta vituo vya redio — Pata redio ya moja kwa moja kwa jina, aina au nchi | Mega Radio',
    description: 'Tafuta 60,000+ vituo vya redio vya moja kwa moja kutoka nchi 120+ kwenye Mega Radio. Pata kituo kwa jina, aina, lugha au nchi bure.',
    keywords: 'tafuta redio, pata vituo vya redio, utafutaji wa redio mtandaoni, kitafutaji cha redio, vituo vya redio',
    h1: 'Tafuta vituo vya redio vya moja kwa moja',
    bodyIntro: 'Tafuta katika orodha ya Mega Radio yenye vituo zaidi ya 60,000 vya redio vya moja kwa moja kutoka nchi zaidi ya 120. Andika jina la kituo, aina ya muziki, lugha au nchi na anza kusikiliza redio ya mtandaoni bure mara moja.',
  },
  am: {
    title: 'የራዲዮ ጣቢያዎችን ፈልግ — በስም፣ ዘውግ ወይም አገር ቀጥታ ራዲዮ ያግኙ | Mega Radio',
    description: 'በ Mega Radio ላይ ከ120+ አገራት 60,000+ ቀጥታ የራዲዮ ጣቢያዎችን ይፈልጉ። ጣቢያዎን በስም፣ ዘውግ፣ ቋንቋ ወይም አገር ያግኙ እና በነፃ ያዳምጡ።',
    keywords: 'ራዲዮ ፍለጋ, የራዲዮ ጣቢያዎችን ያግኙ, የመስመር ላይ ራዲዮ ፍለጋ, ቀጥታ ራዲዮ ፈላጊ, የራዲዮ ጣቢያዎች',
    h1: 'ቀጥታ የራዲዮ ጣቢያዎችን ፈልግ',
    bodyIntro: 'በ Mega Radio ካታሎግ ውስጥ ከ120 በላይ አገራት ከ60,000 በላይ ቀጥታ የራዲዮ ጣቢያዎችን ይፈልጉ። የጣቢያ ስም፣ የሙዚቃ ዘውግ፣ ቋንቋ ወይም አገር ይተይቡ እና ወዲያውኑ ነፃ የመስመር ላይ ራዲዮ ማዳመጥ ይጀምሩ።',
  },
  zu: {
    title: 'Sesha iziteshi zomsakazo — Thola umsakazo obukhoma ngegama, uhlobo noma izwe | Mega Radio',
    description: 'Sesha phakathi kweziteshi zomsakazo ezingu-60,000+ ezibukhoma kusukela emazweni angu-120+ ku-Mega Radio. Thola ngegama, uhlobo noma izwe.',
    keywords: 'sesha umsakazo, thola iziteshi zomsakazo, ukusesha umsakazo onlayini, isithungi somsakazo obukhoma',
    h1: 'Sesha iziteshi zomsakazo ezibukhoma',
    bodyIntro: 'Sesha kukhathalogi ye-Mega Radio enaziteshi zomsakazo ezingaphezu kuka-60,000 ezibukhoma kusukela emazweni angaphezu kuka-120. Thayipha igama lesiteshi, uhlobo lomculo, ulimi noma izwe uqale ukulalela umsakazo we-inthanethi mahhala ngokushesha.',
  },
  af: {
    title: 'Soek radiostasies — Vind regstreekse radio op naam, genre of land | Mega Radio',
    description: 'Soek tussen 60 000+ regstreekse radiostasies van 120+ lande op Mega Radio. Vind jou stasie op naam, genre, taal of land en luister gratis.',
    keywords: 'soek radio, vind radiostasies, aanlyn radiosoek, regstreekse radio soeker, radiostasies',
    h1: 'Soek regstreekse radiostasies',
    bodyIntro: "Soek in Mega Radio se katalogus van meer as 60 000 regstreekse radiostasies uit meer as 120 lande. Tik 'n stasienaam, musiekgenre, taal of land in en begin onmiddellik gratis aanlyn radio luister.",
  },
  sq: {
    title: 'Kërko stacione radio — Gjej radion live sipas emrit, zhanrit ose vendit | Mega Radio',
    description: 'Kërko mes 60.000+ stacioneve radio live nga 120+ vende në Mega Radio. Gjej stacionin sipas emrit, zhanrit, gjuhës ose vendit falas.',
    keywords: 'kërko radio, gjej stacione radio, kërkim radioje online, gjetës radio live, stacione radio',
    h1: 'Kërko stacione radio live',
    bodyIntro: 'Kërko në katalogun e Mega Radio me mbi 60.000 stacione radio live nga më shumë se 120 vende. Shkruaj një emër stacioni, zhanër muzikor, gjuhë ose vend dhe fillo të dëgjosh radio online falas menjëherë.',
  },
  az: {
    title: 'Radio stansiyalarını axtar — Adı, janrı və ya ölkəyə görə canlı radio tap | Mega Radio',
    description: 'Mega Radio-da 120+ ölkədən 60.000+ canlı radio stansiyası arasında axtar. Stansiyanı ad, janr, dil və ya ölkəyə görə tap və pulsuz dinlə.',
    keywords: 'radio axtar, radio stansiyaları tap, onlayn radio axtarışı, canlı radio tapıcı, radio stansiyaları',
    h1: 'Canlı radio stansiyalarını axtar',
    bodyIntro: 'Mega Radio kataloqunda 120-dən çox ölkədən 60.000-dən çox canlı radio stansiyası arasında axtarın. Stansiyanın adını, musiqi janrını, dilini və ya ölkəni yazın və dərhal pulsuz onlayn radio dinləməyə başlayın.',
  },
  hy: {
    title: 'Որոնել ռադիոկայաններ — Գտեք ուղիղ եթերի ռադիոն ըստ անվան, ժանրի կամ երկրի | Mega Radio',
    description: 'Որոնեք 60,000+ ուղիղ եթերի ռադիոկայանների մեջ 120+ երկրներից Mega Radio-ում: Գտեք ձեր կայանը անվամբ, ժանրով, լեզվով կամ երկրով և լսեք անվճար:',
    keywords: 'ռադիո որոնում, գտեք ռադիոկայաններ, օնլայն ռադիոյի որոնում, ուղիղ ռադիո որոնիչ, ռադիոկայաններ',
    h1: 'Որոնել ուղիղ եթերի ռադիոկայաններ',
    bodyIntro: 'Որոնեք Mega Radio-ի կատալոգում, որն ունի ավելի քան 60,000 ուղիղ եթերի ռադիոկայան ավելի քան 120 երկրներից: Մուտքագրեք կայանի անունը, երաժշտական ժանրը, լեզուն կամ երկիրը և անմիջապես սկսեք լսել անվճար օնլայն ռադիո:',
  },
  so: {
    title: 'Raadi xarumaha raadiyaha — Hel raadiyaha tooska ah magaca, nooca ama dalka | Mega Radio',
    description: 'Ka raadi 60,000+ xarumood raadiyo oo tooska ah oo ka socda 120+ waddan Mega Radio. Hel xaruntaada magaca, nooca, luqadda ama dalka.',
    keywords: 'raadi raadiyo, hel xarumaha raadiyaha, raadinta raadiyaha online, baadhe raadiyo tooska ah, xarumaha raadiyaha',
    h1: 'Raadi xarumaha raadiyaha tooska ah',
    bodyIntro: 'Ka raadi katalooga Mega Radio oo leh in ka badan 60,000 xaruumood raadiyo oo tooska ah oo ka socda in ka badan 120 waddan. Qor magaca xaruunta, nooca muusiga, luqadda ama dalka oo bilow inaad si bilaash ah u dhagaysato raadiyaha online ee dhakhso ah.',
  },
  uk: {
    title: 'Пошук радіостанцій — Знайдіть пряму трансляцію за назвою, жанром чи країною | Mega Radio',
    description: 'Шукайте серед 60 000+ радіостанцій у прямому ефірі зі 120+ країн на Mega Radio. Знайдіть станцію за назвою, жанром, мовою чи країною.',
    keywords: 'пошук радіо, знайти радіостанції, онлайн пошук радіо, пошук прямого ефіру, радіостанції',
    h1: 'Пошук радіостанцій у прямому ефірі',
    bodyIntro: 'Шукайте в каталозі Mega Radio: понад 60 000 радіостанцій у прямому ефірі з понад 120 країн. Введіть назву станції, музичний жанр, мову чи країну і миттєво почніть слухати безкоштовне онлайн-радіо.',
  },
  bs: {
    title: 'Pretraži radio stanice — Pronađi radio uživo po imenu, žanru ili državi | Mega Radio',
    description: 'Pretražite 60.000+ radio stanica uživo iz 120+ država na Mega Radiju. Pronađite stanicu po imenu, žanru, jeziku ili državi i slušajte besplatno.',
    keywords: 'pretraga radija, pronađi radio stanice, online pretraga radija, radio uživo, traženje stanica',
    h1: 'Pretraži radio stanice uživo',
    bodyIntro: 'Pretražujte katalog Mega Radija s više od 60.000 radio stanica uživo iz više od 120 država. Upišite ime stanice, muzički žanr, jezik ili državu i odmah počnite slušati besplatni online radio.',
  },
};

/**
 * Returns a multilingual SEO template for the requested language, falling back to English.
 */
export function getSearchSeoTemplate(language: string): SearchSeoTemplate {
  return SEARCH_SEO_TEMPLATES[language] || SEARCH_SEO_TEMPLATES.en;
}

/**
 * Grapheme-aware truncation. Mirrors the helper in genre-seo-templates.ts so Arabic combining
 * marks, emoji ZWJ sequences, and surrogate pairs are not split mid-cluster.
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
 * Builds title/description/keywords/h1/bodyIntro for the search results page in the given language.
 *
 * If `dbTranslations` provides the legacy keys IN THE REQUESTED LANGUAGE
 * (`search_page_title`, `search_page_description`, `search_page_h1`,
 * `search_page_intro`), they take precedence — otherwise we fall back to the
 * per-language template so we never serve a Turkish page with an English
 * `<title>`. Mirrors the override pattern used by buildGenreSeo / buildCountrySeo.
 *
 * Defensive: enforces a 145-character maximum description length.
 */
export function buildSearchSeo(
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string; keywords: string; h1: string; bodyIntro: string } {
  const tpl = getSearchSeoTemplate(language);

  const dbTitle = dbTranslations?.search_page_title?.trim();
  const dbDescription = dbTranslations?.search_page_description?.trim();
  const dbH1 = dbTranslations?.search_page_h1?.trim();
  const dbIntro = dbTranslations?.search_page_intro?.trim();

  const title = dbTitle || tpl.title;
  let description = dbDescription || tpl.description;

  // Defensive 145-char clamp at word boundary (matches genre/region templates).
  if (description.length > 145) {
    const cutoff = description.lastIndexOf(' ', 142);
    if (cutoff > 100) {
      description = description.slice(0, cutoff) + '...';
    } else {
      description = clampGraphemes(description, 142) + '...';
    }
  }

  const keywords = tpl.keywords;
  const h1 = dbH1 || tpl.h1;
  const bodyIntro = dbIntro || tpl.bodyIntro;

  return { title, description, keywords, h1, bodyIntro };
}
