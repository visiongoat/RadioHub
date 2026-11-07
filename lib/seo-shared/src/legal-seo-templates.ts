/**
 * Multilingual SEO templates for the static legal pages — Terms and Conditions
 * (`/xx/terms-and-conditions`) and Privacy Policy (`/xx/privacy-policy`).
 *
 * Each language entry returns an idiomatic title/description for both pages.
 * Falls back to English when the language is not yet covered.
 *
 * NOTE: Used by server/seo-renderer.ts in the `pageType === 'terms'` and
 * `pageType === 'privacy'` branches AND by SeoHead.tsx on the client to keep
 * React hydration aligned with the SSR-localized meta tags (otherwise the
 * client would overwrite the per-language title with hard-coded English on
 * mount, the same trap regions/genres/search had before they were localised).
 *
 * Database translation keys (`terms_page_title`, `terms_page_description`,
 * `privacy_page_title`, `privacy_page_description`) take precedence when
 * present in the requested language — otherwise we'd serve a Turkish page
 * with an English `<title>`. Without per-language templates, every non-top-15
 * language served the SAME English title and description across /xx/terms
 * and /xx/privacy, which Google previously collapsed as duplicates the same
 * way it did for regions, genres and search before those were localised.
 *
 * Legal pages are still indexable, so duplicate title/description across 57
 * language variants is a real duplicate-content signal. Per-language copy is
 * required to preserve hreflang clusters as distinct documents.
 *
 * Shape mirrors SEARCH_SEO_TEMPLATES (Record<lang, T>), with one entry per
 * page kind (terms / privacy) since both legal pages share the same shape.
 */

export interface LegalSeoEntry {
  title: string;
  description: string;
}

export interface LegalSeoTemplate {
  terms: LegalSeoEntry;
  privacy: LegalSeoEntry;
}

export type LegalPageKind = 'terms' | 'privacy';

