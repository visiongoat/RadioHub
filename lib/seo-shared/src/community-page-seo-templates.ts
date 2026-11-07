/**
 * Multilingual SEO templates for the "community" surface pages — the
 * Users community page (`/xx/users`), the personalised Recommendations
 * page (`/xx/recommendations`) and the global Stations directory
 * (`/xx/stations`).
 *
 * 2026-05-12 SEO audit prompted this template:
 *   • `/tr/kullanicilar` and `/tr/tavsiyeler` were both rendering the
 *     hardcoded English `<title>` "Mega Radio - Listen to Free Live
 *     Radio Online" because seo-renderer.ts had no `pageType` branch
 *     for them — they fell through to the home page bucket and reused
 *     `meta_title`, producing duplicate-title audit errors across every
 *     locale.
 *   • `/tr/istasyon` produced a duplicate `<meta description>` with
 *     `/tr` for the same reason — the `stations` bucket relied entirely
 *     on the DB key `stations_page_description`, which is empty for
 *     most non-English locales, so the home description leaked through.
 *
 * This template gives every locale a distinct, idiomatic title and
 * description for all three pages with English as the structural
 * fallback. Mirrors STATIC_PAGE_SEO_TEMPLATES exactly so future
 * additions stay consistent. Used by:
 *   - artifacts/api-server/src/seo-renderer.ts (`pageType === 'users' |
 *     'recommendations' | 'stations'` branches in
 *     `generateEnhancedSeoTags`).
 *
 * Database translation keys take precedence when present in the
 * requested language — otherwise we'd serve a Turkish page with an
 * English `<title>`.
 *   - users:           `users_page_title`,           `users_page_description`
 *   - recommendations: `recommendations_page_title`, `recommendations_page_description`
 *   - stations:        `stations_page_title`,        `stations_page_description`
 *
 * Descriptions kept under ~155 chars (Bing META DESCRIPTION LENGTH
 * RULE), titles under ~70 chars where possible.
 */

export interface CommunityPageSeoEntry {
  title: string;
  description: string;
  keywords?: string;
}

export interface CommunityPageSeoTemplate {
  users: CommunityPageSeoEntry;
  recommendations: CommunityPageSeoEntry;
  stations: CommunityPageSeoEntry;
}

export type CommunityPageKind = 'users' | 'recommendations' | 'stations';

