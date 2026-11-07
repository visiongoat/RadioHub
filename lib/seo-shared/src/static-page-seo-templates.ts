/**
 * Multilingual SEO templates for the static informational pages — About
 * (`/xx/about`), Contact (`/xx/contact`) and Applications
 * (`/xx/applications`).
 *
 * Each language entry returns an idiomatic title/description for all three
 * pages. Falls back to English when the language is not yet covered.
 *
 * NOTE: Used by api-server/src/seo-renderer.ts in the
 * `pageType === 'about' | 'contact' | 'applications'` branches AND by
 * SeoHead.tsx on the client to keep React hydration aligned with the
 * SSR-localized meta tags (otherwise the client would overwrite the
 * per-language title with hard-coded English on mount, the same trap
 * regions/genres/search/legal had before they were localised).
 *
 * Database translation keys take precedence when present in the requested
 * language — otherwise we'd serve a Turkish page with an English `<title>`.
 *   - about:        `about_mega_radio`, `about_mega_radio_description`
 *   - contact:      `contact_page_title`, `contact_page_description`
 *   - applications: `applications_page_title`, `applications_page_description`
 *
 * Background: before this template existed, the About + Contact pages relied
 * on those DB keys with hard-coded English fallbacks (`about_mega_radio:
 * 'About Mega Radio - Free Online Radio Platform'` etc. in seo-renderer.ts'
 * `SEO_KEY_FALLBACKS` map), and the Applications page was hard-coded English
 * with no override path at all. Every language without a complete set of DB
 * strings served the SAME English `<title>` and `<meta description>` across
 * /xx/about, /xx/contact and /xx/applications — the same duplicate-content
 * trap that prompted the region/genre/search/legal localization passes.
 *
 * Shape mirrors LEGAL_SEO_TEMPLATES (Record<lang, T>), with one entry per
 * page kind (about / contact / applications).
 */

export interface StaticPageSeoEntry {
  title: string;
  description: string;
}

export interface StaticPageSeoTemplate {
  about: StaticPageSeoEntry;
  contact: StaticPageSeoEntry;
  applications: StaticPageSeoEntry;
}

export type StaticPageKind = 'about' | 'contact' | 'applications';

