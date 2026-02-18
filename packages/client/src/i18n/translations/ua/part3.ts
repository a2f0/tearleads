export const uaPart3 = {
  sync: {
    // Page title
    sync: 'Синхронізація',
    // Loading state
    loading: 'Завантаження...',
    // Logged in state
    loggedInAs: 'Увійшли як',
    emailAddress: 'Електронна адреса',
    tokenExpires: 'Токен закінчується',
    expired: 'Закінчився',
    expiresIn: 'через {{time}}',
    logout: 'Вийти',
    activeSessions: 'Активні Сесії',
    manageSessionsDescription: 'Керуйте активними сесіями на всіх пристроях',
    // Not logged in state
    login: 'Увійти',
    loginDescription: 'Увійдіть, щоб синхронізувати дані на всіх пристроях',
    createAccount: 'Створити Обліковий Запис',
    createAccountDescription:
      'Зареєструйтесь, щоб синхронізувати дані на всіх пристроях',
    noAccount: 'Немає облікового запису?',
    createOne: 'Створити',
    hasAccount: 'Вже є обліковий запис?',
    signIn: 'Увійти',
    // Menu bar
    file: 'Файл',
    close: 'Закрити',
    view: 'Вигляд'
  },

  debug: {
    // Page/window titles
    debug: 'Налагодження',
    debugMenu: 'Меню Налагодження',
    // System info
    systemInfo: 'Системна Інформація',
    copyDebugInfoToClipboard:
      'Копіювати інформацію налагодження в буфер обміну',
    // Labels
    version: 'Версія',
    environment: 'Середовище',
    screen: 'Екран',
    userAgent: 'User Agent',
    platform: 'Платформа',
    pixelRatio: 'Співвідношення Пікселів',
    online: 'В мережі',
    language: 'Мова',
    touchSupport: 'Підтримка Дотику',
    standalone: 'Автономний',
    unknown: 'Невідомо',
    yes: 'Так',
    no: 'Ні',
    // API status
    apiStatus: 'Статус API',
    apiUrl: 'URL API',
    notSet: '(не встановлено)',
    failedToConnectToApi: 'Не вдалося підключитися до API',
    // Actions
    actions: 'Дії',
    throwError: 'Викликати Помилку',
    openDebugMenu: 'Відкрити меню налагодження',
    closeDebugMenu: 'Закрити меню налагодження',
    closeDebugMenuButton: 'Кнопка закриття меню налагодження',
    backToHome: 'Назад на Головну'
  },

  search: {
    // Search input
    search: 'Пошук',
    searchPlaceholder: 'Пошук...',
    // Filter options
    all: 'Все',
    apps: 'Додатки',
    helpDocs: 'Документи Допомоги',
    contacts: 'Контакти',
    notes: 'Нотатки',
    emails: 'Листи',
    files: 'Файли',
    playlists: 'Плейлисти',
    aiChats: 'Чати AI',
    // Entity type labels
    app: 'Додаток',
    helpDoc: 'Документ Допомоги',
    contact: 'Контакт',
    note: 'Нотатка',
    email: 'Лист',
    file: 'Файл',
    playlist: 'Плейлист',
    album: 'Альбом',
    aiConversation: 'Чат AI',
    // Status messages
    initializingSearch: 'Ініціалізація пошуку...',
    buildingSearchIndex: 'Побудова індексу пошуку...',
    searchIndexEmpty: 'Індекс пошуку порожній',
    addSomeContent: 'Додайте контакти, нотатки або листи, щоб почати',
    searching: 'Пошук...',
    startTypingToSearch: 'Почніть вводити для пошуку',
    pressEnterToList: 'Натисніть Enter для списку всіх обʼєктів',
    noResultsFoundFor: 'Не знайдено результатів для "{{query}}"',
    noResultsFound: 'Результатів не знайдено',
    // Results
    result: '{{count}} результат',
    results: '{{count}} результатів',
    showingResults: 'Показано {{shown}} з {{total}} результатів',
    // Table headers
    title: 'Назва',
    type: 'Тип',
    preview: 'Попередній перегляд',
    // Status bar
    itemIndexed: '{{count}} елемент індексовано',
    itemsIndexed: '{{count}} елементів індексовано',
    searchTook: 'Пошук зайняв {{ms}} мс'
  },

  vehicles: {
    // Form labels
    make: 'Марка',
    model: 'Модель',
    year: 'Рік',
    color: 'Колір',
    vehicleForm: 'Форма транспорту',
    // Buttons
    newVehicle: 'Новий Транспорт',
    saveVehicle: 'Зберегти Транспорт',
    updateVehicle: 'Оновити Транспорт',
    edit: 'Редагувати',
    delete: 'Видалити',
    // Table
    actions: 'Дії',
    vehiclesTable: 'Таблиця транспорту',
    // Empty state
    loadingVehicles: 'Завантаження транспорту...',
    noVehiclesYet: 'Транспорту ще немає',
    addFirstVehicle: 'Додайте свій перший транспорт вище.',
    // Errors
    unableToSaveVehicle:
      'Не вдається зберегти транспорт зараз. Спробуйте ще раз.',
    // Placeholder values
    notApplicable: 'Н/Д'
  }
} as const;