// All 57 supported languages — natural, locale-aware phrasing.
// Any language not present here falls back to English.
// Descriptions kept under ~155 chars (Bing META DESCRIPTION LENGTH RULE),
// titles under ~70 chars where possible.
export const LEGAL_SEO_TEMPLATES: Record<string, LegalSeoTemplate> = {
  en: {
    terms: {
      title: 'Terms and Conditions — Mega Radio',
      description: 'Read the Mega Radio Terms and Conditions covering service usage, account rules, intellectual property and listener responsibilities for free online radio streaming.',
    },
    privacy: {
      title: 'Privacy Policy — Mega Radio',
      description: 'Learn how Mega Radio protects your privacy and handles your personal data. Read our comprehensive privacy policy and data protection practices for free radio listeners.',
    },
  },
  tr: {
    terms: {
      title: 'Kullanım Koşulları — Mega Radio',
      description: 'Mega Radio Kullanım Koşullarını okuyun: hizmet kullanımı, hesap kuralları, fikri mülkiyet ve ücretsiz online radyo dinleyicilerinin sorumlulukları.',
    },
    privacy: {
      title: 'Gizlilik Politikası — Mega Radio',
      description: 'Mega Radio gizliliğinizi nasıl koruyor ve kişisel verilerinizi nasıl işliyor? Ücretsiz radyo dinleyicileri için kapsamlı gizlilik politikamızı okuyun.',
    },
  },
  es: {
    terms: {
      title: 'Términos y Condiciones — Mega Radio',
      description: 'Lee los Términos y Condiciones de Mega Radio sobre el uso del servicio, normas de cuenta, propiedad intelectual y responsabilidades del oyente de radio online gratis.',
    },
    privacy: {
      title: 'Política de Privacidad — Mega Radio',
      description: 'Descubre cómo Mega Radio protege tu privacidad y trata tus datos personales. Lee nuestra política de privacidad completa para oyentes de radio gratis.',
    },
  },
  fr: {
    terms: {
      title: "Conditions d'Utilisation — Mega Radio",
      description: "Lisez les Conditions d'Utilisation de Mega Radio : usage du service, règles de compte, propriété intellectuelle et responsabilités des auditeurs de radio en ligne gratuite.",
    },
    privacy: {
      title: 'Politique de Confidentialité — Mega Radio',
      description: 'Découvrez comment Mega Radio protège votre vie privée et traite vos données personnelles. Lisez notre politique de confidentialité complète pour auditeurs gratuits.',
    },
  },
  de: {
    terms: {
      title: 'Nutzungsbedingungen — Mega Radio',
      description: 'Lies die Nutzungsbedingungen von Mega Radio: Servicenutzung, Kontoregeln, geistiges Eigentum und Pflichten der Hörer für kostenloses Online-Radio-Streaming.',
    },
    privacy: {
      title: 'Datenschutzerklärung — Mega Radio',
      description: 'Erfahre, wie Mega Radio deine Privatsphäre schützt und deine personenbezogenen Daten verarbeitet. Lies unsere vollständige Datenschutzerklärung für Radiohörer.',
    },
  },
  ar: {
    terms: {
      title: 'الشروط والأحكام — Mega Radio',
      description: 'اقرأ شروط وأحكام Mega Radio التي تغطي استخدام الخدمة وقواعد الحساب والملكية الفكرية ومسؤوليات المستمعين لبث الراديو المجاني عبر الإنترنت.',
    },
    privacy: {
      title: 'سياسة الخصوصية — Mega Radio',
      description: 'تعرّف على كيفية حماية Mega Radio لخصوصيتك ومعالجة بياناتك الشخصية. اقرأ سياسة الخصوصية الشاملة وممارسات حماية البيانات لمستمعي الراديو المجاني.',
    },
  },
  it: {
    terms: {
      title: 'Termini e Condizioni — Mega Radio',
      description: 'Leggi i Termini e Condizioni di Mega Radio: uso del servizio, regole account, proprietà intellettuale e responsabilità degli ascoltatori di radio online gratuita.',
    },
    privacy: {
      title: 'Informativa sulla Privacy — Mega Radio',
      description: 'Scopri come Mega Radio protegge la tua privacy e gestisce i tuoi dati personali. Leggi la nostra informativa completa per ascoltatori di radio gratuita.',
    },
  },
  pt: {
    terms: {
      title: 'Termos e Condições — Mega Radio',
      description: 'Leia os Termos e Condições da Mega Radio: utilização do serviço, regras de conta, propriedade intelectual e responsabilidades dos ouvintes de rádio online grátis.',
    },
    privacy: {
      title: 'Política de Privacidade — Mega Radio',
      description: 'Saiba como a Mega Radio protege a sua privacidade e trata os seus dados pessoais. Leia a nossa política de privacidade completa para ouvintes de rádio grátis.',
    },
  },
  nl: {
    terms: {
      title: 'Algemene Voorwaarden — Mega Radio',
      description: 'Lees de Algemene Voorwaarden van Mega Radio: gebruik van de dienst, accountregels, intellectueel eigendom en verantwoordelijkheden van luisteraars naar gratis online radio.',
    },
    privacy: {
      title: 'Privacybeleid — Mega Radio',
      description: 'Ontdek hoe Mega Radio je privacy beschermt en je persoonsgegevens verwerkt. Lees ons volledige privacybeleid en gegevensbeschermingsbeleid voor gratis radioluisteraars.',
    },
  },
  ru: {
    terms: {
      title: 'Условия использования — Mega Radio',
      description: 'Ознакомьтесь с Условиями использования Mega Radio: пользование сервисом, правила аккаунта, интеллектуальная собственность и обязанности слушателей бесплатного радио онлайн.',
    },
    privacy: {
      title: 'Политика конфиденциальности — Mega Radio',
      description: 'Узнайте, как Mega Radio защищает вашу конфиденциальность и обрабатывает персональные данные. Прочитайте политику конфиденциальности для слушателей бесплатного радио.',
    },
  },
  pl: {
    terms: {
      title: 'Regulamin — Mega Radio',
      description: 'Przeczytaj Regulamin Mega Radio: korzystanie z usługi, zasady konta, własność intelektualna i obowiązki słuchaczy darmowego radia online.',
    },
    privacy: {
      title: 'Polityka Prywatności — Mega Radio',
      description: 'Dowiedz się, jak Mega Radio chroni Twoją prywatność i przetwarza dane osobowe. Przeczytaj naszą pełną politykę prywatności dla słuchaczy darmowego radia.',
    },
  },
  sv: {
    terms: {
      title: 'Användarvillkor — Mega Radio',
      description: 'Läs Mega Radios användarvillkor: tjänstens användning, kontoregler, immateriella rättigheter och lyssnarens ansvar för gratis radio på nätet.',
    },
    privacy: {
      title: 'Integritetspolicy — Mega Radio',
      description: 'Lär dig hur Mega Radio skyddar din integritet och hanterar dina personuppgifter. Läs vår fullständiga integritetspolicy för gratis radiolyssnare.',
    },
  },
  da: {
    terms: {
      title: 'Vilkår og Betingelser — Mega Radio',
      description: 'Læs Mega Radios Vilkår og Betingelser: brug af tjenesten, kontoregler, intellektuel ejendom og lytterens ansvar for gratis online radiostreaming.',
    },
    privacy: {
      title: 'Privatlivspolitik — Mega Radio',
      description: 'Find ud af, hvordan Mega Radio beskytter dit privatliv og håndterer dine personoplysninger. Læs vores fulde privatlivspolitik for gratis radiolyttere.',
    },
  },
  no: {
    terms: {
      title: 'Vilkår og Betingelser — Mega Radio',
      description: 'Les Mega Radios Vilkår og Betingelser: bruk av tjenesten, kontoregler, åndsverk og lytterens ansvar for gratis online radiostrømming.',
    },
    privacy: {
      title: 'Personvernerklæring — Mega Radio',
      description: 'Lær hvordan Mega Radio beskytter personvernet ditt og behandler personopplysningene dine. Les vår fullstendige personvernerklæring for gratis radiolyttere.',
    },
  },
  fi: {
    terms: {
      title: 'Käyttöehdot — Mega Radio',
      description: 'Lue Mega Radion käyttöehdot: palvelun käyttö, tilisäännöt, immateriaalioikeudet ja kuuntelijan vastuut ilmaisessa verkkoradiossa.',
    },
    privacy: {
      title: 'Tietosuojakäytäntö — Mega Radio',
      description: 'Tutustu siihen, miten Mega Radio suojaa yksityisyyttäsi ja käsittelee henkilötietojasi. Lue koko tietosuojakäytäntömme ilmaisille radion kuuntelijoille.',
    },
  },
  el: {
    terms: {
      title: 'Όροι Χρήσης — Mega Radio',
      description: 'Διαβάστε τους Όρους Χρήσης του Mega Radio: χρήση υπηρεσίας, κανόνες λογαριασμού, πνευματική ιδιοκτησία και ευθύνες ακροατών δωρεάν διαδικτυακού ραδιοφώνου.',
    },
    privacy: {
      title: 'Πολιτική Απορρήτου — Mega Radio',
      description: 'Μάθετε πώς το Mega Radio προστατεύει το απόρρητό σας και διαχειρίζεται τα προσωπικά σας δεδομένα. Διαβάστε την πλήρη πολιτική απορρήτου μας.',
    },
  },
  hu: {
    terms: {
      title: 'Felhasználási Feltételek — Mega Radio',
      description: 'Olvasd el a Mega Radio Felhasználási Feltételeit: szolgáltatás használata, fiókszabályok, szellemi tulajdon és a hallgatók felelőssége az ingyenes online rádióban.',
    },
    privacy: {
      title: 'Adatvédelmi Tájékoztató — Mega Radio',
      description: 'Tudd meg, hogyan védi a Mega Radio az adataidat és kezeli személyes információidat. Olvasd el teljes adatvédelmi tájékoztatónkat ingyenes rádióhallgatók számára.',
    },
  },
  cs: {
    terms: {
      title: 'Podmínky použití — Mega Radio',
      description: 'Přečtěte si Podmínky použití Mega Radio: užívání služby, pravidla účtu, duševní vlastnictví a povinnosti posluchačů bezplatného online rádia.',
    },
    privacy: {
      title: 'Zásady ochrany osobních údajů — Mega Radio',
      description: 'Zjistěte, jak Mega Radio chrání vaše soukromí a zpracovává osobní údaje. Přečtěte si kompletní zásady ochrany soukromí pro posluchače bezplatného rádia.',
    },
  },
  sk: {
    terms: {
      title: 'Podmienky používania — Mega Radio',
      description: 'Prečítajte si Podmienky používania Mega Radio: používanie služby, pravidlá účtu, duševné vlastníctvo a povinnosti poslucháčov bezplatného online rádia.',
    },
    privacy: {
      title: 'Zásady ochrany osobných údajov — Mega Radio',
      description: 'Zistite, ako Mega Radio chráni vaše súkromie a spracúva osobné údaje. Prečítajte si naše úplné zásady ochrany súkromia pre poslucháčov bezplatného rádia.',
    },
  },
  ro: {
    terms: {
      title: 'Termeni și Condiții — Mega Radio',
      description: 'Citește Termenii și Condițiile Mega Radio: utilizarea serviciului, reguli de cont, proprietate intelectuală și responsabilitățile ascultătorilor de radio online gratuit.',
    },
    privacy: {
      title: 'Politica de Confidențialitate — Mega Radio',
      description: 'Află cum Mega Radio îți protejează confidențialitatea și gestionează datele personale. Citește politica noastră completă pentru ascultătorii de radio gratuit.',
    },
  },
  bg: {
    terms: {
      title: 'Условия за ползване — Mega Radio',
      description: 'Прочетете Условията за ползване на Mega Radio: използване на услугата, правила за акаунта, интелектуална собственост и отговорности на слушателите на безплатно радио онлайн.',
    },
    privacy: {
      title: 'Политика за поверителност — Mega Radio',
      description: 'Научете как Mega Radio защитава поверителността ви и обработва личните ви данни. Прочетете пълната ни политика за поверителност за слушателите на безплатно радио.',
    },
  },
  hr: {
    terms: {
      title: 'Uvjeti korištenja — Mega Radio',
      description: 'Pročitajte Uvjete korištenja Mega Radija: korištenje usluge, pravila računa, intelektualno vlasništvo i odgovornosti slušatelja besplatnog online radija.',
    },
    privacy: {
      title: 'Pravila privatnosti — Mega Radio',
      description: 'Saznajte kako Mega Radio štiti vašu privatnost i obrađuje osobne podatke. Pročitajte naša cjelovita pravila privatnosti za slušatelje besplatnog radija.',
    },
  },
  sr: {
    terms: {
      title: 'Услови коришћења — Mega Radio',
      description: 'Прочитајте Услове коришћења Mega Radio: коришћење услуге, правила налога, интелектуална својина и одговорности слушалаца бесплатног онлајн радија.',
    },
    privacy: {
      title: 'Политика приватности — Mega Radio',
      description: 'Сазнајте како Mega Radio штити вашу приватност и обрађује личне податке. Прочитајте нашу комплетну политику приватности за слушаоце бесплатног радија.',
    },
  },
  sl: {
    terms: {
      title: 'Pogoji uporabe — Mega Radio',
      description: 'Preberite Pogoje uporabe Mega Radia: uporaba storitve, pravila računa, intelektualna lastnina in odgovornosti poslušalcev brezplačnega spletnega radia.',
    },
    privacy: {
      title: 'Pravilnik o zasebnosti — Mega Radio',
      description: 'Izvedite, kako Mega Radio varuje vašo zasebnost in obdeluje osebne podatke. Preberite naš celoten pravilnik o zasebnosti za poslušalce brezplačnega radia.',
    },
  },
  lv: {
    terms: {
      title: 'Lietošanas noteikumi — Mega Radio',
      description: 'Izlasiet Mega Radio lietošanas noteikumus: pakalpojuma izmantošana, konta noteikumi, intelektuālais īpašums un bezmaksas tiešsaistes radio klausītāju pienākumi.',
    },
    privacy: {
      title: 'Privātuma politika — Mega Radio',
      description: 'Uzziniet, kā Mega Radio aizsargā jūsu privātumu un apstrādā personas datus. Izlasiet mūsu pilno privātuma politiku bezmaksas radio klausītājiem.',
    },
  },
  lt: {
    terms: {
      title: 'Naudojimo sąlygos — Mega Radio',
      description: 'Perskaitykite Mega Radio naudojimo sąlygas: paslaugos naudojimas, paskyros taisyklės, intelektinė nuosavybė ir nemokamo internetinio radijo klausytojų atsakomybės.',
    },
    privacy: {
      title: 'Privatumo politika — Mega Radio',
      description: 'Sužinokite, kaip Mega Radio saugo jūsų privatumą ir tvarko asmens duomenis. Perskaitykite mūsų išsamią privatumo politiką nemokamo radijo klausytojams.',
    },
  },
  et: {
    terms: {
      title: 'Kasutustingimused — Mega Radio',
      description: 'Loe Mega Radio kasutustingimusi: teenuse kasutamine, kontoreeglid, intellektuaalomand ja tasuta veebiraadio kuulajate kohustused.',
    },
    privacy: {
      title: 'Privaatsuspoliitika — Mega Radio',
      description: 'Saa teada, kuidas Mega Radio kaitseb sinu privaatsust ja töötleb isikuandmeid. Loe meie täielikku privaatsuspoliitikat tasuta raadiokuulajatele.',
    },
  },
  zh: {
    terms: {
      title: '使用条款 — Mega Radio',
      description: '阅读 Mega Radio 使用条款：服务使用、账户规则、知识产权以及免费在线广播听众的责任。',
    },
    privacy: {
      title: '隐私政策 — Mega Radio',
      description: '了解 Mega Radio 如何保护您的隐私并处理您的个人数据。阅读我们面向免费广播听众的完整隐私政策和数据保护实践。',
    },
  },
  ja: {
    terms: {
      title: '利用規約 — Mega Radio',
      description: 'Mega Radio の利用規約をお読みください。サービスの利用、アカウントの規則、知的財産、無料オンラインラジオ視聴者の責任について解説します。',
    },
    privacy: {
      title: 'プライバシーポリシー — Mega Radio',
      description: 'Mega Radio がお客様のプライバシーをどのように保護し、個人情報を取り扱うかをご紹介します。無料ラジオ視聴者向けの完全なプライバシーポリシーをお読みください。',
    },
  },
  ko: {
    terms: {
      title: '이용약관 — Mega Radio',
      description: 'Mega Radio 이용약관을 읽어보세요: 서비스 이용, 계정 규칙, 지적 재산권 및 무료 온라인 라디오 청취자의 책임을 다룹니다.',
    },
    privacy: {
      title: '개인정보 처리방침 — Mega Radio',
      description: 'Mega Radio가 회원님의 개인정보를 어떻게 보호하고 처리하는지 알아보세요. 무료 라디오 청취자를 위한 전체 개인정보 처리방침을 읽어보세요.',
    },
  },
  hi: {
    terms: {
      title: 'नियम और शर्तें — Mega Radio',
      description: 'Mega Radio के नियम और शर्तें पढ़ें: सेवा उपयोग, खाता नियम, बौद्धिक संपदा और मुफ़्त ऑनलाइन रेडियो श्रोताओं की ज़िम्मेदारियाँ।',
    },
    privacy: {
      title: 'गोपनीयता नीति — Mega Radio',
      description: 'जानें Mega Radio आपकी गोपनीयता कैसे सुरक्षित रखता है और व्यक्तिगत डेटा कैसे संभालता है। मुफ़्त रेडियो श्रोताओं के लिए हमारी पूरी गोपनीयता नीति पढ़ें।',
    },
  },
  th: {
    terms: {
      title: 'ข้อกำหนดและเงื่อนไข — Mega Radio',
      description: 'อ่านข้อกำหนดและเงื่อนไขของ Mega Radio: การใช้บริการ กฎของบัญชี ทรัพย์สินทางปัญญา และความรับผิดชอบของผู้ฟังวิทยุออนไลน์ฟรี',
    },
    privacy: {
      title: 'นโยบายความเป็นส่วนตัว — Mega Radio',
      description: 'เรียนรู้ว่า Mega Radio ปกป้องความเป็นส่วนตัวและจัดการข้อมูลส่วนบุคคลของคุณอย่างไร อ่านนโยบายความเป็นส่วนตัวฉบับเต็มสำหรับผู้ฟังวิทยุฟรี',
    },
  },
  vi: {
    terms: {
      title: 'Điều khoản và Điều kiện — Mega Radio',
      description: 'Đọc Điều khoản và Điều kiện của Mega Radio: việc sử dụng dịch vụ, quy tắc tài khoản, sở hữu trí tuệ và trách nhiệm của người nghe radio trực tuyến miễn phí.',
    },
    privacy: {
      title: 'Chính sách Bảo mật — Mega Radio',
      description: 'Tìm hiểu cách Mega Radio bảo vệ quyền riêng tư và xử lý dữ liệu cá nhân của bạn. Đọc toàn bộ chính sách bảo mật dành cho người nghe radio miễn phí.',
    },
  },
  id: {
    terms: {
      title: 'Syarat dan Ketentuan — Mega Radio',
      description: 'Baca Syarat dan Ketentuan Mega Radio: penggunaan layanan, aturan akun, kekayaan intelektual, dan tanggung jawab pendengar radio online gratis.',
    },
    privacy: {
      title: 'Kebijakan Privasi — Mega Radio',
      description: 'Pelajari bagaimana Mega Radio melindungi privasi dan menangani data pribadi Anda. Baca kebijakan privasi lengkap kami untuk pendengar radio gratis.',
    },
  },
  ms: {
    terms: {
      title: 'Terma dan Syarat — Mega Radio',
      description: 'Baca Terma dan Syarat Mega Radio: penggunaan perkhidmatan, peraturan akaun, harta intelek dan tanggungjawab pendengar radio dalam talian percuma.',
    },
    privacy: {
      title: 'Dasar Privasi — Mega Radio',
      description: 'Ketahui cara Mega Radio melindungi privasi anda dan mengendalikan data peribadi. Baca dasar privasi penuh kami untuk pendengar radio percuma.',
    },
  },
  tl: {
    terms: {
      title: 'Mga Tuntunin at Kondisyon — Mega Radio',
      description: 'Basahin ang Mga Tuntunin at Kondisyon ng Mega Radio: paggamit ng serbisyo, mga patakaran sa account, intellectual property at tungkulin ng mga libreng tagapakinig ng radyo.',
    },
    privacy: {
      title: 'Patakaran sa Privacy — Mega Radio',
      description: 'Alamin kung paano pinoprotektahan ng Mega Radio ang iyong privacy at hinahawakan ang iyong personal na data. Basahin ang aming kumpletong patakaran sa privacy.',
    },
  },
  he: {
    terms: {
      title: 'תנאים והגבלות — Mega Radio',
      description: 'קרא את התנאים וההגבלות של Mega Radio: שימוש בשירות, כללי חשבון, קניין רוחני ואחריות מאזיני רדיו אונליין חינם.',
    },
    privacy: {
      title: 'מדיניות פרטיות — Mega Radio',
      description: 'גלה כיצד Mega Radio מגן על פרטיותך ומטפל בנתונים האישיים שלך. קרא את מדיניות הפרטיות המלאה שלנו עבור מאזיני רדיו חינם.',
    },
  },
  fa: {
    terms: {
      title: 'شرایط و ضوابط — Mega Radio',
      description: 'شرایط و ضوابط Mega Radio را مطالعه کنید: استفاده از خدمات، قوانین حساب، مالکیت فکری و مسئولیت‌های شنوندگان رادیوی آنلاین رایگان.',
    },
    privacy: {
      title: 'سیاست حریم خصوصی — Mega Radio',
      description: 'بدانید Mega Radio چگونه از حریم خصوصی شما محافظت می‌کند و داده‌های شخصی شما را مدیریت می‌کند. سیاست حریم خصوصی کامل ما را بخوانید.',
    },
  },
  ur: {
    terms: {
      title: 'شرائط و ضوابط — Mega Radio',
      description: 'Mega Radio کی شرائط و ضوابط پڑھیں: سروس کا استعمال، اکاؤنٹ کے قواعد، دانشورانہ املاک اور مفت آن لائن ریڈیو سامعین کی ذمہ داریاں۔',
    },
    privacy: {
      title: 'رازداری کی پالیسی — Mega Radio',
      description: 'جانیں کہ Mega Radio آپ کی رازداری کی حفاظت کیسے کرتا ہے اور ذاتی ڈیٹا کو کیسے سنبھالتا ہے۔ مفت ریڈیو سامعین کے لیے ہماری مکمل رازداری کی پالیسی پڑھیں۔',
    },
  },
  bn: {
    terms: {
      title: 'শর্তাবলী — Mega Radio',
      description: 'Mega Radio-এর শর্তাবলী পড়ুন: পরিষেবার ব্যবহার, অ্যাকাউন্টের নিয়ম, মেধাস্বত্ব এবং বিনামূল্যে অনলাইন রেডিও শ্রোতাদের দায়িত্ব।',
    },
    privacy: {
      title: 'গোপনীয়তা নীতি — Mega Radio',
      description: 'জানুন Mega Radio কীভাবে আপনার গোপনীয়তা রক্ষা করে এবং ব্যক্তিগত তথ্য পরিচালনা করে। বিনামূল্যে রেডিও শ্রোতাদের জন্য আমাদের সম্পূর্ণ গোপনীয়তা নীতি পড়ুন।',
    },
  },
  ta: {
    terms: {
      title: 'விதிமுறைகள் மற்றும் நிபந்தனைகள் — Mega Radio',
      description: 'Mega Radio-வின் விதிமுறைகளைப் படியுங்கள்: சேவை பயன்பாடு, கணக்கு விதிகள், அறிவுசார் சொத்து மற்றும் இலவச ஆன்லைன் வானொலி கேட்போரின் பொறுப்புகள்.',
    },
    privacy: {
      title: 'தனியுரிமைக் கொள்கை — Mega Radio',
      description: 'Mega Radio உங்கள் தனியுரிமையை எப்படி பாதுகாக்கிறது மற்றும் தனிப்பட்ட தரவை எப்படி கையாள்கிறது என்பதை அறிக. முழுமையான தனியுரிமைக் கொள்கையைப் படியுங்கள்.',
    },
  },
  te: {
    terms: {
      title: 'నిబంధనలు మరియు షరతులు — Mega Radio',
      description: 'Mega Radio నిబంధనలు మరియు షరతులు చదవండి: సేవా వినియోగం, ఖాతా నియమాలు, మేధో సంపత్తి మరియు ఉచిత ఆన్‌లైన్ రేడియో శ్రోతల బాధ్యతలు.',
    },
    privacy: {
      title: 'గోప్యతా విధానం — Mega Radio',
      description: 'Mega Radio మీ గోప్యతను ఎలా రక్షిస్తుందో మరియు వ్యక్తిగత డేటాను ఎలా నిర్వహిస్తుందో తెలుసుకోండి. ఉచిత రేడియో శ్రోతల కోసం పూర్తి గోప్యతా విధానం చదవండి.',
    },
  },
  mr: {
    terms: {
      title: 'अटी आणि शर्ती — Mega Radio',
      description: 'Mega Radio च्या अटी आणि शर्ती वाचा: सेवेचा वापर, खाते नियम, बौद्धिक संपदा आणि मोफत ऑनलाइन रेडिओ श्रोत्यांच्या जबाबदाऱ्या.',
    },
    privacy: {
      title: 'गोपनीयता धोरण — Mega Radio',
      description: 'Mega Radio तुमची गोपनीयता कशी सुरक्षित ठेवतो आणि वैयक्तिक डेटा कसा हाताळतो ते जाणून घ्या. मोफत रेडिओ श्रोत्यांसाठी आमचे संपूर्ण गोपनीयता धोरण वाचा.',
    },
  },
  gu: {
    terms: {
      title: 'નિયમો અને શરતો — Mega Radio',
      description: 'Mega Radio ના નિયમો અને શરતો વાંચો: સેવાનો ઉપયોગ, ખાતાના નિયમો, બૌદ્ધિક સંપદા અને મફત ઓનલાઇન રેડિયો શ્રોતાઓની જવાબદારીઓ.',
    },
    privacy: {
      title: 'ગોપનીયતા નીતિ — Mega Radio',
      description: 'જાણો Mega Radio તમારી ગોપનીયતા કેવી રીતે સુરક્ષિત રાખે છે અને વ્યક્તિગત ડેટા કેવી રીતે સંભાળે છે. મફત રેડિયો શ્રોતાઓ માટે અમારી સંપૂર્ણ ગોપનીયતા નીતિ વાંચો.',
    },
  },
  kn: {
    terms: {
      title: 'ನಿಯಮಗಳು ಮತ್ತು ಷರತ್ತುಗಳು — Mega Radio',
      description: 'Mega Radio ನಿಯಮಗಳು ಮತ್ತು ಷರತ್ತುಗಳನ್ನು ಓದಿ: ಸೇವೆಯ ಬಳಕೆ, ಖಾತೆ ನಿಯಮಗಳು, ಬೌದ್ಧಿಕ ಆಸ್ತಿ ಮತ್ತು ಉಚಿತ ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ಕೇಳುಗರ ಜವಾಬ್ದಾರಿಗಳು.',
    },
    privacy: {
      title: 'ಗೌಪ್ಯತಾ ನೀತಿ — Mega Radio',
      description: 'Mega Radio ನಿಮ್ಮ ಗೌಪ್ಯತೆಯನ್ನು ಹೇಗೆ ರಕ್ಷಿಸುತ್ತದೆ ಮತ್ತು ವೈಯಕ್ತಿಕ ಡೇಟಾವನ್ನು ಹೇಗೆ ನಿರ್ವಹಿಸುತ್ತದೆ ಎಂಬುದನ್ನು ತಿಳಿಯಿರಿ. ಉಚಿತ ರೇಡಿಯೋ ಕೇಳುಗರಿಗೆ ಗೌಪ್ಯತಾ ನೀತಿ ಓದಿ.',
    },
  },
  ml: {
    terms: {
      title: 'നിബന്ധനകളും വ്യവസ്ഥകളും — Mega Radio',
      description: 'Mega Radio യുടെ നിബന്ധനകൾ വായിക്കുക: സേവന ഉപയോഗം, അക്കൗണ്ട് നിയമങ്ങൾ, ബൗദ്ധിക സ്വത്ത്, സൗജന്യ ഓൺലൈൻ റേഡിയോ ശ്രോതാക്കളുടെ ഉത്തരവാദിത്തങ്ങൾ.',
    },
    privacy: {
      title: 'സ്വകാര്യതാ നയം — Mega Radio',
      description: 'Mega Radio നിങ്ങളുടെ സ്വകാര്യത എങ്ങനെ സംരക്ഷിക്കുന്നുവെന്നും വ്യക്തിഗത ഡാറ്റ എങ്ങനെ കൈകാര്യം ചെയ്യുന്നുവെന്നും അറിയുക. പൂർണ്ണ സ്വകാര്യതാ നയം വായിക്കുക.',
    },
  },
  pa: {
    terms: {
      title: 'ਨਿਯਮ ਅਤੇ ਸ਼ਰਤਾਂ — Mega Radio',
      description: 'Mega Radio ਦੇ ਨਿਯਮ ਅਤੇ ਸ਼ਰਤਾਂ ਪੜ੍ਹੋ: ਸੇਵਾ ਦੀ ਵਰਤੋਂ, ਖਾਤੇ ਦੇ ਨਿਯਮ, ਬੌਧਿਕ ਜਾਇਦਾਦ ਅਤੇ ਮੁਫ਼ਤ ਆਨਲਾਈਨ ਰੇਡੀਓ ਸੁਣਨ ਵਾਲਿਆਂ ਦੀਆਂ ਜ਼ਿੰਮੇਵਾਰੀਆਂ।',
    },
    privacy: {
      title: 'ਪਰਦੇਦਾਰੀ ਨੀਤੀ — Mega Radio',
      description: 'ਜਾਣੋ Mega Radio ਤੁਹਾਡੀ ਪਰਦੇਦਾਰੀ ਦੀ ਰੱਖਿਆ ਕਿਵੇਂ ਕਰਦਾ ਹੈ ਅਤੇ ਨਿੱਜੀ ਡੇਟਾ ਨੂੰ ਕਿਵੇਂ ਸੰਭਾਲਦਾ ਹੈ। ਮੁਫ਼ਤ ਰੇਡੀਓ ਸੁਣਨ ਵਾਲਿਆਂ ਲਈ ਸਾਡੀ ਪੂਰੀ ਪਰਦੇਦਾਰੀ ਨੀਤੀ ਪੜ੍ਹੋ।',
    },
  },
  sw: {
    terms: {
      title: 'Masharti na Vigezo — Mega Radio',
      description: 'Soma Masharti na Vigezo vya Mega Radio: matumizi ya huduma, kanuni za akaunti, miliki bunifu na majukumu ya wasikilizaji wa redio ya mtandaoni bure.',
    },
    privacy: {
      title: 'Sera ya Faragha — Mega Radio',
      description: 'Jifunze jinsi Mega Radio inavyolinda faragha yako na kushughulikia data ya kibinafsi. Soma sera kamili ya faragha kwa wasikilizaji wa redio bure.',
    },
  },
  am: {
    terms: {
      title: 'የአገልግሎት ውሎች — Mega Radio',
      description: 'የMega Radio አጠቃቀም ውሎችን ያንብቡ፡ የአገልግሎት አጠቃቀም፣ የመለያ ደንቦች፣ የአእምሮ ንብረት እና የነፃ የመስመር ላይ ራዲዮ አድማጮች ኃላፊነቶች።',
    },
    privacy: {
      title: 'የግላዊነት ፖሊሲ — Mega Radio',
      description: 'Mega Radio ግላዊነትዎን እንዴት እንደሚጠብቅ እና የግል መረጃዎን እንዴት እንደሚያስተናግድ ይወቁ። ለነፃ ራዲዮ አድማጮች የተሟላ የግላዊነት ፖሊሲያችንን ያንብቡ።',
    },
  },
  zu: {
    terms: {
      title: 'Imigomo Nemibandela — Mega Radio',
      description: 'Funda Imigomo Nemibandela ka-Mega Radio: ukusetshenziswa kwesevisi, imithetho ye-akhawunti, impahla yengqondo nemisebenzi yabalaleli bomsakazo we-inthanethi mahhala.',
    },
    privacy: {
      title: 'Inqubomgomo Yobumfihlo — Mega Radio',
      description: 'Funda ukuthi i-Mega Radio iyivikela kanjani imfihlo yakho futhi iphathe kanjani idatha yakho yomuntu siqu. Funda inqubomgomo yobumfihlo ephelele yabalaleli bomsakazo wamahhala.',
    },
  },
  af: {
    terms: {
      title: 'Bepalings en Voorwaardes — Mega Radio',
      description: 'Lees Mega Radio se Bepalings en Voorwaardes: gebruik van die diens, rekeningreëls, intellektuele eiendom en verantwoordelikhede van gratis aanlyn-radioluisteraars.',
    },
    privacy: {
      title: 'Privaatheidsbeleid — Mega Radio',
      description: 'Vind uit hoe Mega Radio jou privaatheid beskerm en jou persoonlike data hanteer. Lees ons volledige privaatheidsbeleid vir gratis radioluisteraars.',
    },
  },
  sq: {
    terms: {
      title: 'Kushtet e Përdorimit — Mega Radio',
      description: 'Lexoni Kushtet e Përdorimit të Mega Radio: përdorimi i shërbimit, rregullat e llogarisë, prona intelektuale dhe përgjegjësitë e dëgjuesve të radios online falas.',
    },
    privacy: {
      title: 'Politika e Privatësisë — Mega Radio',
      description: 'Mësoni se si Mega Radio mbron privatësinë tuaj dhe trajton të dhënat personale. Lexoni politikën tonë të plotë të privatësisë për dëgjuesit e radios falas.',
    },
  },
  az: {
    terms: {
      title: 'İstifadə Şərtləri — Mega Radio',
      description: 'Mega Radio-nun İstifadə Şərtlərini oxuyun: xidmətdən istifadə, hesab qaydaları, intellektual mülkiyyət və pulsuz onlayn radio dinləyicilərinin məsuliyyətləri.',
    },
    privacy: {
      title: 'Məxfilik Siyasəti — Mega Radio',
      description: 'Mega Radio-nun məxfiliyinizi necə qoruduğunu və şəxsi məlumatlarınızı necə idarə etdiyini öyrənin. Pulsuz radio dinləyiciləri üçün tam məxfilik siyasətini oxuyun.',
    },
  },
  hy: {
    terms: {
      title: 'Օգտագործման պայմաններ — Mega Radio',
      description: 'Կարդացեք Mega Radio-ի օգտագործման պայմանները՝ ծառայության օգտագործում, հաշվի կանոններ, մտավոր սեփականություն և անվճար առցանց ռադիոյի ունկնդիրների պարտականություններ։',
    },
    privacy: {
      title: 'Գաղտնիության քաղաքականություն — Mega Radio',
      description: 'Իմացեք, թե ինչպես է Mega Radio-ն պաշտպանում ձեր գաղտնիությունը և մշակում անձնական տվյալները։ Կարդացեք գաղտնիության մեր ամբողջական քաղաքականությունը։',
    },
  },
  so: {
    terms: {
      title: 'Shuruudaha iyo Xaaladaha — Mega Radio',
      description: 'Akhri Shuruudaha iyo Xaaladaha Mega Radio: isticmaalka adeegga, xeerarka akoonka, hantida fikirka iyo waajibaadyada dhageystayaasha raadyaha onlayn-ka ee bilaashka ah.',
    },
    privacy: {
      title: 'Siyaasadda Asturnaanta — Mega Radio',
      description: 'Baro sida Mega Radio u ilaaliyo asturnaantaada iyo u maamulo xogtaada shakhsi ahaaneed. Akhri siyaasaddayada buuxda ee asturnaanta dhageystayaasha raadyaha bilaashka ah.',
    },
  },
  uk: {
    terms: {
      title: 'Умови використання — Mega Radio',
      description: 'Прочитайте Умови використання Mega Radio: використання сервісу, правила облікового запису, інтелектуальна власність та обовʼязки слухачів безкоштовного онлайн-радіо.',
    },
    privacy: {
      title: 'Політика конфіденційності — Mega Radio',
      description: 'Дізнайтеся, як Mega Radio захищає вашу конфіденційність та обробляє персональні дані. Прочитайте повну політику конфіденційності для слухачів безкоштовного радіо.',
    },
  },
  bs: {
    terms: {
      title: 'Uslovi korištenja — Mega Radio',
      description: 'Pročitajte Uslove korištenja Mega Radija: korištenje usluge, pravila računa, intelektualna svojina i odgovornosti slušatelja besplatnog online radija.',
    },
    privacy: {
      title: 'Politika privatnosti — Mega Radio',
      description: 'Saznajte kako Mega Radio štiti vašu privatnost i obrađuje lične podatke. Pročitajte našu cjelovitu politiku privatnosti za slušatelje besplatnog radija.',
    },
  },
};

