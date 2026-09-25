import type { shell as ruShell } from '../ru/shell';
import type { Loc } from '../../types';

/** Қосымша қабығы: навигация, тақырып жолағы, мобильді панельдер, қызметтік беттер — иесі FE0. */
export const shell: Loc<typeof ruShell> = {
  skipToContent: 'Мазмұнға өту',
  home: 'Басты бет', catalog: 'Каталог', certificates: 'Сертификаттар', profile: 'Профиль', more: 'Тағы',
  tabCertificates: 'Сертификат',
  issues: 'Контенттегі қателер', logout: 'Шығу',
  mainNav: 'Негізгі навигация', tabBar: 'Бөлімдер', menu: 'Мәзір', moreMenu: 'Қосымша мәзір',
  language: 'Интерфейс тілі',
  langShort: { kk: 'Қаз', ru: 'Рус', en: 'Eng' },
  darkTheme: 'Қараңғы режим', lightTheme: 'Жарық режим', systemTheme: 'Жүйедегідей',
  a11y: 'Нашар көретіндерге арналған нұсқа',
  exitFocus: 'Шығу',
  sessionExpired: 'Сессия мерзімі өтті. Қайта кіріңіз.',
  verifyCertificate: 'Сертификатты тексеру',
  notFound: {
    title: 'Бет табылмады',
    text: 'Сілтеме ескірген немесе мекенжайда қате болуы мүмкін.',
  },
  forbidden: {
    title: 'Қолжетімділік жоқ',
    text: 'Сіздің рөліңізге бұл бөлімге кіру құқығы берілмеген.',
  },
  toHome: 'Басты бетке',
  stub: 'Әзірленуде', stubHint: 'Бөлім жақын арадағы жаңартуда пайда болады.',
  pages: {
    profile: 'Профиль', verify: 'Сертификатты тексеру', issues: 'Контенттегі қателер', audit: 'Әрекеттер аудиті',
  },
};
