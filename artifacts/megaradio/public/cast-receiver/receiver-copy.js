(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MegaReceiverCopy = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var rows = {
    en: ['Choose a radio in MegaRadio.', 'Connecting…', 'Buffering…', 'Now playing', 'Paused', 'Station unavailable'],
    tr: ['MegaRadio’dan bir radyo seç.', 'Bağlanıyor…', 'Yükleniyor…', 'Şu An Çalıyor', 'Duraklatıldı', 'Yayın açılamadı'],
    de: ['Wähle einen Sender in MegaRadio.', 'Verbindung wird hergestellt…', 'Wird geladen…', 'Wird gespielt', 'Pausiert', 'Sender nicht verfügbar'],
    fr: ['Choisissez une radio dans MegaRadio.', 'Connexion…', 'Chargement…', 'En cours de lecture', 'En pause', 'Station indisponible'],
    es: ['Elige una emisora en MegaRadio.', 'Conectando…', 'Cargando…', 'Reproduciendo', 'En pausa', 'Emisora no disponible'],
    it: ['Scegli una radio su MegaRadio.', 'Connessione…', 'Caricamento…', 'In riproduzione', 'In pausa', 'Stazione non disponibile'],
    pt: ['Escolha uma rádio no MegaRadio.', 'A ligar…', 'A carregar…', 'Em reprodução', 'Em pausa', 'Estação indisponível'],
    hi: ['MegaRadio में एक रेडियो चुनें।', 'कनेक्ट हो रहा है…', 'लोड हो रहा है…', 'अभी चल रहा है', 'रुका हुआ', 'स्टेशन उपलब्ध नहीं है'],
    he: ['בחרו תחנה ב־MegaRadio.', 'מתחבר…', 'בטעינה…', 'מתנגן כעת', 'מושהה', 'התחנה אינה זמינה'],
    ru: ['Выберите станцию в MegaRadio.', 'Подключение…', 'Загрузка…', 'Сейчас играет', 'Приостановлено', 'Станция недоступна'],
    ja: ['MegaRadioで放送局を選んでください。', '接続中…', '読み込み中…', '再生中', '一時停止中', '放送を再生できません'],
    ko: ['MegaRadio에서 방송국을 선택하세요.', '연결 중…', '불러오는 중…', '재생 중', '일시 중지됨', '방송을 재생할 수 없습니다'],
    zh: ['请在MegaRadio中选择电台。', '连接中…', '加载中…', '正在播放', '已暂停', '电台暂不可用'],
    ar: ['اختر محطة في MegaRadio.', 'جارٍ الاتصال…', 'جارٍ التحميل…', 'يُشغّل الآن', 'متوقف مؤقتًا', 'المحطة غير متاحة']
  };
  function locale(value) {
    var key = typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : 'en';
    if (key === 'iw') key = 'he';
    return Object.prototype.hasOwnProperty.call(rows, key) ? key : 'en';
  }
  function forLanguage(value) {
    var row = rows[locale(value)];
    return { idle: row[0], loading: row[1], buffering: row[2], playing: row[3], paused: row[4], error: row[5] };
  }
  return { locale: locale, forLanguage: forLanguage, languages: Object.keys(rows) };
}));