// All 57 supported languages — natural, locale-aware phrasing.
// Any language not present here falls back to English.
// Descriptions kept under ~155 chars (Bing META DESCRIPTION LENGTH RULE),
// titles under ~70 chars where possible.
export const STATIC_PAGE_SEO_TEMPLATES: Record<string, StaticPageSeoTemplate> = {
  en: {
    about: {
      title: 'About Mega Radio — Free Online Radio Platform',
      description: 'Learn about Mega Radio: the free online radio platform with 60,000+ live stations from 120+ countries. Stream music, news, sports and talk radio worldwide.',
    },
    contact: {
      title: 'Contact Mega Radio — Get in Touch',
      description: 'Contact the Mega Radio team for support, feedback or partnership inquiries. We are here to help with your free online radio streaming experience.',
    },
    applications: {
      title: 'Mega Radio Apps — iOS, Android, Smart TV & Desktop',
      description: 'Download free Mega Radio apps for iOS, Android, Smart TV, Apple TV, Roku and desktop. Stream 60,000+ live radio stations from 120+ countries everywhere.',
    },
  },
  tr: {
    about: {
      title: 'Mega Radio Hakkında — Ücretsiz Online Radyo Platformu',
      description: '120+ ülkeden 60.000+ canlı istasyonu sunan ücretsiz online radyo platformu Mega Radio hakkında bilgi alın. Müzik, haber, spor ve sohbet radyosu dinleyin.',
    },
    contact: {
      title: 'Mega Radio İletişim — Bize Ulaşın',
      description: 'Destek, geri bildirim veya iş birliği için Mega Radio ekibiyle iletişime geçin. Ücretsiz online radyo deneyiminizde size yardımcı olmak için buradayız.',
    },
    applications: {
      title: 'Mega Radio Uygulamaları — iOS, Android, Smart TV ve Masaüstü',
      description: 'Ücretsiz Mega Radio uygulamalarını iOS, Android, Smart TV, Apple TV, Roku ve masaüstü için indirin. 120+ ülkeden 60.000+ canlı radyo istasyonu dinleyin.',
    },
  },
  es: {
    about: {
      title: 'Acerca de Mega Radio — Plataforma de Radio Online Gratis',
      description: 'Conoce Mega Radio: la plataforma de radio online gratis con más de 60.000 emisoras en vivo de 120+ países. Escucha música, noticias, deportes y radio hablada.',
    },
    contact: {
      title: 'Contacto Mega Radio — Estamos en Contacto',
      description: 'Ponte en contacto con el equipo de Mega Radio para soporte, comentarios o propuestas. Estamos aquí para ayudarte con tu experiencia de radio online gratis.',
    },
    applications: {
      title: 'Apps de Mega Radio — iOS, Android, Smart TV y Escritorio',
      description: 'Descarga las apps gratuitas de Mega Radio para iOS, Android, Smart TV, Apple TV, Roku y escritorio. Escucha 60.000+ emisoras en vivo de 120+ países.',
    },
  },
  fr: {
    about: {
      title: 'À propos de Mega Radio — Plateforme Radio Gratuite en Ligne',
      description: 'Découvrez Mega Radio : la plateforme radio gratuite en ligne avec 60 000+ stations en direct de 120+ pays. Écoutez musique, infos, sport et radios parlées.',
    },
    contact: {
      title: 'Contact Mega Radio — Contactez-nous',
      description: "Contactez l'équipe Mega Radio pour assistance, retours ou partenariats. Nous sommes là pour vous aider avec votre expérience radio en ligne gratuite.",
    },
    applications: {
      title: 'Applications Mega Radio — iOS, Android, Smart TV et Bureau',
      description: 'Téléchargez gratuitement les apps Mega Radio pour iOS, Android, Smart TV, Apple TV, Roku et bureau. Écoutez 60 000+ stations en direct de 120+ pays.',
    },
  },
  de: {
    about: {
      title: 'Über Mega Radio — Kostenlose Online-Radio-Plattform',
      description: 'Erfahre mehr über Mega Radio: die kostenlose Online-Radio-Plattform mit 60.000+ Live-Sendern aus 120+ Ländern. Höre Musik, Nachrichten, Sport und Talk-Radio.',
    },
    contact: {
      title: 'Mega Radio Kontakt — Schreib uns',
      description: 'Kontaktiere das Mega-Radio-Team für Support, Feedback oder Partnerschaften. Wir helfen dir bei deinem kostenlosen Online-Radio-Streaming-Erlebnis.',
    },
    applications: {
      title: 'Mega Radio Apps — iOS, Android, Smart TV und Desktop',
      description: 'Lade kostenlose Mega-Radio-Apps für iOS, Android, Smart TV, Apple TV, Roku und Desktop herunter. Höre 60.000+ Live-Radiosender aus 120+ Ländern überall.',
    },
  },
  ar: {
    about: {
      title: 'حول Mega Radio — منصة راديو مجانية عبر الإنترنت',
      description: 'تعرّف على Mega Radio: منصة الراديو المجانية عبر الإنترنت مع أكثر من 60.000 محطة مباشرة من 120+ دولة. استمع للموسيقى والأخبار والرياضة والبرامج الحوارية.',
    },
    contact: {
      title: 'تواصل مع Mega Radio — themegaradio.com',
      description: 'تواصل مع فريق Mega Radio للدعم أو الملاحظات أو الشراكات. نحن هنا لمساعدتك في تجربة بث الراديو المجاني عبر الإنترنت.',
    },
    applications: {
      title: 'تطبيقات Mega Radio — iOS و Android و Smart TV وسطح المكتب',
      description: 'حمّل تطبيقات Mega Radio المجانية لـ iOS و Android و Smart TV و Apple TV و Roku وسطح المكتب. استمع لأكثر من 60.000 محطة راديو مباشرة من 120+ دولة.',
    },
  },
  it: {
    about: {
      title: 'Chi siamo — Mega Radio, Radio Online Gratis',
      description: 'Scopri Mega Radio: la piattaforma di radio online gratis con oltre 60.000 stazioni live da 120+ paesi. Ascolta musica, notizie, sport e radio parlata.',
    },
    contact: {
      title: 'Contatti Mega Radio — Mettiti in Contatto',
      description: 'Contatta il team di Mega Radio per supporto, feedback o collaborazioni. Siamo qui per aiutarti con la tua esperienza di radio online gratuita.',
    },
    applications: {
      title: 'App di Mega Radio — iOS, Android, Smart TV e Desktop',
      description: 'Scarica le app gratuite di Mega Radio per iOS, Android, Smart TV, Apple TV, Roku e desktop. Ascolta 60.000+ stazioni radio live da 120+ paesi ovunque.',
    },
  },
  pt: {
    about: {
      title: 'Sobre a Mega Radio — Plataforma de Rádio Online Grátis',
      description: 'Conheça a Mega Radio: a plataforma de rádio online grátis com mais de 60.000 estações ao vivo de 120+ países. Ouça música, notícias, desporto e talk-show.',
    },
    contact: {
      title: 'Contacto Mega Radio — Fale Connosco',
      description: 'Contacte a equipa Mega Radio para suporte, feedback ou parcerias. Estamos aqui para ajudar com a sua experiência de rádio online grátis em todo o mundo.',
    },
    applications: {
      title: 'Apps Mega Radio — iOS, Android, Smart TV e Desktop',
      description: 'Descarregue as apps gratuitas Mega Radio para iOS, Android, Smart TV, Apple TV, Roku e desktop. Ouça 60.000+ estações de rádio ao vivo de 120+ países.',
    },
  },
  nl: {
    about: {
      title: 'Over Mega Radio — Gratis Online Radio-Platform',
      description: 'Leer Mega Radio kennen: het gratis online radio-platform met 60.000+ live zenders uit 120+ landen. Luister naar muziek, nieuws, sport en gesprekken.',
    },
    contact: {
      title: 'Contact Mega Radio — Neem Contact Op',
      description: 'Neem contact op met het Mega Radio-team voor ondersteuning, feedback of samenwerkingen. We helpen je graag bij je gratis online radio-ervaring.',
    },
    applications: {
      title: 'Mega Radio Apps — iOS, Android, Smart TV en Desktop',
      description: 'Download de gratis Mega Radio-apps voor iOS, Android, Smart TV, Apple TV, Roku en desktop. Luister naar 60.000+ live radiozenders uit 120+ landen.',
    },
  },
  ru: {
    about: {
      title: 'О Mega Radio — бесплатная онлайн-радио платформа',
      description: 'Узнайте о Mega Radio: бесплатной онлайн-платформе с 60 000+ живых станций из 120+ стран. Слушайте музыку, новости, спорт и разговорное радио.',
    },
    contact: {
      title: 'Контакты Mega Radio — свяжитесь с нами',
      description: 'Свяжитесь с командой Mega Radio для поддержки, обратной связи или сотрудничества. Мы поможем с вашим опытом бесплатного онлайн-радио.',
    },
    applications: {
      title: 'Приложения Mega Radio — iOS, Android, Smart TV и десктоп',
      description: 'Скачайте бесплатные приложения Mega Radio для iOS, Android, Smart TV, Apple TV, Roku и компьютера. Слушайте 60 000+ живых станций из 120+ стран.',
    },
  },
  pl: {
    about: {
      title: 'O Mega Radio — bezpłatna platforma radia online',
      description: 'Poznaj Mega Radio: bezpłatną platformę radia online z 60 000+ stacjami na żywo z 120+ krajów. Słuchaj muzyki, wiadomości, sportu i radia mówionego.',
    },
    contact: {
      title: 'Kontakt Mega Radio — skontaktuj się z nami',
      description: 'Skontaktuj się z zespołem Mega Radio w sprawie wsparcia, opinii lub współpracy. Pomożemy w korzystaniu z bezpłatnego radia online.',
    },
    applications: {
      title: 'Aplikacje Mega Radio — iOS, Android, Smart TV i komputer',
      description: 'Pobierz bezpłatne aplikacje Mega Radio na iOS, Android, Smart TV, Apple TV, Roku i komputer. Słuchaj 60 000+ stacji radiowych na żywo z 120+ krajów.',
    },
  },
  sv: {
    about: {
      title: 'Om Mega Radio — gratis onlineradio-plattform',
      description: 'Lär känna Mega Radio: den gratis onlineradio-plattformen med 60 000+ livesändare från 120+ länder. Lyssna på musik, nyheter, sport och pratradio.',
    },
    contact: {
      title: 'Kontakta Mega Radio — hör av dig',
      description: 'Kontakta Mega Radio-teamet för support, feedback eller samarbeten. Vi hjälper dig gärna med din gratis upplevelse av radio online.',
    },
    applications: {
      title: 'Mega Radio-appar — iOS, Android, Smart TV och dator',
      description: 'Ladda ner gratis Mega Radio-appar till iOS, Android, Smart TV, Apple TV, Roku och dator. Lyssna på 60 000+ livesändare från 120+ länder överallt.',
    },
  },
  da: {
    about: {
      title: 'Om Mega Radio — gratis online radioplatform',
      description: 'Lær Mega Radio at kende: den gratis online radioplatform med 60.000+ live-stationer fra 120+ lande. Lyt til musik, nyheder, sport og snakkeradio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — kom i kontakt',
      description: 'Kontakt Mega Radio-teamet for support, feedback eller samarbejder. Vi hjælper dig med din gratis online radiooplevelse over hele verden.',
    },
    applications: {
      title: 'Mega Radio-apps — iOS, Android, Smart TV og computer',
      description: 'Download gratis Mega Radio-apps til iOS, Android, Smart TV, Apple TV, Roku og computer. Lyt til 60.000+ live radiostationer fra 120+ lande overalt.',
    },
  },
  no: {
    about: {
      title: 'Om Mega Radio — gratis nettradio-plattform',
      description: 'Bli kjent med Mega Radio: den gratis nettradio-plattformen med 60 000+ direktesendte stasjoner fra 120+ land. Hør musikk, nyheter, sport og prateradio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — ta kontakt',
      description: 'Kontakt Mega Radio-teamet for støtte, tilbakemeldinger eller samarbeid. Vi hjelper deg gjerne med din gratis nettradio-opplevelse.',
    },
    applications: {
      title: 'Mega Radio-apper — iOS, Android, Smart TV og PC',
      description: 'Last ned gratis Mega Radio-apper for iOS, Android, Smart TV, Apple TV, Roku og PC. Hør 60 000+ direktesendte radiostasjoner fra 120+ land overalt.',
    },
  },
  fi: {
    about: {
      title: 'Tietoa Mega Radiosta — ilmainen verkkoradio-alusta',
      description: 'Tutustu Mega Radioon: ilmaiseen verkkoradio-alustaan, jolla on 60 000+ live-asemaa 120+ maasta. Kuuntele musiikkia, uutisia, urheilua ja puheradiota.',
    },
    contact: {
      title: 'Ota yhteyttä Mega Radioon — themegaradio.com',
      description: 'Ota yhteyttä Mega Radion tiimiin tukea, palautetta tai yhteistyötä varten. Autamme mielellämme ilmaisen verkkoradio-kokemuksesi kanssa.',
    },
    applications: {
      title: 'Mega Radio -sovellukset — iOS, Android, Smart TV ja työpöytä',
      description: 'Lataa ilmaiset Mega Radio -sovellukset iOS, Android, Smart TV, Apple TV, Roku ja työpöydälle. Kuuntele 60 000+ live-radioasemaa 120+ maasta.',
    },
  },
  el: {
    about: {
      title: 'Σχετικά με το Mega Radio — Δωρεάν Online Ραδιόφωνο',
      description: 'Γνωρίστε το Mega Radio: τη δωρεάν online πλατφόρμα ραδιοφώνου με 60.000+ ζωντανούς σταθμούς από 120+ χώρες. Ακούστε μουσική, ειδήσεις, αθλητικά, ομιλία.',
    },
    contact: {
      title: 'Επικοινωνία Mega Radio — themegaradio.com',
      description: 'Επικοινωνήστε με την ομάδα του Mega Radio για υποστήριξη, σχόλια ή συνεργασίες. Είμαστε εδώ για τη δωρεάν online εμπειρία ραδιοφώνου σας.',
    },
    applications: {
      title: 'Εφαρμογές Mega Radio — iOS, Android, Smart TV & Υπολογιστής',
      description: 'Κατεβάστε τις δωρεάν εφαρμογές Mega Radio για iOS, Android, Smart TV, Apple TV, Roku και υπολογιστή. Ακούστε 60.000+ σταθμούς από 120+ χώρες παντού.',
    },
  },
  hu: {
    about: {
      title: 'A Mega Radióról — ingyenes online rádió platform',
      description: 'Ismerd meg a Mega Radiót: az ingyenes online rádió platformot 60 000+ élő adóval 120+ országból. Hallgass zenét, híreket, sportot és beszélgetős rádiót.',
    },
    contact: {
      title: 'Mega Rádió kapcsolat — vedd fel velünk a kapcsolatot',
      description: 'Lépj kapcsolatba a Mega Radio csapatával támogatás, visszajelzés vagy együttműködés ügyében. Segítünk az ingyenes online rádiózási élményedben.',
    },
    applications: {
      title: 'Mega Radio alkalmazások — iOS, Android, Smart TV és asztali',
      description: 'Töltsd le az ingyenes Mega Radio alkalmazásokat iOS, Android, Smart TV, Apple TV, Roku és asztali rendszerre. 60 000+ élő rádióadó 120+ országból.',
    },
  },
  cs: {
    about: {
      title: 'O Mega Radiu — bezplatná online rádiová platforma',
      description: 'Poznejte Mega Radio: bezplatnou online rádiovou platformu s 60 000+ živými stanicemi ze 120+ zemí. Poslouchejte hudbu, zprávy, sport a mluvené rádio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — spojte se s námi',
      description: 'Kontaktujte tým Mega Radio pro podporu, zpětnou vazbu nebo spolupráci. Rádi vám pomůžeme s vaším zážitkem z bezplatného online rádia.',
    },
    applications: {
      title: 'Aplikace Mega Radio — iOS, Android, Smart TV a desktop',
      description: 'Stáhněte si bezplatné aplikace Mega Radio pro iOS, Android, Smart TV, Apple TV, Roku a desktop. Poslouchejte 60 000+ živých stanic ze 120+ zemí.',
    },
  },
  sk: {
    about: {
      title: 'O Mega Rádiu — bezplatná online rádiová platforma',
      description: 'Spoznajte Mega Radio: bezplatnú online rádiovú platformu so 60 000+ živými stanicami zo 120+ krajín. Počúvajte hudbu, správy, šport a hovorené rádio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — spojte sa s nami',
      description: 'Kontaktujte tím Mega Radio kvôli podpore, spätnej väzbe alebo spolupráci. Radi pomôžeme s vaším zážitkom bezplatného online rádia.',
    },
    applications: {
      title: 'Aplikácie Mega Radio — iOS, Android, Smart TV a desktop',
      description: 'Stiahnite si bezplatné aplikácie Mega Radio pre iOS, Android, Smart TV, Apple TV, Roku a desktop. Počúvajte 60 000+ živých staníc zo 120+ krajín.',
    },
  },
  ro: {
    about: {
      title: 'Despre Mega Radio — Platformă de Radio Online Gratuită',
      description: 'Află despre Mega Radio: platforma de radio online gratuită cu 60.000+ posturi live din 120+ țări. Ascultă muzică, știri, sport și radio vorbit.',
    },
    contact: {
      title: 'Contact Mega Radio — Ia Legătura',
      description: 'Contactează echipa Mega Radio pentru suport, feedback sau parteneriate. Suntem aici să te ajutăm cu experiența ta de radio online gratuit.',
    },
    applications: {
      title: 'Aplicații Mega Radio — iOS, Android, Smart TV și Desktop',
      description: 'Descarcă aplicațiile gratuite Mega Radio pentru iOS, Android, Smart TV, Apple TV, Roku și desktop. Ascultă 60.000+ posturi live din 120+ țări oriunde.',
    },
  },
  bg: {
    about: {
      title: 'За Mega Radio — безплатна онлайн радио платформа',
      description: 'Запознайте се с Mega Radio: безплатната онлайн платформа с 60 000+ радиостанции на живо от 120+ държави. Слушайте музика, новини, спорт и токшоу.',
    },
    contact: {
      title: 'Контакти Mega Radio — свържете се с нас',
      description: 'Свържете се с екипа на Mega Radio за поддръжка, обратна връзка или партньорство. Тук сме, за да помогнем с безплатното ви онлайн радио изживяване.',
    },
    applications: {
      title: 'Приложения Mega Radio — iOS, Android, Smart TV и десктоп',
      description: 'Изтеглете безплатните приложения Mega Radio за iOS, Android, Smart TV, Apple TV, Roku и десктоп. Слушайте 60 000+ станции от 120+ държави навсякъде.',
    },
  },
  hr: {
    about: {
      title: 'O Mega Radiju — besplatna online radio platforma',
      description: 'Upoznajte Mega Radio: besplatnu online radio platformu s 60.000+ uživo stanica iz 120+ zemalja. Slušajte glazbu, vijesti, sport i govorni radio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — javite nam se',
      description: 'Kontaktirajte tim Mega Radija za podršku, povratne informacije ili partnerstva. Tu smo za vaše besplatno iskustvo online radija.',
    },
    applications: {
      title: 'Mega Radio aplikacije — iOS, Android, Smart TV i desktop',
      description: 'Preuzmite besplatne Mega Radio aplikacije za iOS, Android, Smart TV, Apple TV, Roku i desktop. Slušajte 60.000+ uživo stanica iz 120+ zemalja.',
    },
  },
  sr: {
    about: {
      title: 'О Mega Radio — бесплатна онлајн радио платформа',
      description: 'Упознајте Mega Radio: бесплатну онлајн радио платформу са 60.000+ станица уживо из 120+ земаља. Слушајте музику, вести, спорт и говорни радио.',
    },
    contact: {
      title: 'Контакт Mega Radio — јавите нам се',
      description: 'Контактирајте тим Mega Radio за подршку, повратне информације или партнерство. Ту смо за ваше бесплатно искуство онлајн радија.',
    },
    applications: {
      title: 'Mega Radio апликације — iOS, Android, Smart TV и десктоп',
      description: 'Преузмите бесплатне Mega Radio апликације за iOS, Android, Smart TV, Apple TV, Roku и десктоп. Слушајте 60.000+ станица уживо из 120+ земаља.',
    },
  },
  sl: {
    about: {
      title: 'O Mega Radiu — brezplačna spletna radijska platforma',
      description: 'Spoznajte Mega Radio: brezplačno spletno radijsko platformo s 60.000+ postajami v živo iz 120+ držav. Poslušajte glasbo, novice, šport in govorni radio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — pišite nam',
      description: 'Stopite v stik z ekipo Mega Radio za podporo, povratne informacije ali sodelovanje. Tu smo za vašo brezplačno spletno radijsko izkušnjo.',
    },
    applications: {
      title: 'Aplikacije Mega Radio — iOS, Android, Smart TV in namizje',
      description: 'Prenesite brezplačne aplikacije Mega Radio za iOS, Android, Smart TV, Apple TV, Roku in namizje. Poslušajte 60.000+ postaj v živo iz 120+ držav.',
    },
  },
  lv: {
    about: {
      title: 'Par Mega Radio — bezmaksas tiešsaistes radio platforma',
      description: 'Iepazīstiet Mega Radio: bezmaksas tiešsaistes radio platformu ar 60 000+ tiešraides stacijām no 120+ valstīm. Klausieties mūziku, ziņas, sportu un sarunas.',
    },
    contact: {
      title: 'Kontakti Mega Radio — sazinieties ar mums',
      description: 'Sazinieties ar Mega Radio komandu atbalstam, atsauksmēm vai sadarbībai. Esam šeit, lai palīdzētu ar jūsu bezmaksas tiešsaistes radio pieredzi.',
    },
    applications: {
      title: 'Mega Radio lietotnes — iOS, Android, Smart TV un dators',
      description: 'Lejupielādējiet bezmaksas Mega Radio lietotnes iOS, Android, Smart TV, Apple TV, Roku un datoram. Klausieties 60 000+ tiešraides staciju no 120+ valstīm.',
    },
  },
  lt: {
    about: {
      title: 'Apie Mega Radio — nemokama internetinio radijo platforma',
      description: 'Susipažinkite su Mega Radio: nemokama internetinio radijo platforma su 60 000+ tiesioginių stočių iš 120+ šalių. Klausykite muzikos, naujienų, sporto.',
    },
    contact: {
      title: 'Kontaktai Mega Radio — susisiekite',
      description: 'Susisiekite su Mega Radio komanda dėl pagalbos, atsiliepimų ar bendradarbiavimo. Padėsime su jūsų nemokama internetinio radijo patirtimi.',
    },
    applications: {
      title: 'Mega Radio programėlės — iOS, Android, Smart TV ir kompiuteris',
      description: 'Atsisiųskite nemokamas Mega Radio programėles iOS, Android, Smart TV, Apple TV, Roku ir kompiuteriui. Klausykite 60 000+ tiesioginių stočių iš 120+ šalių.',
    },
  },
  et: {
    about: {
      title: 'Mega Radiost — tasuta veebiraadio platvorm',
      description: 'Tutvuge Mega Radioga: tasuta veebiraadio platvormiga, kus on 60 000+ otseülekande jaama 120+ riigist. Kuulake muusikat, uudiseid, sporti ja kõneraadiot.',
    },
    contact: {
      title: 'Mega Radio kontakt — võta ühendust',
      description: 'Võta ühendust Mega Radio meeskonnaga toe, tagasiside või koostöö osas. Aitame hea meelega sinu tasuta veebiraadio kogemusega.',
    },
    applications: {
      title: 'Mega Radio rakendused — iOS, Android, Smart TV ja arvuti',
      description: 'Laadi alla tasuta Mega Radio rakendused iOS, Android, Smart TV, Apple TV, Roku ja arvutile. Kuula 60 000+ otseülekande jaama 120+ riigist kõikjal.',
    },
  },
  zh: {
    about: {
      title: '关于 Mega Radio — 免费在线广播平台',
      description: '了解 Mega Radio：免费在线广播平台，覆盖 120 多个国家、60,000+ 直播电台。畅听音乐、新闻、体育和谈话广播。',
    },
    contact: {
      title: '联系 Mega Radio — 与我们联系 — themegaradio.com',
      description: '联系 Mega Radio 团队，获取支持、反馈或合作机会。我们随时为您的免费在线广播体验提供帮助。',
    },
    applications: {
      title: 'Mega Radio 应用 — iOS、Android、智能电视与桌面',
      description: '免费下载 Mega Radio 应用，支持 iOS、Android、智能电视、Apple TV、Roku 和桌面。畅听来自 120+ 国家的 60,000+ 直播电台。',
    },
  },
  ja: {
    about: {
      title: 'Mega Radio について — 無料オンラインラジオ',
      description: 'Mega Radio をご紹介します：120 以上の国・60,000 以上のライブ局を備えた無料オンラインラジオ。音楽、ニュース、スポーツ、トーク番組をお楽しみください。',
    },
    contact: {
      title: 'Mega Radio お問い合わせ — themegaradio.com',
      description: 'サポート、フィードバック、提携のご相談は Mega Radio チームへお気軽にどうぞ。無料オンラインラジオ体験をサポートします。',
    },
    applications: {
      title: 'Mega Radio アプリ — iOS、Android、スマート TV、デスクトップ',
      description: 'iOS、Android、スマート TV、Apple TV、Roku、デスクトップ向けの無料 Mega Radio アプリをダウンロード。120 以上の国の 60,000+ 局をどこでも。',
    },
  },
  ko: {
    about: {
      title: 'Mega Radio 소개 — 무료 온라인 라디오 플랫폼',
      description: 'Mega Radio를 소개합니다: 120개 이상의 국가에서 60,000개 이상의 라이브 방송국을 제공하는 무료 온라인 라디오 플랫폼. 음악, 뉴스, 스포츠, 토크 라디오.',
    },
    contact: {
      title: 'Mega Radio 문의 — 연락하기 — themegaradio.com',
      description: '지원, 피드백 또는 파트너십 문의는 Mega Radio 팀에 연락해 주세요. 무료 온라인 라디오 청취 경험을 도와드립니다.',
    },
    applications: {
      title: 'Mega Radio 앱 — iOS, Android, 스마트 TV 및 데스크톱',
      description: 'iOS, Android, 스마트 TV, Apple TV, Roku, 데스크톱용 무료 Mega Radio 앱을 다운로드하세요. 120+ 국가의 60,000+ 라이브 방송국을 어디서나.',
    },
  },
  hi: {
    about: {
      title: 'Mega Radio के बारे में — मुफ़्त ऑनलाइन रेडियो',
      description: 'Mega Radio के बारे में जानें: 120+ देशों के 60,000+ लाइव स्टेशनों वाला मुफ़्त ऑनलाइन रेडियो प्लेटफ़ॉर्म। संगीत, समाचार, खेल और टॉक रेडियो सुनें।',
    },
    contact: {
      title: 'Mega Radio संपर्क — हमसे जुड़ें',
      description: 'सहायता, प्रतिक्रिया या साझेदारी के लिए Mega Radio टीम से संपर्क करें। मुफ़्त ऑनलाइन रेडियो अनुभव में आपकी मदद के लिए हम मौजूद हैं।',
    },
    applications: {
      title: 'Mega Radio ऐप्स — iOS, Android, Smart TV और डेस्कटॉप',
      description: 'iOS, Android, Smart TV, Apple TV, Roku और डेस्कटॉप के लिए मुफ़्त Mega Radio ऐप्स डाउनलोड करें। 120+ देशों से 60,000+ लाइव स्टेशन हर जगह सुनें।',
    },
  },
  th: {
    about: {
      title: 'เกี่ยวกับ Mega Radio — แพลตฟอร์มวิทยุออนไลน์ฟรี',
      description: 'รู้จัก Mega Radio: แพลตฟอร์มวิทยุออนไลน์ฟรี รวมสถานีสด 60,000+ จาก 120+ ประเทศ ฟังเพลง ข่าว กีฬา และรายการสนทนาได้ทั่วโลก',
    },
    contact: {
      title: 'ติดต่อ Mega Radio — themegaradio.com',
      description: 'ติดต่อทีม Mega Radio สำหรับการสนับสนุน คำติชม หรือความร่วมมือ เราพร้อมช่วยเหลือประสบการณ์การฟังวิทยุออนไลน์ฟรีของคุณ',
    },
    applications: {
      title: 'แอป Mega Radio — iOS, Android, Smart TV และเดสก์ท็อป',
      description: 'ดาวน์โหลดแอป Mega Radio ฟรีสำหรับ iOS, Android, Smart TV, Apple TV, Roku และเดสก์ท็อป ฟังสถานีวิทยุสด 60,000+ จาก 120+ ประเทศได้ทุกที่',
    },
  },
  vi: {
    about: {
      title: 'Giới thiệu Mega Radio — Nền tảng radio trực tuyến miễn phí',
      description: 'Tìm hiểu Mega Radio: nền tảng radio trực tuyến miễn phí với 60.000+ đài phát trực tiếp từ 120+ quốc gia. Nghe nhạc, tin tức, thể thao và chương trình nói.',
    },
    contact: {
      title: 'Liên hệ Mega Radio — Kết nối với chúng tôi',
      description: 'Liên hệ đội ngũ Mega Radio để được hỗ trợ, góp ý hoặc hợp tác. Chúng tôi sẵn sàng giúp bạn với trải nghiệm radio trực tuyến miễn phí.',
    },
    applications: {
      title: 'Ứng dụng Mega Radio — iOS, Android, Smart TV và máy tính',
      description: 'Tải ứng dụng Mega Radio miễn phí cho iOS, Android, Smart TV, Apple TV, Roku và máy tính. Nghe 60.000+ đài radio trực tiếp từ 120+ quốc gia mọi nơi.',
    },
  },
  id: {
    about: {
      title: 'Tentang Mega Radio — Platform Radio Online Gratis',
      description: 'Kenali Mega Radio: platform radio online gratis dengan 60.000+ stasiun langsung dari 120+ negara. Dengarkan musik, berita, olahraga, dan radio bincang.',
    },
    contact: {
      title: 'Kontak Mega Radio — Hubungi Kami',
      description: 'Hubungi tim Mega Radio untuk dukungan, masukan, atau kerja sama. Kami siap membantu pengalaman radio online gratis Anda di seluruh dunia.',
    },
    applications: {
      title: 'Aplikasi Mega Radio — iOS, Android, Smart TV & Desktop',
      description: 'Unduh aplikasi Mega Radio gratis untuk iOS, Android, Smart TV, Apple TV, Roku, dan desktop. Dengarkan 60.000+ stasiun langsung dari 120+ negara.',
    },
  },
  ms: {
    about: {
      title: 'Tentang Mega Radio — Platform Radio Dalam Talian Percuma',
      description: 'Kenali Mega Radio: platform radio dalam talian percuma dengan 60,000+ stesen langsung dari 120+ negara. Dengar muzik, berita, sukan dan radio bual.',
    },
    contact: {
      title: 'Hubungi Mega Radio — themegaradio.com',
      description: 'Hubungi pasukan Mega Radio untuk sokongan, maklum balas atau kerjasama. Kami di sini untuk membantu pengalaman radio dalam talian percuma anda.',
    },
    applications: {
      title: 'Aplikasi Mega Radio — iOS, Android, Smart TV & Desktop',
      description: 'Muat turun aplikasi Mega Radio percuma untuk iOS, Android, Smart TV, Apple TV, Roku dan desktop. Dengar 60,000+ stesen langsung dari 120+ negara.',
    },
  },
  tl: {
    about: {
      title: 'Tungkol sa Mega Radio — Libreng Online Radio Platform',
      description: 'Alamin ang tungkol sa Mega Radio: libreng online radio platform na may 60,000+ live stations mula sa 120+ bansa. Makinig ng musika, balita, at sports.',
    },
    contact: {
      title: 'Makipag-ugnayan sa Mega Radio — themegaradio.com',
      description: 'Makipag-ugnayan sa Mega Radio team para sa suporta, feedback o partnership. Nandito kami para tulungan ang libreng online radio experience mo.',
    },
    applications: {
      title: 'Mga Mega Radio Apps — iOS, Android, Smart TV at Desktop',
      description: 'I-download ang libreng Mega Radio apps para sa iOS, Android, Smart TV, Apple TV, Roku at desktop. Makinig sa 60,000+ live stations mula sa 120+ bansa.',
    },
  },
  he: {
    about: {
      title: 'אודות Mega Radio — פלטפורמת רדיו אינטרנטי חינם',
      description: 'הכירו את Mega Radio: פלטפורמת רדיו אינטרנטי חינם עם 60,000+ תחנות חיות מ-120+ מדינות. האזינו למוזיקה, חדשות, ספורט ורדיו דיבור.',
    },
    contact: {
      title: 'יצירת קשר עם Mega Radio — themegaradio.com',
      description: 'צרו קשר עם צוות Mega Radio לתמיכה, משוב או שותפויות. אנחנו כאן כדי לעזור לכם בחוויית הרדיו האינטרנטי החינם שלכם.',
    },
    applications: {
      title: 'אפליקציות Mega Radio — iOS, Android, Smart TV ומחשב',
      description: 'הורידו את אפליקציות Mega Radio בחינם ל-iOS, Android, Smart TV, Apple TV, Roku ומחשב. האזינו ל-60,000+ תחנות חיות מ-120+ מדינות בכל מקום.',
    },
  },
  fa: {
    about: {
      title: 'درباره Mega Radio — پلتفرم رادیوی آنلاین رایگان',
      description: 'با Mega Radio آشنا شوید: پلتفرم رادیوی آنلاین رایگان با بیش از ۶۰٬۰۰۰ ایستگاه زنده از ۱۲۰+ کشور. به موسیقی، اخبار، ورزش و گفت‌وگو گوش دهید.',
    },
    contact: {
      title: 'تماس با Mega Radio — themegaradio.com',
      description: 'برای پشتیبانی، بازخورد یا همکاری با تیم Mega Radio تماس بگیرید. ما اینجا هستیم تا در تجربه رادیوی آنلاین رایگان شما کمک کنیم.',
    },
    applications: {
      title: 'برنامه‌های Mega Radio — iOS، Android، Smart TV و دسکتاپ',
      description: 'برنامه‌های رایگان Mega Radio را برای iOS، Android، Smart TV، Apple TV، Roku و دسکتاپ دانلود کنید. به ۶۰٬۰۰۰+ ایستگاه زنده از ۱۲۰+ کشور گوش دهید.',
    },
  },
  ur: {
    about: {
      title: 'Mega Radio کے بارے میں — مفت آن لائن ریڈیو پلیٹ فارم',
      description: 'Mega Radio کے بارے میں جانیں: 120+ ممالک سے 60,000+ لائیو اسٹیشنز کے ساتھ مفت آن لائن ریڈیو پلیٹ فارم۔ موسیقی، خبریں، کھیل اور بات چیت سنیں۔',
    },
    contact: {
      title: 'Mega Radio سے رابطہ — themegaradio.com',
      description: 'سپورٹ، رائے یا شراکت داری کے لیے Mega Radio ٹیم سے رابطہ کریں۔ ہم آپ کے مفت آن لائن ریڈیو تجربے میں مدد کے لیے حاضر ہیں۔',
    },
    applications: {
      title: 'Mega Radio ایپس — iOS، Android، سمارٹ ٹی وی اور ڈیسک ٹاپ',
      description: 'iOS، Android، سمارٹ ٹی وی، Apple TV، Roku اور ڈیسک ٹاپ کے لیے مفت Mega Radio ایپس ڈاؤن لوڈ کریں۔ 120+ ممالک سے 60,000+ لائیو اسٹیشنز سنیں۔',
    },
  },
  bn: {
    about: {
      title: 'Mega Radio সম্পর্কে — বিনামূল্যে অনলাইন রেডিও',
      description: 'Mega Radio সম্পর্কে জানুন: 120+ দেশ থেকে 60,000+ লাইভ স্টেশনযুক্ত বিনামূল্যে অনলাইন রেডিও প্ল্যাটফর্ম। গান, খবর, খেলা ও টক রেডিও শুনুন।',
    },
    contact: {
      title: 'Mega Radio যোগাযোগ — themegaradio.com',
      description: 'সহায়তা, প্রতিক্রিয়া বা অংশীদারিত্বের জন্য Mega Radio দলের সাথে যোগাযোগ করুন। আপনার বিনামূল্যে অনলাইন রেডিও অভিজ্ঞতার জন্য আমরা এখানে আছি।',
    },
    applications: {
      title: 'Mega Radio অ্যাপ — iOS, Android, Smart TV ও ডেস্কটপ',
      description: 'iOS, Android, Smart TV, Apple TV, Roku ও ডেস্কটপের জন্য বিনামূল্যে Mega Radio অ্যাপ ডাউনলোড করুন। 120+ দেশ থেকে 60,000+ লাইভ স্টেশন শুনুন।',
    },
  },
  ta: {
    about: {
      title: 'Mega Radio பற்றி — இலவச ஆன்லைன் வானொலி',
      description: 'Mega Radio பற்றி அறியுங்கள்: 120+ நாடுகளில் இருந்து 60,000+ நேரடி நிலையங்களுடன் இலவச ஆன்லைன் வானொலி தளம். இசை, செய்தி, விளையாட்டு கேளுங்கள்.',
    },
    contact: {
      title: 'Mega Radio தொடர்பு — themegaradio.com',
      description: 'ஆதரவு, கருத்து அல்லது கூட்டாண்மைக்காக Mega Radio குழுவை தொடர்பு கொள்ளுங்கள். உங்கள் இலவச ஆன்லைன் வானொலி அனுபவத்திற்காக நாங்கள் இங்கே இருக்கிறோம்.',
    },
    applications: {
      title: 'Mega Radio பயன்பாடுகள் — iOS, Android, Smart TV மற்றும் கணினி',
      description: 'iOS, Android, Smart TV, Apple TV, Roku மற்றும் கணினிக்கான இலவச Mega Radio பயன்பாடுகளை பதிவிறக்கம் செய்க. 120+ நாடுகளில் 60,000+ நேரடி நிலையங்கள்.',
    },
  },
  te: {
    about: {
      title: 'Mega Radio గురించి — ఉచిత ఆన్‌లైన్ రేడియో',
      description: 'Mega Radio గురించి తెలుసుకోండి: 120+ దేశాల నుండి 60,000+ లైవ్ స్టేషన్‌లతో ఉచిత ఆన్‌లైన్ రేడియో ప్లాట్‌ఫారమ్. సంగీతం, వార్తలు, క్రీడలు వినండి.',
    },
    contact: {
      title: 'Mega Radio సంప్రదించండి — themegaradio.com',
      description: 'మద్దతు, అభిప్రాయం లేదా భాగస్వామ్యం కోసం Mega Radio బృందాన్ని సంప్రదించండి. మీ ఉచిత ఆన్‌లైన్ రేడియో అనుభవానికి మేము ఇక్కడ ఉన్నాము.',
    },
    applications: {
      title: 'Mega Radio యాప్‌లు — iOS, Android, Smart TV & డెస్క్‌టాప్',
      description: 'iOS, Android, Smart TV, Apple TV, Roku & డెస్క్‌టాప్ కోసం ఉచిత Mega Radio యాప్‌లను డౌన్‌లోడ్ చేసుకోండి. 120+ దేశాల నుండి 60,000+ లైవ్ స్టేషన్‌లు వినండి.',
    },
  },
  mr: {
    about: {
      title: 'Mega Radio बद्दल — मोफत ऑनलाइन रेडिओ प्लॅटफॉर्म',
      description: 'Mega Radio बद्दल जाणून घ्या: 120+ देशांमधील 60,000+ थेट स्टेशनसह मोफत ऑनलाइन रेडिओ प्लॅटफॉर्म. संगीत, बातम्या, खेळ आणि टॉक रेडिओ ऐका.',
    },
    contact: {
      title: 'Mega Radio संपर्क — themegaradio.com',
      description: 'सहाय्य, अभिप्राय किंवा भागीदारीसाठी Mega Radio टीमशी संपर्क साधा. तुमच्या मोफत ऑनलाइन रेडिओ अनुभवासाठी आम्ही येथे आहोत.',
    },
    applications: {
      title: 'Mega Radio अ‍ॅप्स — iOS, Android, Smart TV आणि डेस्कटॉप',
      description: 'iOS, Android, Smart TV, Apple TV, Roku आणि डेस्कटॉपसाठी मोफत Mega Radio अ‍ॅप्स डाउनलोड करा. 120+ देशांमधील 60,000+ थेट स्टेशन ऐका.',
    },
  },
  gu: {
    about: {
      title: 'Mega Radio વિશે — મફત ઓનલાઇન રેડિયો પ્લેટફોર્મ',
      description: 'Mega Radio વિશે જાણો: 120+ દેશોના 60,000+ લાઇવ સ્ટેશન્સ સાથેનું મફત ઓનલાઇન રેડિયો પ્લેટફોર્મ. સંગીત, સમાચાર, રમતગમત અને ટૉક રેડિયો સાંભળો.',
    },
    contact: {
      title: 'Mega Radio સંપર્ક — themegaradio.com',
      description: 'સહાય, અભિપ્રાય અથવા ભાગીદારી માટે Mega Radio ટીમનો સંપર્ક કરો. તમારા મફત ઓનલાઇન રેડિયો અનુભવમાં મદદ કરવા અમે અહીં છીએ.',
    },
    applications: {
      title: 'Mega Radio એપ્સ — iOS, Android, Smart TV અને ડેસ્કટોપ',
      description: 'iOS, Android, Smart TV, Apple TV, Roku અને ડેસ્કટોપ માટે મફત Mega Radio એપ્સ ડાઉનલોડ કરો. 120+ દેશોના 60,000+ લાઇવ સ્ટેશન સાંભળો.',
    },
  },
  kn: {
    about: {
      title: 'Mega Radio ಬಗ್ಗೆ — ಉಚಿತ ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ವೇದಿಕೆ',
      description: 'Mega Radio ಬಗ್ಗೆ ತಿಳಿಯಿರಿ: 120+ ದೇಶಗಳ 60,000+ ನೇರ ಸ್ಟೇಷನ್‌ಗಳೊಂದಿಗೆ ಉಚಿತ ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ವೇದಿಕೆ. ಸಂಗೀತ, ಸುದ್ದಿ, ಕ್ರೀಡೆ, ಚರ್ಚಾ ರೇಡಿಯೋ ಕೇಳಿ.',
    },
    contact: {
      title: 'Mega Radio ಸಂಪರ್ಕ — themegaradio.com',
      description: 'ಬೆಂಬಲ, ಅಭಿಪ್ರಾಯ ಅಥವಾ ಸಹಭಾಗಿತ್ವಕ್ಕಾಗಿ Mega Radio ತಂಡವನ್ನು ಸಂಪರ್ಕಿಸಿ. ನಿಮ್ಮ ಉಚಿತ ಆನ್‌ಲೈನ್ ರೇಡಿಯೋ ಅನುಭವಕ್ಕೆ ನಾವು ಸಹಾಯ ಮಾಡಲು ಇಲ್ಲಿದ್ದೇವೆ.',
    },
    applications: {
      title: 'Mega Radio ಅಪ್ಲಿಕೇಶನ್‌ಗಳು — iOS, Android, Smart TV, ಡೆಸ್ಕ್‌ಟಾಪ್',
      description: 'iOS, Android, Smart TV, Apple TV, Roku ಮತ್ತು ಡೆಸ್ಕ್‌ಟಾಪ್‌ಗೆ ಉಚಿತ Mega Radio ಅಪ್ಲಿಕೇಶನ್‌ಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ. 120+ ದೇಶಗಳ 60,000+ ನೇರ ಸ್ಟೇಷನ್‌ಗಳು.',
    },
  },
  ml: {
    about: {
      title: 'Mega Radio കുറിച്ച് — സൗജന്യ ഓൺലൈൻ റേഡിയോ പ്ലാറ്റ്‌ഫോം',
      description: 'Mega Radio പരിചയപ്പെടൂ: 120+ രാജ്യങ്ങളിൽ നിന്ന് 60,000+ ലൈവ് സ്റ്റേഷനുകളുള്ള സൗജന്യ ഓൺലൈൻ റേഡിയോ പ്ലാറ്റ്‌ഫോം. സംഗീതം, വാർത്ത, കായികം, ടോക്ക് റേഡിയോ.',
    },
    contact: {
      title: 'Mega Radio ബന്ധപ്പെടുക — themegaradio.com',
      description: 'പിന്തുണ, ഫീഡ്‌ബാക്ക് അല്ലെങ്കിൽ പങ്കാളിത്തത്തിനായി Mega Radio ടീമിനെ ബന്ധപ്പെടുക. നിങ്ങളുടെ സൗജന്യ ഓൺലൈൻ റേഡിയോ അനുഭവത്തിന് ഞങ്ങൾ ഇവിടെയുണ്ട്.',
    },
    applications: {
      title: 'Mega Radio ആപ്പുകൾ — iOS, Android, Smart TV, ഡെസ്ക്ടോപ്പ്',
      description: 'iOS, Android, Smart TV, Apple TV, Roku, ഡെസ്ക്ടോപ്പിനായി സൗജന്യ Mega Radio ആപ്പുകൾ ഡൗൺലോഡ് ചെയ്യുക. 120+ രാജ്യങ്ങളിൽ നിന്ന് 60,000+ ലൈവ് സ്റ്റേഷനുകൾ.',
    },
  },
  pa: {
    about: {
      title: 'Mega Radio ਬਾਰੇ — ਮੁਫ਼ਤ ਆਨਲਾਈਨ ਰੇਡੀਓ ਪਲੇਟਫਾਰਮ',
      description: 'Mega Radio ਬਾਰੇ ਜਾਣੋ: 120+ ਦੇਸ਼ਾਂ ਦੇ 60,000+ ਲਾਈਵ ਸਟੇਸ਼ਨਾਂ ਵਾਲਾ ਮੁਫ਼ਤ ਆਨਲਾਈਨ ਰੇਡੀਓ ਪਲੇਟਫਾਰਮ। ਸੰਗੀਤ, ਖ਼ਬਰਾਂ, ਖੇਡਾਂ ਅਤੇ ਟਾਕ ਰੇਡੀਓ ਸੁਣੋ।',
    },
    contact: {
      title: 'Mega Radio ਸੰਪਰਕ — themegaradio.com',
      description: 'ਸਹਾਇਤਾ, ਫ਼ੀਡਬੈਕ ਜਾਂ ਭਾਈਵਾਲੀ ਲਈ Mega Radio ਟੀਮ ਨਾਲ ਸੰਪਰਕ ਕਰੋ। ਤੁਹਾਡੇ ਮੁਫ਼ਤ ਆਨਲਾਈਨ ਰੇਡੀਓ ਅਨੁਭਵ ਲਈ ਅਸੀਂ ਇੱਥੇ ਹਾਂ।',
    },
    applications: {
      title: 'Mega Radio ਐਪਸ — iOS, Android, Smart TV ਅਤੇ ਡੈਸਕਟਾਪ',
      description: 'iOS, Android, Smart TV, Apple TV, Roku ਅਤੇ ਡੈਸਕਟਾਪ ਲਈ ਮੁਫ਼ਤ Mega Radio ਐਪਸ ਡਾਊਨਲੋਡ ਕਰੋ। 120+ ਦੇਸ਼ਾਂ ਤੋਂ 60,000+ ਲਾਈਵ ਸਟੇਸ਼ਨ ਸੁਣੋ।',
    },
  },
  sw: {
    about: {
      title: 'Kuhusu Mega Radio — Jukwaa la Redio Mtandaoni Bure',
      description: 'Jifunze kuhusu Mega Radio: jukwaa la redio mtandaoni bure lenye vituo 60,000+ vya moja kwa moja kutoka nchi 120+. Sikiliza muziki, habari, michezo na mazungumzo.',
    },
    contact: {
      title: 'Wasiliana na Mega Radio — themegaradio.com',
      description: 'Wasiliana na timu ya Mega Radio kwa msaada, maoni au ushirikiano. Tuko hapa kukusaidia katika tajriba yako ya redio mtandaoni bure.',
    },
    applications: {
      title: 'Programu za Mega Radio — iOS, Android, Smart TV na Desktop',
      description: 'Pakua programu za bure za Mega Radio kwa iOS, Android, Smart TV, Apple TV, Roku na desktop. Sikiliza vituo 60,000+ vya moja kwa moja kutoka nchi 120+.',
    },
  },
  am: {
    about: {
      title: 'ስለ Mega Radio — ነፃ የመስመር ላይ ራዲዮ መድረክ',
      description: 'ስለ Mega Radio ይወቁ፦ ከ120+ አገራት የ60,000+ ቀጥታ ጣቢያዎች ያለው ነፃ የመስመር ላይ ራዲዮ መድረክ። ሙዚቃ፣ ዜና፣ ስፖርት እና ውይይት ራዲዮ ያዳምጡ።',
    },
    contact: {
      title: 'Mega Radio ያግኙን — themegaradio.com',
      description: 'ለድጋፍ፣ አስተያየት ወይም ሽርክና የMega Radio ቡድንን ያግኙ። ለነፃ የመስመር ላይ ራዲዮ ተሞክሮዎ ለመርዳት እዚህ ነን።',
    },
    applications: {
      title: 'Mega Radio መተግበሪያዎች — iOS፣ Android፣ Smart TV እና ዴስክቶፕ',
      description: 'ለiOS፣ Android፣ Smart TV፣ Apple TV፣ Roku እና ዴስክቶፕ ነፃ Mega Radio መተግበሪያዎችን ያውርዱ። ከ120+ አገራት 60,000+ ቀጥታ ጣቢያዎችን በሁሉም ቦታ ያዳምጡ።',
    },
  },
  zu: {
    about: {
      title: 'Mayelana ne-Mega Radio — Inkundla Yomsakazo Wamahhala',
      description: 'Funda nge-Mega Radio: inkundla yomsakazo we-inthanethi yamahhala enezikhungo eziphilayo eziwu-60,000+ ezivela emazweni angu-120+. Lalela umculo, izindaba, ezemidlalo.',
    },
    contact: {
      title: 'Xhumana ne-Mega Radio — themegaradio.com',
      description: 'Xhumana neqembu le-Mega Radio ngokwesekwa, ukuphawula noma ubambiswano. Sikhona ukukusiza ngolwazi lwakho lomsakazo we-inthanethi mahhala.',
    },
    applications: {
      title: 'Izinhlelo zokusebenza ze-Mega Radio — iOS, Android, Smart TV',
      description: 'Landa izinhlelo zokusebenza zamahhala ze-Mega Radio ze-iOS, Android, Smart TV, Apple TV, Roku nedeskithophu. Lalela izikhungo eziwu-60,000+ emazweni angu-120+.',
    },
  },
  af: {
    about: {
      title: 'Oor Mega Radio — Gratis Aanlyn-Radioplatform',
      description: 'Leer meer oor Mega Radio: die gratis aanlyn-radioplatform met 60 000+ regstreekse stasies uit 120+ lande. Luister na musiek, nuus, sport en gespreksradio.',
    },
    contact: {
      title: 'Kontak Mega Radio — themegaradio.com',
      description: 'Kontak die Mega Radio-span vir ondersteuning, terugvoer of vennootskappe. Ons is hier om te help met jou gratis aanlyn-radio-ervaring.',
    },
    applications: {
      title: 'Mega Radio-programme — iOS, Android, Smart TV en Lessenaar',
      description: 'Laai gratis Mega Radio-programme af vir iOS, Android, Smart TV, Apple TV, Roku en lessenaar. Luister na 60 000+ regstreekse stasies uit 120+ lande oral.',
    },
  },
  sq: {
    about: {
      title: 'Rreth Mega Radio — Platforma e Radios Online Falas',
      description: 'Mësoni më shumë për Mega Radio: platforma online e radios falas me 60.000+ stacione live nga 120+ vende. Dëgjoni muzikë, lajme, sport dhe radio bisedimore.',
    },
    contact: {
      title: 'Kontakt Mega Radio — themegaradio.com',
      description: 'Kontaktoni ekipin e Mega Radio për mbështetje, komente ose partneritete. Ne jemi këtu për të ndihmuar me përvojën tuaj të radios online falas.',
    },
    applications: {
      title: 'Aplikacionet Mega Radio — iOS, Android, Smart TV dhe Desktop',
      description: 'Shkarkoni aplikacionet falas Mega Radio për iOS, Android, Smart TV, Apple TV, Roku dhe desktop. Dëgjoni 60.000+ stacione live nga 120+ vende kudo.',
    },
  },
  az: {
    about: {
      title: 'Mega Radio Haqqında — Pulsuz Onlayn Radio Platforması',
      description: 'Mega Radio ilə tanış olun: 120+ ölkədən 60.000+ canlı stansiyaya malik pulsuz onlayn radio platforması. Musiqi, xəbərlər, idman və söhbət radiosu dinləyin.',
    },
    contact: {
      title: 'Mega Radio Əlaqə — themegaradio.com',
      description: 'Dəstək, rəy və ya tərəfdaşlıq üçün Mega Radio komandası ilə əlaqə saxlayın. Pulsuz onlayn radio təcrübənizdə kömək etmək üçün buradayıq.',
    },
    applications: {
      title: 'Mega Radio Tətbiqləri — iOS, Android, Smart TV və Masaüstü',
      description: 'Pulsuz Mega Radio tətbiqlərini iOS, Android, Smart TV, Apple TV, Roku və masaüstü üçün yükləyin. 120+ ölkədən 60.000+ canlı stansiya hər yerdə dinləyin.',
    },
  },
  hy: {
    about: {
      title: 'Mega Radio-ի մասին — Անվճար առցանց ռադիո հարթակ',
      description: 'Ծանոթացեք Mega Radio-ի հետ՝ 120+ երկրների 60,000+ ուղիղ կայաններով անվճար առցանց ռադիո հարթակ։ Լսեք երաժշտություն, լուրեր, սպորտ և զրուցարան։',
    },
    contact: {
      title: 'Կապ Mega Radio-ի հետ — themegaradio.com',
      description: 'Կապվեք Mega Radio-ի թիմի հետ աջակցության, արձագանքի կամ համագործակցության համար։ Մենք այստեղ ենք՝ օգնելու ձեր անվճար առցանց ռադիոյի փորձառությանը։',
    },
    applications: {
      title: 'Mega Radio հավելվածներ — iOS, Android, Smart TV և համակարգիչ',
      description: 'Ներբեռնեք անվճար Mega Radio հավելվածները iOS, Android, Smart TV, Apple TV, Roku և համակարգչի համար։ Լսեք 60,000+ ուղիղ կայաններ 120+ երկրներից։',
    },
  },
  so: {
    about: {
      title: 'Ku saabsan Mega Radio — Madal Raadyo Onlayn ah oo Bilaash ah',
      description: 'Ka baro Mega Radio: madasha raadiyaha onlayn-ka ah ee bilaashka leh xafiisyo tooska ah 60,000+ oo ka kala yimid 120+ waddan. Dhageyso muusig, wararka, ciyaaraha.',
    },
    contact: {
      title: 'Nala soo xidhiidh Mega Radio — themegaradio.com',
      description: 'La xidhiidh kooxda Mega Radio si aad u hesho taageero, jawaab celin ama wadashaqayn. Waxaan halkan u joognaa inaan ku caawinno khibradaada raadiyaha bilaashka.',
    },
    applications: {
      title: 'Apps-ka Mega Radio — iOS, Android, Smart TV iyo Desktop',
      description: 'Soo deji apps-ka bilaashka ah ee Mega Radio ee iOS, Android, Smart TV, Apple TV, Roku iyo desktop. Dhageyso 60,000+ idaacadood oo tooska ah meel kasta.',
    },
  },
  uk: {
    about: {
      title: 'Про Mega Radio — Безкоштовна онлайн-платформа радіо',
      description: 'Дізнайтеся про Mega Radio: безкоштовну онлайн-платформу радіо з 60 000+ живих станцій з 120+ країн. Слухайте музику, новини, спорт і розмовне радіо.',
    },
    contact: {
      title: 'Контакти Mega Radio — звʼяжіться з нами',
      description: 'Звʼяжіться з командою Mega Radio для підтримки, відгуків або співпраці. Ми тут, щоб допомогти з вашим досвідом безкоштовного онлайн-радіо.',
    },
    applications: {
      title: 'Додатки Mega Radio — iOS, Android, Smart TV і компʼютер',
      description: 'Завантажте безкоштовні додатки Mega Radio для iOS, Android, Smart TV, Apple TV, Roku і компʼютера. Слухайте 60 000+ живих станцій з 120+ країн.',
    },
  },
  bs: {
    about: {
      title: 'O Mega Radiju — besplatna online radio platforma',
      description: 'Upoznajte Mega Radio: besplatnu online radio platformu sa 60.000+ uživo stanica iz 120+ zemalja. Slušajte muziku, vijesti, sport i govorni radio.',
    },
    contact: {
      title: 'Kontakt Mega Radio — javite nam se',
      description: 'Kontaktirajte tim Mega Radija za podršku, povratne informacije ili saradnju. Tu smo za vaše besplatno iskustvo online radija.',
    },
    applications: {
      title: 'Mega Radio aplikacije — iOS, Android, Smart TV i desktop',
      description: 'Preuzmite besplatne Mega Radio aplikacije za iOS, Android, Smart TV, Apple TV, Roku i desktop. Slušajte 60.000+ uživo stanica iz 120+ zemalja.',
    },
  },
};

