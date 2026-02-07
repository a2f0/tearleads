import type { I18NextTranslations } from './types';

export const ua = {
  common: {
    language: 'Мова',
    languageName: 'Українська',
    selectLanguage: 'Вибрати мову',
    settings: 'Налаштування',
    theme: 'Тема',
    themeDescription: 'Виберіть бажану колірну тему',
    create: 'Створити',
    restore: 'Відновити',
    stored: 'Збережені'
  },
  menu: {
    home: 'Головна',
    search: 'Пошук',
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
    chat: 'AI',
    mlsChat: 'MLS Чат',
    models: 'Моделі',
    admin: 'Адмін',
    redis: 'Redis',
    postgres: 'Postgres',
    postgresAdmin: 'Адмін Postgres',
    groups: 'Групи',
    organizations: 'Організації',
    adminUsers: 'Адмін користувачів',
    settings: 'Налаштування',
    email: 'Пошта',
    sync: 'Синхронізація',
    v86: 'v86',
    vfs: 'Провідник VFS',
    backups: 'Резервні копії'
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
    repeatOne: 'Повтор: Поточний трек',
    hideVisualizer: 'Приховати візуалізатор',
    showVisualizer: 'Показати візуалізатор',
    mute: 'Вимкнути звук',
    unmute: 'Увімкнути звук',
    volume: 'Гучність',
    seek: 'Перемотати',
    getInfo: 'Інформація',
    delete: 'Видалити',
    download: 'Завантажити',
    share: 'Поділитися'
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
    iconBackground: 'Фони значків',
    iconBackgroundDescription:
      'Оберіть, чи мають значки кольоровий фон або є прозорими',
    iconBackgroundColored: 'Кольорові',
    iconBackgroundTransparent: 'Прозорі',
    tooltips: 'Підказки',
    tooltipsDescription:
      'Показувати корисні підказки при наведенні на елементи',
    tooltipsEnabled: 'Увімкнено',
    tooltipsDisabled: 'Вимкнено'
  }
} as const satisfies I18NextTranslations;
