import {genreDescriptionLabels} from './genreDescriptionLabels';
/** Localized labels never replace canonical catalogue slugs or cached data. */
const keys = 'pop|rock|jazz|classical|electronic|dance|hip-hop|rap|r-b|soul|funk|reggae|metal|punk|indie|alternative|folk|latin|world|ambient|chill|lounge|easy-listening|oldies|classics|hits|variety|instrumental|acoustic|soundtrack|news|talk|sports|kids|religious|turkish-folk|turkish-pop|arabesk|country|blues|relax|slow|classic-rock|hard-rock|soft-rock|heavy-metal|christmas|gospel|public-radio|college-radio|audiobooks|comedy|education|culture'.split('|');

const rows: Record<string, string> = {
 en: 'Pop|Rock|Jazz|Classical|Electronic|Dance|Hip-hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indie|Alternative|Folk|Latin|World music|Ambient|Chill|Lounge|Easy listening|Oldies|Classics|Hits|Variety|Instrumental|Acoustic|Soundtracks|News|Talk|Sports|Kids|Religions|Turkish folk|Turkish pop|Arabesk|Country|Blues|Relaxation|Slow music|Classic rock|Hard rock|Soft rock|Heavy metal|Christmas|Gospel|Public radio|College radio|Audiobooks|Comedy|Education|Culture',
 tr: 'Pop|Rock|Caz|Klasik|Elektronik|Dans|Hip-hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indie|Alternatif|Halk müziği|Latin|Dünya müziği|Ambiyans|Sakin müzik|Lounge|Hafif müzik|Nostalji|Klasikler|Hit müzik|Karma|Enstrümantal|Akustik|Film müzikleri|Haberler|Sohbet|Spor|Çocuk|Dini Yayınlar|Türkü|Türkçe pop|Arabesk|Country|Blues|Rahatlatıcı müzik|Slow müzik|Klasik rock|Hard rock|Soft rock|Heavy metal|Noel|Gospel|Kamu radyosu|Üniversite radyosu|Sesli kitaplar|Komedi|Eğitim|Kültür',
 de: 'Pop|Rock|Jazz|Klassik|Elektronisch|Dance|Hip-Hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indie|Alternative|Volksmusik|Latin|Weltmusik|Ambient|Chill|Lounge|Leichte Musik|Oldies|Klassiker|Hits|Gemischt|Instrumental|Akustisch|Filmmusik|Nachrichten|Talk|Sport|Kinder|Religion|Türkische Volksmusik|Türkischer Pop|Arabesk|Country|Blues|Entspannung|Ruhige Musik|Classic Rock|Hardrock|Softrock|Heavy Metal|Weihnachten|Gospel|Öffentliches Radio|Hochschulradio|Hörbücher|Comedy|Bildung|Kultur',
 fr: 'Pop|Rock|Jazz|Classique|Électronique|Dance|Hip-hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indé|Alternatif|Folk|Latino|Musiques du monde|Ambient|Chill|Lounge|Musique douce|Rétro|Classiques|Hits|Variétés|Instrumental|Acoustique|Musiques de films|Actualités|Débats|Sport|Enfants|Radios religieuses|Folk turc|Pop turque|Arabesk|Country|Blues|Relaxation|Musique lente|Rock classique|Hard rock|Soft rock|Heavy metal|Noël|Gospel|Radio publique|Radio universitaire|Livres audio|Humour|Éducation|Culture',
 es: 'Pop|Rock|Jazz|Clásica|Electrónica|Dance|Hip-hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indie|Alternativa|Folk|Latina|Música del mundo|Ambient|Chill|Lounge|Música suave|Éxitos de ayer|Clásicos|Éxitos|Variedades|Instrumental|Acústica|Bandas sonoras|Noticias|Conversación|Deportes|Infantil|Radios religiosas|Folk turco|Pop turco|Arabesk|Country|Blues|Relajación|Música lenta|Rock clásico|Hard rock|Rock suave|Heavy metal|Navidad|Góspel|Radio pública|Radio universitaria|Audiolibros|Comedia|Educación|Cultura',
 it: 'Pop|Rock|Jazz|Classica|Elettronica|Dance|Hip-hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indie|Alternativa|Folk|Latina|Musica dal mondo|Ambient|Chill|Lounge|Musica leggera|Successi del passato|Classici|Successi|Varietà|Strumentale|Acustica|Colonne sonore|Notizie|Conversazione|Sport|Bambini|Radio religiose|Folk turco|Pop turco|Arabesk|Country|Blues|Relax|Musica lenta|Rock classico|Hard rock|Soft rock|Heavy metal|Natale|Gospel|Radio pubblica|Radio universitaria|Audiolibri|Comicità|Istruzione|Cultura',
 pt: 'Pop|Rock|Jazz|Clássica|Eletrónica|Dance|Hip-hop|Rap|R&B|Soul|Funk|Reggae|Metal|Punk|Indie|Alternativa|Folk|Latina|Música do mundo|Ambient|Chill|Lounge|Música suave|Sucessos antigos|Clássicos|Sucessos|Variedades|Instrumental|Acústica|Bandas sonoras|Notícias|Conversa|Desporto|Infantil|Rádios religiosas|Folk turco|Pop turco|Arabesk|Country|Blues|Relaxamento|Música lenta|Rock clássico|Hard rock|Soft rock|Heavy metal|Natal|Gospel|Rádio pública|Rádio universitária|Audiolivros|Comédia|Educação|Cultura',
 hi: 'पॉप|रॉक|जैज़|शास्त्रीय|इलेक्ट्रॉनिक|डांस|हिप-हॉप|रैप|आर एंड बी|सोल|फंक|रेगे|मेटल|पंक|इंडी|वैकल्पिक|लोक संगीत|लैटिन|विश्व संगीत|ऐम्बिएंट|सुकून भरा संगीत|लाउंज|हल्का संगीत|पुराने गीत|सदाबहार|हिट गीत|विविध|वाद्य संगीत|अकूस्टिक|फ़िल्म संगीत|समाचार|बातचीत|खेल|बच्चों के लिए|धार्मिक रेडियो|तुर्की लोक संगीत|तुर्की पॉप|अरबेस्क|कंट्री|ब्लूज़|विश्राम संगीत|धीमा संगीत|क्लासिक रॉक|हार्ड रॉक|सॉफ्ट रॉक|हेवी मेटल|क्रिसमस|गॉस्पेल|सार्वजनिक रेडियो|विश्वविद्यालय रेडियो|ऑडियोबुक|हास्य|शिक्षा|संस्कृति',
 he: 'פופ|רוק|ג׳אז|קלאסי|אלקטרוני|דאנס|היפ הופ|ראפ|אר אנד בי|סול|פאנק|רגאיי|מטאל|פאנק רוק|אינדי|אלטרנטיבי|פולק|לטיני|מוזיקת עולם|אמביינט|מוזיקה רגועה|לאונג׳|מוזיקה קלה|להיטי עבר|קלאסיקות|להיטים|מגוון|אינסטרומנטלי|אקוסטי|פסקולים|חדשות|שיחות|ספורט|ילדים|רדיו דתי|פולק טורקי|פופ טורקי|ערבסק|קאנטרי|בלוז|מוזיקה להרפיה|מוזיקה איטית|רוק קלאסי|הארד רוק|רוק רך|הבי מטאל|חג המולד|גוספל|רדיו ציבורי|רדיו אוניברסיטאי|ספרי שמע|קומדיה|חינוך|תרבות',
 ru: 'Поп|Рок|Джаз|Классика|Электронная музыка|Танцевальная|Хип-хоп|Рэп|R&B|Соул|Фанк|Регги|Метал|Панк|Инди|Альтернатива|Народная музыка|Латино|Музыка мира|Эмбиент|Чилл|Лаунж|Лёгкая музыка|Ретро|Классические хиты|Хиты|Разное|Инструментальная|Акустика|Саундтреки|Новости|Разговорное радио|Спорт|Детское|Религиозное радио|Турецкая народная музыка|Турецкая поп-музыка|Арабеск|Кантри|Блюз|Релакс|Медленная музыка|Классический рок|Хард-рок|Софт-рок|Хеви-метал|Рождество|Госпел|Общественное радио|Студенческое радио|Аудиокниги|Юмор|Образование|Культура',
 ja: 'ポップ|ロック|ジャズ|クラシック|エレクトロニック|ダンス|ヒップホップ|ラップ|R&B|ソウル|ファンク|レゲエ|メタル|パンク|インディー|オルタナティブ|フォーク|ラテン|ワールドミュージック|アンビエント|チル|ラウンジ|イージーリスニング|オールディーズ|名曲|ヒット曲|バラエティ|インストゥルメンタル|アコースティック|サウンドトラック|ニュース|トーク|スポーツ|キッズ|宗教放送|トルコ民謡|トルコポップ|アラベスク|カントリー|ブルース|リラックス|スローミュージック|クラシックロック|ハードロック|ソフトロック|ヘヴィメタル|クリスマス|ゴスペル|公共ラジオ|大学ラジオ|オーディオブック|コメディ|教育|文化',
 ko: '팝|록|재즈|클래식|일렉트로닉|댄스|힙합|랩|R&B|소울|펑크|레게|메탈|펑크 록|인디|얼터너티브|포크|라틴|월드 뮤직|앰비언트|칠|라운지|이지 리스닝|추억의 음악|명곡|히트곡|다양한 음악|연주곡|어쿠스틱|영화 음악|뉴스|토크|스포츠|어린이|종교 방송|튀르키예 민요|튀르키예 팝|아라베스크|컨트리|블루스|휴식 음악|느린 음악|클래식 록|하드 록|소프트 록|헤비 메탈|크리스마스|가스펠|공영 라디오|대학 라디오|오디오북|코미디|교육|문화',
 zh: '流行|摇滚|爵士|古典|电子|舞曲|嘻哈|说唱|节奏布鲁斯|灵魂乐|放克|雷鬼|金属|朋克|独立音乐|另类音乐|民谣|拉丁|世界音乐|氛围音乐|舒缓音乐|沙发音乐|轻音乐|怀旧金曲|经典|热门金曲|综合|器乐|原声|电影原声|新闻|谈话|体育|儿童|宗教广播|土耳其民谣|土耳其流行|阿拉贝斯克|乡村|布鲁斯|放松音乐|慢歌|经典摇滚|硬摇滚|软摇滚|重金属|圣诞|福音|公共广播|校园广播|有声书|喜剧|教育|文化',
 ar: 'بوب|روك|جاز|كلاسيكية|إلكترونية|رقص|هيب هوب|راب|آر أند بي|سول|فانك|ريغي|ميتال|بانك|إندي|بديلة|موسيقى شعبية|لاتينية|موسيقى عالمية|موسيقى محيطية|موسيقى هادئة|لاونج|موسيقى خفيفة|أغاني قديمة|كلاسيكيات|أغاني رائجة|منوعات|موسيقى آلية|أكوستيك|موسيقى الأفلام|أخبار|حوارات|رياضة|أطفال|إذاعات دينية|موسيقى شعبية تركية|بوب تركي|أرابيسك|كانتري|بلوز|استرخاء|موسيقى بطيئة|روك كلاسيكي|هارد روك|سوفت روك|هيفي ميتال|عيد الميلاد|غوسبل|إذاعة عامة|إذاعة جامعية|كتب صوتية|كوميديا|تعليم|ثقافة',
};