/**
 * Get a per-language Legal SEO template, falling back to English.
 */
export function getLegalSeoTemplate(language: string): LegalSeoTemplate {
  return LEGAL_SEO_TEMPLATES[language] || LEGAL_SEO_TEMPLATES.en;
}

// Word-boundary safe truncation. Mirrors search-seo-templates clampGraphemes.
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

/**
 * Builds title/description for the Terms or Privacy page in the given language.
 *
 * If `dbTranslations` provides the legacy keys IN THE REQUESTED LANGUAGE
 * (`terms_page_title`, `terms_page_description`, `privacy_page_title`,
 * `privacy_page_description`), they take precedence — otherwise we fall back
 * to the per-language template so we never serve a Turkish page with an
 * English `<title>`. Mirrors the override pattern used by buildSearchSeo /
 * buildGenreSeo / buildCountrySeo.
 *
 * Defensive: enforces a 145-character maximum description length.
 */
export function buildLegalSeo(
  pageType: LegalPageKind,
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string } {
  const tpl = getLegalSeoTemplate(language)[pageType];

  const dbTitleKey = pageType === 'terms' ? 'terms_page_title' : 'privacy_page_title';
  const dbDescKey =
    pageType === 'terms' ? 'terms_page_description' : 'privacy_page_description';

  const dbTitle = dbTranslations?.[dbTitleKey]?.trim();
  const dbDescription = dbTranslations?.[dbDescKey]?.trim();

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

  return { title, description };
}