// All 57 supported languages with idiomatic native phrasing for the
// languages where we have native-speaker review (top ~25 by audience
// share); the rest extend the English template so we never serve a
// blank title — they will be replaced by translated entries as native
// review lands. Any language not present here falls back to English
// via getCommunityPageSeoTemplate().
export const COMMUNITY_PAGE_SEO_TEMPLATES: Record<string, CommunityPageSeoTemplate> = {
  en: {
    users: {
      title: 'Mega Radio Community — Discover Listeners and Curators',
      description: 'Join the Mega Radio community: discover listeners, follow curators and explore the live radio stations they love most across 120+ countries.',
      keywords: 'radio community, radio listeners, mega radio users, social radio, follow curators',
    },
    recommendations: {
      title: 'For You — Personalised Live Radio Recommendations | Mega Radio',
      description: 'Personalised live radio picks based on the stations you love. Discover new music, news and talk radio from 60,000+ stations on Mega Radio.',
      keywords: 'personalised radio, radio recommendations, for you radio, custom radio picks, mega radio for you',
    },
    stations: {
      title: 'All Radio Stations — Browse 60,000+ Live Stations | Mega Radio',
      description: 'Browse Mega Radio\'s full directory of 60,000+ free live radio stations from 120+ countries. Filter by genre, country, language and more.',
      keywords: 'all radio stations, online radio directory, live radio stations, free radio stations, internet radio',
    },
  },
  tr: {
    users: {
      title: 'Mega Radio Topluluğu — Dinleyicileri ve Küratörleri Keşfedin',
      description: 'Mega Radio topluluğuna katılın: dinleyicileri keşfedin, küratörleri takip edin ve 120+ ülkeden en sevdikleri canlı radyo istasyonlarını dinleyin.',
      keywords: 'radyo topluluğu, radyo dinleyicileri, mega radio kullanıcıları, sosyal radyo, küratör takip',
    },
    recommendations: {
      title: 'Sizin İçin — Kişiselleştirilmiş Canlı Radyo Önerileri | Mega Radio',
      description: 'Sevdiğiniz istasyonlara göre kişiselleştirilmiş canlı radyo önerileri. 60.000+ istasyondan yeni müzik, haber ve sohbet radyosu keşfedin.',
      keywords: 'kişiselleştirilmiş radyo, radyo önerileri, sizin için radyo, özel radyo seçimleri, mega radio öneri',
    },
    stations: {
      title: 'Tüm Radyo İstasyonları — 60.000+ Canlı İstasyona Göz Atın | Mega Radio',
      description: 'Mega Radio\'nun 120+ ülkeden 60.000+ ücretsiz canlı radyo istasyonu dizinine göz atın. Türe, ülkeye ve dile göre filtreleyin.',
      keywords: 'tüm radyo istasyonları, online radyo dizini, canlı radyo istasyonları, ücretsiz radyo, internet radyosu',
    },
  },
  es: {
    users: {
      title: 'Comunidad Mega Radio — Descubre Oyentes y Curadores',
      description: 'Únete a la comunidad Mega Radio: descubre oyentes, sigue a curadores y explora las emisoras de radio en vivo favoritas en 120+ países.',
      keywords: 'comunidad de radio, oyentes de radio, usuarios mega radio, radio social, seguir curadores',
    },
    recommendations: {
      title: 'Para Ti — Recomendaciones Personalizadas de Radio en Vivo | Mega Radio',
      description: 'Recomendaciones de radio en vivo basadas en las emisoras que te gustan. Descubre nueva música, noticias y radio hablada en 60.000+ emisoras.',
      keywords: 'radio personalizada, recomendaciones de radio, radio para ti, selecciones a medida, mega radio para ti',
    },
    stations: {
      title: 'Todas las Emisoras — Explora 60.000+ Radios en Vivo | Mega Radio',
      description: 'Explora el directorio completo de Mega Radio con 60.000+ emisoras de radio en vivo gratis de 120+ países. Filtra por género, país e idioma.',
      keywords: 'todas las emisoras, directorio radio online, emisoras en vivo, radio gratis, radio por internet',
    },
  },
  fr: {
    users: {
      title: 'Communauté Mega Radio — Découvrez Auditeurs et Curateurs',
      description: "Rejoignez la communauté Mega Radio : découvrez des auditeurs, suivez des curateurs et explorez les stations de radio en direct préférées de 120+ pays.",
      keywords: 'communauté radio, auditeurs radio, utilisateurs mega radio, radio sociale, suivre curateurs',
    },
    recommendations: {
      title: 'Pour Vous — Recommandations de Radio Personnalisées | Mega Radio',
      description: 'Sélections de radio en direct personnalisées selon vos stations préférées. Découvrez nouvelle musique, infos et radios parlées sur 60 000+ stations.',
      keywords: 'radio personnalisée, recommandations radio, radio pour vous, sélections sur mesure, mega radio pour vous',
    },
    stations: {
      title: 'Toutes les Stations Radio — Parcourez 60 000+ Radios en Direct | Mega Radio',
      description: 'Parcourez l\'annuaire complet de Mega Radio : 60 000+ stations radio en direct gratuites de 120+ pays. Filtrez par genre, pays et langue.',
      keywords: 'toutes stations radio, annuaire radio en ligne, stations radio en direct, radio gratuite, radio internet',
    },
  },
  de: {
    users: {
      title: 'Mega Radio Community — Entdecke Hörer und Kuratoren',
      description: 'Werde Teil der Mega-Radio-Community: entdecke Hörer, folge Kuratoren und erkunde ihre Lieblings-Live-Radiosender aus über 120 Ländern.',
      keywords: 'radio community, radio hörer, mega radio nutzer, soziales radio, kuratoren folgen',
    },
    recommendations: {
      title: 'Für Sie — Personalisierte Live-Radio-Empfehlungen | Mega Radio',
      description: 'Personalisierte Live-Radio-Empfehlungen basierend auf deinen Lieblingssendern. Entdecke neue Musik, Nachrichten und Talk-Radio auf 60.000+ Sendern.',
      keywords: 'personalisiertes radio, radio empfehlungen, radio für sie, persönliche radio auswahl, mega radio für sie',
    },
    stations: {
      title: 'Alle Radiosender — Durchsuche 60.000+ Live-Sender | Mega Radio',
      description: 'Durchsuche das vollständige Mega-Radio-Verzeichnis mit 60.000+ kostenlosen Live-Radiosendern aus 120+ Ländern. Filter nach Genre, Land und Sprache.',
      keywords: 'alle radiosender, online radio verzeichnis, live radiosender, kostenloses radio, internetradio',
    },
  },
  it: {
    users: {
      title: 'Community Mega Radio — Scopri Ascoltatori e Curatori',
      description: 'Unisciti alla community Mega Radio: scopri ascoltatori, segui curatori ed esplora le stazioni radio dal vivo preferite in 120+ paesi.',
      keywords: 'community radio, ascoltatori radio, utenti mega radio, radio sociale, segui curatori',
    },
    recommendations: {
      title: 'Per Te — Consigli Radio Personalizzati in Diretta | Mega Radio',
      description: 'Consigli radio in diretta personalizzati in base alle stazioni che ami. Scopri musica, news e talk radio da 60.000+ stazioni su Mega Radio.',
      keywords: 'radio personalizzata, consigli radio, radio per te, selezioni su misura, mega radio per te',
    },
    stations: {
      title: 'Tutte le Stazioni Radio — Sfoglia 60.000+ Radio Dal Vivo | Mega Radio',
      description: 'Sfoglia la directory completa di Mega Radio con 60.000+ stazioni radio dal vivo gratuite da 120+ paesi. Filtra per genere, paese e lingua.',
      keywords: 'tutte stazioni radio, directory radio online, radio dal vivo, radio gratis, radio internet',
    },
  },
  pt: {
    users: {
      title: 'Comunidade Mega Radio — Descubra Ouvintes e Curadores',
      description: 'Junte-se à comunidade Mega Radio: descubra ouvintes, siga curadores e explore as estações de rádio ao vivo favoritas em 120+ países.',
      keywords: 'comunidade rádio, ouvintes rádio, usuários mega radio, rádio social, seguir curadores',
    },
    recommendations: {
      title: 'Para Você — Recomendações Personalizadas de Rádio Ao Vivo | Mega Radio',
      description: 'Recomendações de rádio ao vivo baseadas nas estações que você ama. Descubra nova música, notícias e rádio talk em 60.000+ estações.',
      keywords: 'rádio personalizada, recomendações de rádio, rádio para você, seleções sob medida, mega radio para você',
    },
    stations: {
      title: 'Todas as Estações de Rádio — Explore 60.000+ Rádios Ao Vivo | Mega Radio',
      description: 'Explore o diretório completo do Mega Radio com 60.000+ estações de rádio ao vivo gratuitas de 120+ países. Filtre por gênero, país e idioma.',
      keywords: 'todas estações rádio, diretório rádio online, rádio ao vivo, rádio grátis, rádio internet',
    },
  },
  ru: {
    users: {
      title: 'Сообщество Mega Radio — Откройте Слушателей и Кураторов',
      description: 'Присоединяйтесь к сообществу Mega Radio: открывайте слушателей, подписывайтесь на кураторов и исследуйте их любимые радиостанции из 120+ стран.',
      keywords: 'сообщество радио, слушатели радио, пользователи mega radio, социальное радио, подписаться на кураторов',
    },
    recommendations: {
      title: 'Для Вас — Персональные Рекомендации Радио в Эфире | Mega Radio',
      description: 'Персональные подборки радио в прямом эфире на основе любимых станций. Открывайте новую музыку, новости и ток-радио из 60 000+ станций.',
      keywords: 'персональное радио, рекомендации радио, радио для вас, индивидуальные подборки, mega radio для вас',
    },
    stations: {
      title: 'Все Радиостанции — Обзор 60 000+ Радио в Эфире | Mega Radio',
      description: 'Полный каталог Mega Radio: 60 000+ бесплатных радиостанций в прямом эфире из 120+ стран. Фильтруйте по жанру, стране и языку.',
      keywords: 'все радиостанции, онлайн радио каталог, прямой эфир радио, бесплатное радио, интернет радио',
    },
  },
  ar: {
    users: {
      title: 'مجتمع Mega Radio — اكتشف المستمعين والمنسقين',
      description: 'انضم إلى مجتمع Mega Radio: اكتشف المستمعين وتابع المنسقين واستكشف محطات الراديو المباشرة المفضلة لديهم في أكثر من 120 دولة.',
      keywords: 'مجتمع الراديو, مستمعو الراديو, مستخدمو ميجا راديو, راديو اجتماعي, متابعة المنسقين',
    },
    recommendations: {
      title: 'لك — توصيات راديو مباشرة مخصصة | Mega Radio',
      description: 'توصيات راديو مباشرة مخصصة بناءً على المحطات التي تحبها. اكتشف موسيقى وأخبارًا وبرامج حوارية جديدة من أكثر من 60,000 محطة.',
      keywords: 'راديو مخصص, توصيات راديو, راديو لك, اختيارات مخصصة, ميجا راديو لك',
    },
    stations: {
      title: 'جميع محطات الراديو — تصفح أكثر من 60,000 محطة مباشرة | Mega Radio',
      description: 'تصفح دليل Mega Radio الكامل لأكثر من 60,000 محطة راديو مباشرة مجانية من 120+ دولة. صفِّ حسب النوع والبلد واللغة.',
      keywords: 'جميع محطات الراديو, دليل راديو إنترنت, راديو مباشر, راديو مجاني, راديو إنترنت',
    },
  },
  zh: {
    users: {
      title: 'Mega Radio 社区 — 发现听众与策展人',
      description: '加入 Mega Radio 社区：发现听众，关注策展人，并探索来自 120+ 国家的他们最爱的现场广播电台。',
      keywords: '电台社区, 电台听众, mega radio 用户, 社交电台, 关注策展人',
    },
    recommendations: {
      title: '为你推荐 — 个性化现场广播推荐 | Mega Radio',
      description: '基于你喜欢的电台为你推荐现场广播。从 60,000+ 电台中发现新音乐、新闻和谈话电台。',
      keywords: '个性化电台, 电台推荐, 为你推荐, 定制电台精选, mega radio 为你推荐',
    },
    stations: {
      title: '全部电台 — 浏览 60,000+ 现场电台 | Mega Radio',
      description: '浏览 Mega Radio 完整目录：来自 120+ 国家的 60,000+ 免费现场广播电台。按流派、国家和语言筛选。',
      keywords: '全部电台, 在线电台目录, 现场电台, 免费电台, 网络电台',
    },
  },
  ja: {
    users: {
      title: 'Mega Radio コミュニティ — リスナーとキュレーターを発見',
      description: 'Mega Radio コミュニティに参加：リスナーを発見し、キュレーターをフォローし、120以上の国の彼らのお気に入りライブラジオを探索しましょう。',
      keywords: 'ラジオコミュニティ, ラジオリスナー, mega radio ユーザー, ソーシャルラジオ, キュレーターをフォロー',
    },
    recommendations: {
      title: 'あなたへのおすすめ — パーソナライズされたライブラジオ | Mega Radio',
      description: 'お気に入りの局に基づくパーソナライズされたライブラジオの提案。60,000以上の局から新しい音楽、ニュース、トークを発見。',
      keywords: 'パーソナライズラジオ, ラジオおすすめ, あなたへのラジオ, カスタムラジオ, mega radio おすすめ',
    },
    stations: {
      title: 'すべてのラジオ局 — 60,000以上のライブ局を閲覧 | Mega Radio',
      description: 'Mega Radio の完全ディレクトリ：120以上の国から60,000以上の無料ライブラジオ局。ジャンル、国、言語で絞り込み。',
      keywords: 'すべてのラジオ局, オンラインラジオディレクトリ, ライブラジオ, 無料ラジオ, インターネットラジオ',
    },
  },
  ko: {
    users: {
      title: 'Mega Radio 커뮤니티 — 청취자와 큐레이터 발견',
      description: 'Mega Radio 커뮤니티에 참여하세요: 청취자를 발견하고 큐레이터를 팔로우하며 120+ 국가의 인기 라이브 라디오 방송국을 탐색하세요.',
      keywords: '라디오 커뮤니티, 라디오 청취자, mega radio 사용자, 소셜 라디오, 큐레이터 팔로우',
    },
    recommendations: {
      title: '당신을 위한 추천 — 맞춤형 라이브 라디오 | Mega Radio',
      description: '좋아하는 방송국 기반 맞춤형 라이브 라디오 추천. 60,000+ 방송국에서 새로운 음악, 뉴스, 토크 라디오를 발견하세요.',
      keywords: '맞춤형 라디오, 라디오 추천, 당신을 위한 라디오, 맞춤 라디오 선택, mega radio 추천',
    },
    stations: {
      title: '모든 라디오 방송국 — 60,000+ 라이브 방송국 탐색 | Mega Radio',
      description: 'Mega Radio의 전체 디렉터리 탐색: 120+ 국가의 60,000+ 무료 라이브 라디오 방송국. 장르, 국가, 언어로 필터링.',
      keywords: '모든 라디오 방송국, 온라인 라디오 디렉터리, 라이브 라디오, 무료 라디오, 인터넷 라디오',
    },
  },
  nl: {
    users: {
      title: 'Mega Radio Gemeenschap — Ontdek Luisteraars en Curatoren',
      description: 'Word lid van de Mega Radio-gemeenschap: ontdek luisteraars, volg curatoren en verken hun favoriete live radiostations uit 120+ landen.',
      keywords: 'radio gemeenschap, radio luisteraars, mega radio gebruikers, sociale radio, curatoren volgen',
    },
    recommendations: {
      title: 'Voor Jou — Persoonlijke Live Radio Aanbevelingen | Mega Radio',
      description: 'Persoonlijke live radio-aanbevelingen op basis van je favoriete stations. Ontdek nieuwe muziek, nieuws en talkradio op 60.000+ stations.',
      keywords: 'persoonlijke radio, radio aanbevelingen, radio voor jou, op maat radio, mega radio voor jou',
    },
    stations: {
      title: 'Alle Radiostations — Blader door 60.000+ Live Stations | Mega Radio',
      description: 'Blader door de volledige Mega Radio-directory met 60.000+ gratis live radiostations uit 120+ landen. Filter op genre, land en taal.',
      keywords: 'alle radiostations, online radio directory, live radiostations, gratis radio, internetradio',
    },
  },
  pl: {
    users: {
      title: 'Społeczność Mega Radio — Odkrywaj Słuchaczy i Kuratorów',
      description: 'Dołącz do społeczności Mega Radio: odkrywaj słuchaczy, obserwuj kuratorów i poznawaj ulubione stacje radia na żywo z 120+ krajów.',
      keywords: 'społeczność radia, słuchacze radia, użytkownicy mega radio, społeczne radio, obserwuj kuratorów',
    },
    recommendations: {
      title: 'Dla Ciebie — Spersonalizowane Rekomendacje Radia Na Żywo | Mega Radio',
      description: 'Spersonalizowane rekomendacje radia na żywo na podstawie ulubionych stacji. Odkrywaj nową muzykę, wiadomości i radio talk w 60 000+ stacjach.',
      keywords: 'spersonalizowane radio, rekomendacje radia, radio dla ciebie, dopasowane wybory, mega radio dla ciebie',
    },
    stations: {
      title: 'Wszystkie Stacje Radiowe — Przeglądaj 60 000+ Stacji Na Żywo | Mega Radio',
      description: 'Przeglądaj pełny katalog Mega Radio: 60 000+ darmowych stacji radiowych na żywo z 120+ krajów. Filtruj według gatunku, kraju i języka.',
      keywords: 'wszystkie stacje radiowe, katalog radia online, radio na żywo, darmowe radio, radio internetowe',
    },
  },
  hi: {
    users: {
      title: 'Mega Radio समुदाय — श्रोता और क्यूरेटर खोजें',
      description: 'Mega Radio समुदाय में शामिल हों: श्रोताओं को खोजें, क्यूरेटर्स को फॉलो करें और 120+ देशों के उनके पसंदीदा लाइव रेडियो स्टेशन एक्सप्लोर करें।',
      keywords: 'रेडियो समुदाय, रेडियो श्रोता, mega radio उपयोगकर्ता, सोशल रेडियो, क्यूरेटर फॉलो',
    },
    recommendations: {
      title: 'आपके लिए — व्यक्तिगत लाइव रेडियो सुझाव | Mega Radio',
      description: 'आपके पसंदीदा स्टेशनों के आधार पर व्यक्तिगत लाइव रेडियो सुझाव। 60,000+ स्टेशनों से नया संगीत, समाचार और टॉक रेडियो खोजें।',
      keywords: 'व्यक्तिगत रेडियो, रेडियो सुझाव, आपके लिए रेडियो, कस्टम रेडियो, mega radio आपके लिए',
    },
    stations: {
      title: 'सभी रेडियो स्टेशन — 60,000+ लाइव स्टेशन ब्राउज़ करें | Mega Radio',
      description: 'Mega Radio की पूरी डायरेक्टरी ब्राउज़ करें: 120+ देशों के 60,000+ मुफ़्त लाइव रेडियो स्टेशन। शैली, देश और भाषा से फ़िल्टर करें।',
      keywords: 'सभी रेडियो स्टेशन, ऑनलाइन रेडियो डायरेक्टरी, लाइव रेडियो, मुफ़्त रेडियो, इंटरनेट रेडियो',
    },
  },
  id: {
    users: {
      title: 'Komunitas Mega Radio — Temukan Pendengar dan Kurator',
      description: 'Bergabunglah dengan komunitas Mega Radio: temukan pendengar, ikuti kurator, dan jelajahi stasiun radio langsung favorit dari 120+ negara.',
      keywords: 'komunitas radio, pendengar radio, pengguna mega radio, radio sosial, ikuti kurator',
    },
    recommendations: {
      title: 'Untuk Kamu — Rekomendasi Radio Langsung yang Dipersonalisasi | Mega Radio',
      description: 'Rekomendasi radio langsung yang dipersonalisasi berdasarkan stasiun favorit. Temukan musik, berita, dan radio bincang baru di 60.000+ stasiun.',
      keywords: 'radio personal, rekomendasi radio, radio untuk kamu, pilihan kustom, mega radio untuk kamu',
    },
    stations: {
      title: 'Semua Stasiun Radio — Telusuri 60.000+ Stasiun Langsung | Mega Radio',
      description: 'Telusuri direktori lengkap Mega Radio dengan 60.000+ stasiun radio langsung gratis dari 120+ negara. Filter berdasarkan genre, negara, dan bahasa.',
      keywords: 'semua stasiun radio, direktori radio online, radio langsung, radio gratis, radio internet',
    },
  },
  vi: {
    users: {
      title: 'Cộng Đồng Mega Radio — Khám Phá Người Nghe và Người Tuyển Chọn',
      description: 'Tham gia cộng đồng Mega Radio: khám phá người nghe, theo dõi người tuyển chọn và khám phá các đài phát thanh trực tiếp yêu thích từ hơn 120 quốc gia.',
      keywords: 'cộng đồng radio, người nghe radio, người dùng mega radio, radio xã hội, theo dõi người tuyển chọn',
    },
    recommendations: {
      title: 'Dành Cho Bạn — Đề Xuất Radio Trực Tiếp Cá Nhân Hóa | Mega Radio',
      description: 'Đề xuất radio trực tiếp cá nhân hóa dựa trên các đài bạn yêu thích. Khám phá nhạc mới, tin tức và radio trò chuyện từ hơn 60.000 đài.',
      keywords: 'radio cá nhân hóa, đề xuất radio, radio cho bạn, lựa chọn tùy chỉnh, mega radio cho bạn',
    },
    stations: {
      title: 'Tất Cả Đài Radio — Duyệt Hơn 60.000 Đài Trực Tiếp | Mega Radio',
      description: 'Duyệt thư mục đầy đủ của Mega Radio với hơn 60.000 đài radio trực tiếp miễn phí từ hơn 120 quốc gia. Lọc theo thể loại, quốc gia và ngôn ngữ.',
      keywords: 'tất cả đài radio, thư mục radio trực tuyến, radio trực tiếp, radio miễn phí, radio internet',
    },
  },
  th: {
    users: {
      title: 'ชุมชน Mega Radio — ค้นพบผู้ฟังและผู้คัดสรร',
      description: 'เข้าร่วมชุมชน Mega Radio: ค้นพบผู้ฟัง ติดตามผู้คัดสรร และสำรวจสถานีวิทยุสดที่พวกเขาชื่นชอบจากกว่า 120 ประเทศ',
      keywords: 'ชุมชนวิทยุ, ผู้ฟังวิทยุ, ผู้ใช้ mega radio, วิทยุสังคม, ติดตามผู้คัดสรร',
    },
    recommendations: {
      title: 'สำหรับคุณ — คำแนะนำวิทยุสดส่วนบุคคล | Mega Radio',
      description: 'คำแนะนำวิทยุสดส่วนบุคคลตามสถานีที่คุณชื่นชอบ ค้นพบเพลง ข่าว และวิทยุพูดคุยใหม่จากกว่า 60,000 สถานี',
      keywords: 'วิทยุส่วนบุคคล, คำแนะนำวิทยุ, วิทยุสำหรับคุณ, ตัวเลือกที่ปรับแต่ง, mega radio สำหรับคุณ',
    },
    stations: {
      title: 'สถานีวิทยุทั้งหมด — เลือกดู 60,000+ สถานีสด | Mega Radio',
      description: 'เลือกดูไดเรกทอรีทั้งหมดของ Mega Radio ที่มีสถานีวิทยุสดฟรีกว่า 60,000 สถานีจาก 120+ ประเทศ กรองตามแนวเพลง ประเทศ และภาษา',
      keywords: 'สถานีวิทยุทั้งหมด, ไดเรกทอรีวิทยุออนไลน์, วิทยุสด, วิทยุฟรี, วิทยุอินเทอร์เน็ต',
    },
  },
  el: {
    users: {
      title: 'Κοινότητα Mega Radio — Ανακαλύψτε Ακροατές και Επιμελητές',
      description: 'Συμμετάσχετε στην κοινότητα Mega Radio: ανακαλύψτε ακροατές, ακολουθήστε επιμελητές και εξερευνήστε αγαπημένους ζωντανούς σταθμούς από 120+ χώρες.',
      keywords: 'κοινότητα ραδιοφώνου, ακροατές ραδιοφώνου, χρήστες mega radio, κοινωνικό ραδιόφωνο, παρακολούθηση επιμελητών',
    },
    recommendations: {
      title: 'Για Εσάς — Εξατομικευμένες Προτάσεις Ζωντανού Ραδιοφώνου | Mega Radio',
      description: 'Εξατομικευμένες προτάσεις ζωντανού ραδιοφώνου με βάση τους αγαπημένους σας σταθμούς. Ανακαλύψτε νέα μουσική, ειδήσεις και talk radio από 60.000+ σταθμούς.',
      keywords: 'εξατομικευμένο ραδιόφωνο, προτάσεις ραδιοφώνου, ραδιόφωνο για εσάς, προσαρμοσμένες επιλογές, mega radio για εσάς',
    },
    stations: {
      title: 'Όλοι οι Ραδιοφωνικοί Σταθμοί — Δείτε 60.000+ Ζωντανούς Σταθμούς | Mega Radio',
      description: 'Περιηγηθείτε στον πλήρη κατάλογο του Mega Radio με 60.000+ δωρεάν ζωντανούς ραδιοφωνικούς σταθμούς από 120+ χώρες. Φιλτράρετε ανά είδος, χώρα και γλώσσα.',
      keywords: 'όλοι οι σταθμοί ραδιοφώνου, online κατάλογος ραδιοφώνου, ζωντανό ραδιόφωνο, δωρεάν ραδιόφωνο, ραδιόφωνο internet',
    },
  },
  cs: {
    users: {
      title: 'Komunita Mega Radio — Objevte Posluchače a Kurátory',
      description: 'Připojte se ke komunitě Mega Radio: objevujte posluchače, sledujte kurátory a prozkoumejte jejich oblíbené živé radiové stanice ze 120+ zemí.',
      keywords: 'komunita rádia, posluchači rádia, uživatelé mega radio, sociální rádio, sledovat kurátory',
    },
    recommendations: {
      title: 'Pro Vás — Osobní Doporučení Živého Rádia | Mega Radio',
      description: 'Osobní doporučení živého rádia podle vašich oblíbených stanic. Objevujte novou hudbu, zprávy a talk rádio na 60 000+ stanicích.',
      keywords: 'osobní rádio, doporučení rádia, rádio pro vás, vlastní výběr, mega radio pro vás',
    },
    stations: {
      title: 'Všechny Rádiové Stanice — Procházejte 60 000+ Živých Stanic | Mega Radio',
      description: 'Procházejte kompletní katalog Mega Radio s 60 000+ bezplatnými živými rádiovými stanicemi ze 120+ zemí. Filtrujte podle žánru, země a jazyka.',
      keywords: 'všechny rádiové stanice, online katalog rádia, živé rádio, bezplatné rádio, internetové rádio',
    },
  },
  hu: {
    users: {
      title: 'Mega Radio Közösség — Fedezz fel Hallgatókat és Kurátorokat',
      description: 'Csatlakozz a Mega Radio közösséghez: fedezz fel hallgatókat, kövess kurátorokat és fedezd fel kedvenc élő rádióállomásaikat 120+ országból.',
      keywords: 'rádió közösség, rádió hallgatók, mega radio felhasználók, közösségi rádió, kurátorok követése',
    },
    recommendations: {
      title: 'Neked — Személyre Szabott Élő Rádió Ajánlatok | Mega Radio',
      description: 'Személyre szabott élő rádió ajánlatok kedvenc állomásaid alapján. Fedezz fel új zenét, híreket és talk rádiót 60.000+ állomásból.',
      keywords: 'személyre szabott rádió, rádió ajánlatok, rádió neked, egyedi rádió válogatás, mega radio neked',
    },
    stations: {
      title: 'Összes Rádióállomás — Böngéssz 60.000+ Élő Állomás Között | Mega Radio',
      description: 'Böngéssz a Mega Radio teljes katalógusában: 60.000+ ingyenes élő rádióállomás 120+ országból. Szűrj műfaj, ország és nyelv szerint.',
      keywords: 'összes rádióállomás, online rádió katalógus, élő rádió, ingyenes rádió, internet rádió',
    },
  },
  ro: {
    users: {
      title: 'Comunitatea Mega Radio — Descoperă Ascultători și Curatori',
      description: 'Alătură-te comunității Mega Radio: descoperă ascultători, urmărește curatori și explorează posturile lor de radio live preferate din 120+ țări.',
      keywords: 'comunitate radio, ascultători radio, utilizatori mega radio, radio social, urmărește curatori',
    },
    recommendations: {
      title: 'Pentru Tine — Recomandări Radio Live Personalizate | Mega Radio',
      description: 'Recomandări radio live personalizate pe baza posturilor tale preferate. Descoperă muzică, știri și radio de tip talk pe 60.000+ posturi.',
      keywords: 'radio personalizat, recomandări radio, radio pentru tine, selecții personalizate, mega radio pentru tine',
    },
    stations: {
      title: 'Toate Posturile de Radio — Răsfoiește 60.000+ Posturi Live | Mega Radio',
      description: 'Răsfoiește directorul complet Mega Radio cu 60.000+ posturi de radio live gratuite din 120+ țări. Filtrează după gen, țară și limbă.',
      keywords: 'toate posturile radio, director radio online, radio live, radio gratuit, radio internet',
    },
  },
  sv: {
    users: {
      title: 'Mega Radio Community — Upptäck Lyssnare och Kuratorer',
      description: 'Gå med i Mega Radio-communityn: upptäck lyssnare, följ kuratorer och utforska deras favoritradiokanaler live från 120+ länder.',
      keywords: 'radio community, radiolyssnare, mega radio användare, social radio, följ kuratorer',
    },
    recommendations: {
      title: 'För Dig — Personliga Live Radio-Rekommendationer | Mega Radio',
      description: 'Personliga live radio-rekommendationer baserade på dina favoritkanaler. Upptäck ny musik, nyheter och talkradio på 60 000+ kanaler.',
      keywords: 'personlig radio, radiorekommendationer, radio för dig, anpassade val, mega radio för dig',
    },
    stations: {
      title: 'Alla Radiokanaler — Bläddra Bland 60 000+ Live-Kanaler | Mega Radio',
      description: 'Bläddra i hela Mega Radios katalog med 60 000+ kostnadsfria live radiokanaler från 120+ länder. Filtrera efter genre, land och språk.',
      keywords: 'alla radiokanaler, online radiokatalog, livesändning radio, gratis radio, internetradio',
    },
  },
  he: {
    users: {
      title: 'קהילת Mega Radio — גלו מאזינים ואוצרים',
      description: 'הצטרפו לקהילת Mega Radio: גלו מאזינים, עקבו אחרי אוצרים וחקרו את תחנות הרדיו החיות האהובות עליהם מ-120+ מדינות.',
      keywords: 'קהילת רדיו, מאזיני רדיו, משתמשי mega radio, רדיו חברתי, עקוב אוצרים',
    },
    recommendations: {
      title: 'בשבילך — המלצות רדיו חי מותאמות אישית | Mega Radio',
      description: 'המלצות רדיו חי מותאמות אישית על סמך התחנות שאתם אוהבים. גלו מוזיקה, חדשות ורדיו טוק חדשים מ-60,000+ תחנות.',
      keywords: 'רדיו מותאם אישית, המלצות רדיו, רדיו בשבילך, בחירות מותאמות, mega radio בשבילך',
    },
    stations: {
      title: 'כל תחנות הרדיו — עיינו ב-60,000+ תחנות חיות | Mega Radio',
      description: 'עיינו במדריך המלא של Mega Radio עם 60,000+ תחנות רדיו חיות חינמיות מ-120+ מדינות. סננו לפי ז\'אנר, מדינה ושפה.',
      keywords: 'כל תחנות הרדיו, מדריך רדיו אונליין, רדיו חי, רדיו חינמי, רדיו אינטרנט',
    },
  },
  uk: {
    users: {
      title: 'Спільнота Mega Radio — Відкрийте Слухачів і Кураторів',
      description: 'Приєднуйтесь до спільноти Mega Radio: відкривайте слухачів, підписуйтесь на кураторів та досліджуйте їх улюблені радіостанції зі 120+ країн.',
      keywords: 'спільнота радіо, слухачі радіо, користувачі mega radio, соціальне радіо, підписатись на кураторів',
    },
    recommendations: {
      title: 'Для Вас — Персональні Рекомендації Живого Радіо | Mega Radio',
      description: 'Персональні рекомендації живого радіо на основі ваших улюблених станцій. Відкривайте нову музику, новини та ток-радіо з 60 000+ станцій.',
      keywords: 'персональне радіо, рекомендації радіо, радіо для вас, індивідуальні підбірки, mega radio для вас',
    },
    stations: {
      title: 'Усі Радіостанції — Огляд 60 000+ Живих Станцій | Mega Radio',
      description: 'Перегляньте повний каталог Mega Radio: 60 000+ безкоштовних радіостанцій у прямому ефірі зі 120+ країн. Фільтруйте за жанром, країною та мовою.',
      keywords: 'усі радіостанції, онлайн каталог радіо, живе радіо, безкоштовне радіо, інтернет радіо',
    },
  },
};

