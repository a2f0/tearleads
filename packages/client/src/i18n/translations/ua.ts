import type { I18NextTranslations } from './types';

export const ua = {
  common: {
    language: 'Мова',
    languageName: 'Українська',
    selectLanguage: 'Вибрати мову',
    settings: 'Налаштування',
    theme: 'Тема',
    themeDescription: 'Виберіть бажану колірну тему'
  },
  menu: {
    home: 'Головна',
    files: 'Файли',
    contacts: 'Контакти',
    photos: 'Фото',
    documents: 'Документи',
    audio: 'Аудіо',
    tables: 'Таблиці',
    analytics: 'Аналітика',
    sqlite: 'SQLite',
    debug: 'Налагодження',
    opfs: 'OPFS',
    cacheStorage: 'Кеш',
    localStorage: 'Локальне сховище',
    keychain: "Зв'язка ключів",
    chat: 'Чат',
    models: 'Моделі',
    admin: 'Адмін',
    settings: 'Налаштування'
  }
} as const satisfies I18NextTranslations;
