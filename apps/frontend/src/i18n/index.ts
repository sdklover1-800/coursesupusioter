import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES } from '@edu/shared';
import { ru } from './locales/ru';
import { kk } from './locales/kk';
import { en } from './locales/en';

/**
 * Локализация интерфейса (§6.2): ресурсные файлы по языкам, все строки — вне
 * компонентов. Предпочтение языка сохраняется в localStorage и синхронизируется
 * с профилем при входе.
 */
const STORAGE_KEY = 'edu.lang';
const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
const initial = stored && (LANGUAGES as readonly string[]).includes(stored) ? stored : 'ru';

void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    kk: { translation: kk },
    en: { translation: en },
  },
  lng: initial,
  fallbackLng: 'ru',
  supportedLngs: LANGUAGES as unknown as string[],
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lng);
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
});

export default i18n;