/**
 * Returns the per-language template for the requested language. Falls
 * back to English when the language is not yet covered. Mirrors
 * getStaticPageSeoTemplate exactly.
 */
export function getCommunityPageSeoTemplate(language: string): CommunityPageSeoTemplate {
  return COMMUNITY_PAGE_SEO_TEMPLATES[language] || COMMUNITY_PAGE_SEO_TEMPLATES.en;
}

// Word-boundary safe truncation. Mirrors static-page-seo-templates clampGraphemes.
function clampGraphemes(text: string, maxChars: number): string {
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const seg = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
    let out = '';
    for (const { segment } of seg.segment(text) as Iterable<{ segment: string }>) {
      if (out.length + segment.length > maxChars) break;
      out += segment;
    }
    return out;
  }
  let out = '';
  for (const ch of Array.from(text)) {
    if (out.length + ch.length > maxChars) break;
    out += ch;
  }
  return out;
}

const DB_KEYS: Record<CommunityPageKind, { title: string; description: string }> = {
  users: {
    title: 'users_page_title',
    description: 'users_page_description',
  },
  recommendations: {
    title: 'recommendations_page_title',
    description: 'recommendations_page_description',
  },
  stations: {
    title: 'stations_page_title',
    description: 'stations_page_description',
  },
};

/**
 * Builds title/description/keywords for the Users, Recommendations or
 * Stations directory page in the given language.
 *
 * If `dbTranslations` provides the corresponding DB keys IN THE
 * REQUESTED LANGUAGE, they take precedence — otherwise we fall back to
 * the per-language template so we never serve a Turkish page with an
 * English `<title>` (the Site Audit duplicate-meta regression that
 * triggered this template).
 *
 * Defensive: enforces a 145-character maximum description length.
 */
export function buildCommunityPageSeo(
  pageType: CommunityPageKind,
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string; keywords: string } {
  const tpl = getCommunityPageSeoTemplate(language)[pageType];

  const keys = DB_KEYS[pageType];
  const dbTitle = dbTranslations?.[keys.title]?.trim();
  const dbDescription = dbTranslations?.[keys.description]?.trim();

  const title = dbTitle || tpl.title;
  let description = dbDescription || tpl.description;

  if (description.length > 145) {
    const cutoff = description.lastIndexOf(' ', 142);
    if (cutoff > 100) {
      description = description.slice(0, cutoff) + '...';
    } else {
      description = clampGraphemes(description, 142) + '...';
    }
  }

  return { title, description, keywords: tpl.keywords || '' };
}