const labels = Object.fromEntries(Object.entries(rows).map(([language, row]) => [language,
 Object.fromEntries(row.split('|').map((label, index) => [keys[index], label])),
])) as Record<string, Record<string, string>>;

const aliases: Record<string, string> = {
 'folk-music':'folk', 'world-music':'world', 'classical-music':'classical', 'pop-music':'pop', 'rock-music':'rock',
 hiphop:'hip-hop', 'hip-hop-rap':'hip-hop', rnb:'r-b', 'r-and-b':'r-b', 'r&b':'r-b', 'r-n-b':'r-b',
 'talk-radio':'talk', children:'kids', religion:'religious', religions:'religious',
 relaxation:'relax', chillout:'chill', 'chill-out':'chill', audiobook:'audiobooks', college:'college-radio',
 'christmas-music':'christmas', 'gospel-music':'gospel', 'film-score':'soundtrack', soundtracks:'soundtrack',
 halk:'turkish-folk', turkishpop:'turkish-pop', 'turkce-pop':'turkish-pop',
 mixed:'variety', soccer:'football', fifties:'50s', sixties:'60s', seventies:'70s', eighties:'80s', nineties:'90s', '00s':'2000s',
};

const decadeTemplates: Record<string, (year: string) => string> = {
 en: year => `${year}s`, tr: year => `${year}'${['60','90','2010'].includes(year)?'lar':'ler'}`,
 de: year => `${year}er`, fr: year => `Années ${year}`, es: year => `Años ${year}`, it: year => `Anni ${year}`, pt: year => `Anos ${year}`,
 hi: year => `${year} के दशक`, he: year => `שנות ה־${year}`, ru: year => `${year}-е`,
 ja: year => `${year}年代`, ko: year => `${year}년대`, zh: year => `${year}年代`, ar: year => `عقد الـ${year}`,
};

