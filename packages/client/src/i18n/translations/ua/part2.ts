export const uaPart2 = {
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
    tooltipsDisabled: 'Вимкнено',
    windowOpacity: 'Прозорість вікон',
    windowOpacityDescription:
      'Оберіть, чи плаваючі вікна напівпрозорі або повністю непрозорі',
    windowOpacityTranslucent: 'Напівпрозорі',
    windowOpacityOpaque: 'Непрозорі',
    borderRadius: 'Радіус кутів',
    borderRadiusDescription:
      'Оберіть, чи інтерфейс і вікна мають заокруглені кути або прямі',
    borderRadiusRounded: 'Заокруглені',
    borderRadiusSquare: 'Прямі'
  },

  classic: {
    // TagSidebar
    tagsSidebar: 'Бічна панель тегів',
    tagListContextMenu:
      'Список тегів, натисніть Shift+F10 для контекстного меню',
    allItems: 'Усі елементи',
    virtualTags: 'Віртуальні теги',
    deletedTags: 'Видалені теги',
    tagList: 'Список тегів',
    searchTags: 'Пошук тегів',
    dragTag: 'Перетягнути тег',
    save: 'Зберегти',
    cancel: 'Скасувати',
    saveTagName: 'Зберегти назву тега',
    cancelEditing: 'Скасувати редагування',
    restore: 'Відновити',
    restoreTag: 'Відновити тег',
    edit: 'Редагувати',
    editTag: 'Редагувати тег',
    moveUp: 'Перемістити вгору',
    moveUpTag: 'Перемістити тег',
    moveDown: 'Перемістити вниз',
    moveDownTag: 'Перемістити тег',
    delete: 'Видалити',
    deleteTag: 'Видалити тег',
    // NotesPane
    notesPane: 'Панель нотаток',
    entryListContextMenu:
      'Список записів, натисніть Shift+F10 для контекстного меню',
    noteList: 'Список нотаток',
    searchEntries: 'Пошук записів',
    dragEntry: 'Перетягнути запис',
    editEntryTitle: 'Редагувати заголовок запису',
    editEntryBody: 'Редагувати текст запису',
    saveEntry: 'Зберегти запис',
    editNote: 'Редагувати нотатку',
    moveUpNote: 'Перемістити нотатку',
    moveDownNote: 'Перемістити нотатку',
    // ClassicMenuBar
    sortTags: 'Сортувати теги',
    sortEntries: 'Сортувати записи',
    tags: 'Теги',
    entries: 'Записи',
    // ClassicContextMenu
    closeContextMenu: 'Закрити контекстне меню',
    // ClassicWindowMenuBar
    file: 'Файл',
    newEntry: 'Новий Запис',
    close: 'Закрити',
    undo: 'Скасувати',
    redo: 'Повторити',
    newTag: 'Новий Тег',
    sortBy: 'Сортувати за',
    view: 'Вигляд',
    help: 'Допомога',
    classic: 'Класичний'
  },

  contacts: {
    // Window titles
    contacts: 'Контакти',
    newContact: 'Новий Контакт',
    // Form labels and placeholders
    firstNameRequired: "Ім'я *",
    lastName: 'Прізвище',
    birthdayPlaceholder: 'День народження (РРРР-ММ-ДД)',
    emailAddresses: 'Адреси електронної пошти',
    phoneNumbers: 'Номери телефонів',
    email: 'Пошта',
    phone: 'Телефон',
    label: 'Мітка',
    add: 'Додати',
    primary: 'Основний',
    // Detail view
    details: 'Деталі',
    created: 'Створено',
    updated: 'Оновлено',
    // Loading states
    loadingDatabase: 'Завантаження бази даних...',
    loadingContact: 'Завантаження контакту...',
    loadingContacts: 'Завантаження контактів...',
    // Empty states
    noContactsYet: 'Контактів ще немає',
    createFirstContact: 'Створіть свій перший контакт',
    noContactInfo: 'Немає контактної інформації',
    // Search
    searchContacts: 'Пошук контактів...',
    // Groups sidebar
    groups: 'Групи',
    newGroup: 'Нова Група',
    allContacts: 'Усі Контакти',
    sendEmail: 'Надіслати лист',
    rename: 'Перейменувати',
    // Group dialogs
    groupName: 'Назва групи',
    cancel: 'Скасувати',
    create: 'Створити',
    creating: 'Створення...',
    save: 'Зберегти',
    saving: 'Збереження...',
    deleteGroup: 'Видалити Групу',
    deleteGroupConfirm:
      'Видалити "{{name}}"? Контакти залишаться, але будуть вилучені з цієї групи.',
    deleting: 'Видалення...',
    renameGroup: 'Перейменувати Групу',
    // Import
    importCsv: 'Імпорт CSV',
    done: 'Готово',
    parsingCsv: 'Аналіз CSV...',
    csvColumns: 'Стовпці CSV',
    dragColumnHint: 'Перетягніть стовпці для призначення полям контакту',
    contactFields: 'Поля Контакту',
    dragColumnHere: 'Перетягніть стовпець сюди',
    previewFirstRows: 'Попередній перегляд (перші 3 рядки)',
    totalRows: '{{count}} рядків загалом',
    importing: 'Імпорт... {{progress}}%',
    importContacts: 'Імпортувати {{count}} Контактів',
    importedContacts:
      'Імпортовано {{imported}} контакт{{plural}}{{skippedText}}',
    skipped: ', пропущено {{count}}',
    andMore: '...та ще {{count}}',
    chooseFileHint: 'Виберіть Файл > Імпорт CSV, щоб обрати файл.',
    // Menu bar
    file: 'Файл',
    new: 'Новий',
    close: 'Закрити',
    view: 'Вигляд',
    list: 'Список',
    table: 'Таблиця',
    help: 'Допомога',
    // Unlock descriptions
    thisContact: 'цей контакт',
    createContact: 'створити контакт',
    // Table headers
    name: "Ім'я",
    // Import column headers
    value: 'Значення',
    // Contact detail page
    backToContacts: 'Назад до Контактів',
    contactNotFound: 'Контакт не знайдено',
    firstNameIsRequired: "Ім'я обов'язкове",
    emailCannotBeEmpty: 'Адреса пошти не може бути порожньою',
    phoneCannotBeEmpty: 'Номер телефону не може бути порожнім',
    export: 'Експортувати',
    edit: 'Редагувати',
    addEmail: 'Додати Пошту',
    addPhone: 'Додати Телефон',
    emailAddress: 'Адреса пошти',
    phoneNumber: 'Номер телефону'
  }
} as const;
