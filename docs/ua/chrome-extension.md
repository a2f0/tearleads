# Розширення Chrome

Розширення Chrome для Rapid знаходиться в `packages/chrome-extension`. Воно використовує Manifest V3 і побудоване з Vite та TypeScript.

## Структура Проекту

```text
packages/chrome-extension/
├── public/
│   ├── manifest.json      # Маніфест розширення Chrome
│   └── icons/             # Іконки розширення (SVG)
├── src/
│   ├── background/        # Service worker (працює у фоновому режимі)
│   ├── content/           # Скрипт контенту (інжектується на сторінки)
│   ├── popup/             # Скрипт UI popup
│   ├── popup.html         # HTML popup
│   └── messages.ts        # Спільні типи повідомлень
├── dist/                  # Вихід збірки (завантажте це в Chrome)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Розробка

### Збірка

```bash
# Одноразова збірка
pnpm --filter @rapid/chrome-extension build

# Режим watch (перезбирає при змінах файлів)
pnpm --filter @rapid/chrome-extension dev
```

### Завантаження в Chrome (Режим Розробника)

1. Зберіть розширення (або запустіть в режимі watch)
2. Відкрийте Chrome і перейдіть до `chrome://extensions`
3. Увімкніть **Режим розробника** (перемикач у верхньому правому куті)
4. Натисніть **Завантажити розпаковане**
5. Виберіть папку `packages/chrome-extension/dist`
6. Розширення повинно з'явитися у вашому списку розширень

При роботі в режимі watch (`pnpm dev`), розширення автоматично перезбирається при змінах файлів. Після змін:

- **Фоновий скрипт:** Натисніть іконку оновлення на картці розширення в `chrome://extensions`.
- **Скрипт контенту:** Перезавантажте цільову сторінку.
- **Popup:** Закрийте і знову відкрийте popup.

### Тестування

```bash
# Запустити тести один раз
pnpm --filter @rapid/chrome-extension test

# Режим watch
pnpm --filter @rapid/chrome-extension test:watch

# З звітом покриття
pnpm --filter @rapid/chrome-extension test:coverage
```

## Архітектура

### Manifest V3

Розширення використовує [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3), найновішу платформу розширень Chrome:

- **Service Worker**: Фоновий скрипт працює як service worker (`background.js`)
- **Скрипти Контенту**: Обмежені конкретними доменами (`*.rapid.app` та `localhost`)
- **Дозволи**: Мінімальні дозволи (`storage`, `activeTab`)

### Компоненти

| Компонент | Файл | Призначення |
| --------- | ---- | ----------- |
| Background | `src/background/index.ts` | Service worker, що обробляє події розширення та маршрутизацію повідомлень |
| Скрипт Контенту | `src/content/index.ts` | Інжектується на відповідні сторінки для взаємодії з контентом сторінки |
| Popup | `src/popup/index.ts` | UI, що показується при натисканні на іконку розширення |

### Передача Повідомлень

Компоненти спілкуються через API передачі повідомлень Chrome. Типи повідомлень визначені в `src/messages.ts`:

```typescript
// Приклад: Відправка повідомлення з popup до background
chrome.runtime.sendMessage({ type: "PING" }, (response) => {
  console.log(response); // { type: "PONG" }
});
```

## Розгортання

### Chrome Web Store

Для публікації в Chrome Web Store:

1. Зберіть розширення: `pnpm --filter @rapid/chrome-extension build`
2. Створіть ZIP-файл вмісту папки `dist` (файл `manifest.json` повинен бути в корені ZIP-архіву).
3. Завантажте на [Панель Розробника Chrome](https://chrome.google.com/webstore/devconsole)

### Оновлення Версії

Версія розширення керується через `scripts/bumpVersion.sh`, який оновлює обидва:

- `packages/chrome-extension/package.json`
- `packages/chrome-extension/public/manifest.json`

Запустіть з кореня репозиторію:

```bash
./scripts/bumpVersion.sh
```

## Налагодження

### Фоновий Service Worker

1. Перейдіть до `chrome://extensions`
2. Знайдіть розширення Rapid
3. Натисніть посилання **Service Worker** для відкриття DevTools для фонового скрипта

### Скрипт Контенту

1. Відкрийте DevTools на сторінці, де працює скрипт контенту
2. Логи скрипта контенту з'являються в консолі сторінки
3. Використовуйте панель **Sources** для встановлення точок зупинки в скриптах контенту

### Popup

1. Натисніть іконку розширення для відкриття popup
2. Клацніть правою кнопкою миші всередині popup і виберіть **Інспектувати**
3. DevTools відкриється для контексту popup