// Only these established catalogue compounds use translated descriptive modifiers.
const descriptiveCompounds: Record<string, [string, string]> = {
 'classic-country':['classic','country'], 'classic-soul':['classic','soul'], 'classic-pop':['classic','pop'],
 'contemporary-classical':['contemporary','classical'], 'contemporary-jazz':['contemporary','jazz'], 'contemporary-folk':['contemporary','folk'], 'contemporary-rnb':['contemporary','r-b'],
 'modern-classical':['modern','classical'], 'modern-country':['modern','country'], 'traditional-folk':['traditional','folk'],
 'vocal-jazz':['vocal','jazz'], 'vocal-trance':['vocal','trance'],
};
const modifierLanguages = ['en','tr','de','fr','es','it','pt','hi','he','ru','ja','ko','zh','ar'];
const modifierRows: Record<string,string> = {
 classic:'Classic {genre}|Klasik {genre}|Klassischer {genre}|{genre} classique|{genre} clásico|{genre} classico|{genre} clássico|क्लासिक {genre}|{genre} קלאסי|Классический {genre}|クラシック{genre}|클래식 {genre}|经典{genre}|{genre} كلاسيكية',
 contemporary:'Contemporary {genre}|Çağdaş {genre}|Zeitgenössischer {genre}|{genre} contemporain|{genre} contemporáneo|{genre} contemporaneo|{genre} contemporâneo|समकालीन {genre}|{genre} עכשווי|Современный {genre}|現代{genre}|현대 {genre}|当代{genre}|{genre} معاصرة',
 modern:'Modern {genre}|Modern {genre}|Moderner {genre}|{genre} moderne|{genre} moderno|{genre} moderno|{genre} moderno|आधुनिक {genre}|{genre} מודרני|Современный {genre}|モダン{genre}|모던 {genre}|现代{genre}|{genre} حديثة',
 traditional:'Traditional {genre}|Geleneksel {genre}|Traditionelle {genre}|{genre} traditionnel|{genre} tradicional|{genre} tradizionale|{genre} tradicional|पारंपरिक {genre}|{genre} מסורתי|Традиционный {genre}|伝統{genre}|전통 {genre}|传统{genre}|{genre} تقليدية',
 vocal:'Vocal {genre}|Vokal {genre}|Vokal-{genre}|{genre} vocal|{genre} vocal|{genre} vocale|{genre} vocal|वोकल {genre}|{genre} קולי|Вокальный {genre}|ボーカル{genre}|보컬 {genre}|人声{genre}|{genre} غنائية',
};

