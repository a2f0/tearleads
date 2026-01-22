# Початок Роботи

```bash
pnpm install
pnpm dev
```

## Скрипти для розробки Postgres

Скористайтеся цими хелперами для локальної роботи з Postgres:

- `scripts/setupPostgresDev.sh` встановлює та запускає Postgres на macOS і показує стандартні значення PG* (зокрема `PGDATABASE=tearleads_development`).
- `scripts/applyPostgresSchema.sh` застосовує згенеровану схему (використовує `DATABASE_URL` або змінні PG*).
- `scripts/dropPostgresDb.ts` видаляє лише `tearleads_development` (потрібен `--yes`).

## Ключ API App Store Connect

Ключ API App Store Connect потрібен для автоматизації збірки Fastlane.

1. Перейдіть до [App Store Connect](https://appstoreconnect.apple.com/)
2. Перейдіть до **Користувачі та Доступ** → вкладка **Інтеграції**
3. Натисніть `Створити Ключ API` для створення нового ключа API
4. Дайте йому назву (наприклад, "GitHub Actions").
5. Встановіть роль **App Manager**.
6. Завантажте файл `.p8` та помістіть його в `.secrets/`
7. Експортуйте `APP_STORE_CONNECT_KEY_ID` та `APP_STORE_CONNECT_ISSUER_ID`.
8. Використовуйте [scripts/setGithubVars.sh](../scripts/setGithubVars.sh) для розгортання в GitHub.

## Персональний Токен Доступу GitHub

Персональний токен доступу потрібен для Fastlane Match, який використовується для управління сертифікатами підпису та профілями провізії. Для налаштування:

1. Створіть новий Репозиторій GitHub
2. Перейдіть до [Персональні Токени Доступу](https://github.com/settings/personal-access-tokens)
3. Надайте токену наступні дозволи:
  a. Доступ на читання метаданих
  b. Доступ на читання та запис коду
4. Закодуйте токен за допомогою `echo -n "<ім'я користувача github>:<персональний токен доступу>" | base64 | pbcopy` та встановіть його в `MATCH_GIT_BASIC_AUTHORIZATION`
5. Використовуйте [scripts/setGithubVars.sh](../scripts/setGithubVars.sh) для налаштування в GitHub (для GitHub Actions).
