// i18n（上架硬要求：中/日/英三语，i18next + locales json）
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from '../locales/zh.json';
import en from '../locales/en.json';
import jp from '../locales/jp.json';

export function initI18n(lang: 'zh' | 'en' | 'jp' = 'zh'): typeof i18n {
  i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      jp: { translation: jp },
    },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  return i18n;
}

export default i18n;
