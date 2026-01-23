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
    help: 'Допомога',
    notes: 'Нотатки',
    audio: 'Аудіо',
    videos: 'Відео',
    tables: 'Таблиці',
    analytics: 'Аналітика',
    sqlite: 'SQLite',
    console: 'Консоль',
    debug: 'Налагодження',
    opfs: 'OPFS',
    cacheStorage: 'Кеш',
    localStorage: 'Локальне сховище',
    keychain: "Зв'язка ключів",
    chat: 'Чат',
    models: 'Моделі',
    admin: 'Адмін',
    postgresAdmin: 'Адмін Postgres',
    settings: 'Налаштування',
    email: 'Пошта',
    sync: 'Синхронізація'
  },
  audio: {
    play: 'Відтворити',
    pause: 'Пауза',
    previousTrack: 'Попередній трек',
    nextTrack: 'Наступний трек',
    restart: 'Перезапустити трек',
    rewind: 'Перемотати назад',
    close: 'Закрити плеєр',
    repeatOff: 'Повтор: Вимкнено',
    repeatAll: 'Повтор: Усі треки',
    repeatOne: 'Повтор: Поточний трек'
  },
  tooltips: {
    sseConnected: 'SSE: Підключено',
    sseConnecting: 'SSE: Підключення',
    sseDisconnected: "SSE: Від'єднано",
    keychainSalt:
      'Випадкове значення, що використовується з вашим паролем для створення ключа шифрування',
    keychainKeyCheckValue:
      'Хеш для перевірки правильності пароля без його збереження',
    keychainSessionWrappingKey:
      "Тимчасовий ключ, що шифрує дані сесії в пам'яті",
    keychainSessionWrappedKey:
      'Ваш ключ шифрування, захищений ключем обгортки сесії'
  },
  contextMenu: {
    play: 'Відтворити',
    pause: 'Пауза',
    getInfo: 'Інформація',
    viewDetails: 'Детальніше',
    download: 'Завантажити',
    share: 'Поділитися',
    edit: 'Редагувати',
    delete: 'Видалити',
    restore: 'Відновити',
    exportVCard: 'Експортувати vCard',
    newNote: 'Нова Нотатка'
  },
  settings: {
    font: 'Шрифт',
    fontDescription: 'Виберіть бажаний стиль шрифту',
    fontSystem: 'Системний',
    fontMonospace: 'Моноширинний',
    iconDepth: 'Глибина значків',
    iconDepthDescription:
      'Оберіть, чи виглядають значки опуклими або втиснутими',
    iconDepthEmbossed: 'Опуклі',
    iconDepthDebossed: 'Втиснуті',
    tooltips: 'Підказки',
    tooltipsDescription:
      'Показувати корисні підказки при наведенні на елементи',
    tooltipsEnabled: 'Увімкнено',
    tooltipsDisabled: 'Вимкнено'
  }
} as const satisfies I18NextTranslations;