export function genreDisplayLanguage(language: string = 'en'): string {
 return language.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
}

export function genreDisplayName(genre: {slug?: string | null; name?: string | null}, language: string = 'en'): string {
 const raw = genre.name?.trim() || genre.slug?.trim() || '';
 const slug = (genre.slug || raw).trim().toLowerCase().replace(/[\s_]+/g, '-');
 const key = aliases[slug] || slug;
 const locale = genreDisplayLanguage(language);
 const names = labels[locale] || labels.en;
 const decade = /^(50|60|70|80|90|2000|2010|2020)s$/.exec(key);
 if(decade)return (decadeTemplates[locale] || decadeTemplates.en)(decade[1]);
 const description = genreDescriptionLabels[locale]?.[key] || (!labels[locale] ? genreDescriptionLabels.en[key] : undefined);
 if(description)return description;
 const compound = descriptiveCompounds[key];
 if(compound){
  const [modifier,base] = compound;
  const index = Math.max(0,modifierLanguages.indexOf(locale));
  return modifierRows[modifier].split('|')[index].replace('{genre}',names[base] || base[0].toUpperCase()+base.slice(1));
 }
 // Niche names and proper names retain the server's spelling.
 return names[key] || raw;
}

const localizedSearchNames = new Map<string, Map<string, string>>();

/** Translate complete displayed names back to existing API search terms; prefixes remain untouched. */
export function genreSearchQuery(query: string, language: string = 'en'): string {
 const requestedLocale = genreDisplayLanguage(language);
 const locale = labels[requestedLocale] ? requestedLocale : 'en';
 if(locale === 'en')return query;
 const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase(locale);
 let names = localizedSearchNames.get(locale);
 if(!names){
  names = new Map<string, string>();
  const slugs = new Set([...keys, ...Object.keys(genreDescriptionLabels[locale] || {}),
   ...Object.keys(descriptiveCompounds), ...['50','60','70','80','90','2000','2010','2020'].map(year => `${year}s`)]);
  for(const slug of slugs){
   const translated = normalize(genreDisplayName({slug}, locale));
   // Ordinary raw English names/slugs retain the existing search and cache behaviour.
   if(translated !== normalize(slug) && translated !== normalize(genreDisplayName({slug}, 'en'))){
    names.set(translated, slug);
   }
  }
  localizedSearchNames.set(locale, names);
 }
 return names.get(normalize(query)) || query;
}