/**
 * Get a per-language Static Page SEO template, falling back to English.
 */
export function getStaticPageSeoTemplate(language: string): StaticPageSeoTemplate {
  return STATIC_PAGE_SEO_TEMPLATES[language] || STATIC_PAGE_SEO_TEMPLATES.en;
}

// Word-boundary safe truncation. Mirrors legal-seo-templates clampGraphemes.
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

const DB_KEYS: Record<StaticPageKind, { title: string; description: string }> = {
  about: {
    title: 'about_mega_radio',
    description: 'about_mega_radio_description',
  },
  contact: {
    title: 'contact_page_title',
    description: 'contact_page_description',
  },
  applications: {
    title: 'applications_page_seo_title',
    description: 'applications_page_seo_description',
  },
};

/**
 * Builds title/description for the About, Contact or Applications page in the
 * given language.
 *
 * If `dbTranslations` provides the corresponding DB keys IN THE REQUESTED
 * LANGUAGE, they take precedence — otherwise we fall back to the per-language
 * template so we never serve a Turkish page with an English `<title>`.
 * Mirrors the override pattern used by buildLegalSeo / buildSearchSeo /
 * buildGenreSeo / buildCountrySeo.
 *
 * Defensive: enforces a 145-character maximum description length.
 */
export function buildStaticPageSeo(
  pageType: StaticPageKind,
  language: string,
  dbTranslations?: Record<string, string>,
): { title: string; description: string } {
  const tpl = getStaticPageSeoTemplate(language)[pageType];

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

  return { title, description };
}
