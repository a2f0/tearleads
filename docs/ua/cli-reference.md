# Довідник CLI

Цей довідник описує поточну поведінку `tearleads` CLI з `packages/cli`.

## Огляд Команд

- `tearleads setup` Ініціалізує нову зашифровану базу даних.
- `tearleads unlock` Розблоковує базу даних (відновлює сесію за наявності).
- `tearleads lock` Блокує базу даних.
- `tearleads backup <file>` Експортує зашифрований `.tbu` backup.
- `tearleads restore <file>` Імпортує зашифрований `.tbu` backup.
- `tearleads dump <folder>` Експортує незашифрований JSON.
- `tearleads password` Змінює пароль бази даних.
- `tearleads list-instances` Показує стан інстансу і сесії.

## Глобальне Використання

```bash
tearleads --help
tearleads --version
```

## Команди

### `setup`

Ініціалізує нову зашифровану базу даних.

```bash
tearleads setup
```

Запити:

- `Введіть пароль:`
- `Підтвердіть пароль:`

### `unlock`

Розблоковує базу даних. Якщо є збережена сесія, CLI спочатку пробує її відновити.

```bash
tearleads unlock
```

Запит:

- `Введіть пароль:`

### `lock`

Блокує базу даних і очищує стан ключа в пам'яті.

```bash
tearleads lock
```

### `backup <file>`

Експортує поточний стан бази у зашифрований `.tbu` backup.

```bash
tearleads backup ./backup.tbu
tearleads backup ./backup.tbu --password "backup-pass"
```

Опції:

- `-p, --password <password>` Передати пароль backup без інтерактивного вводу.

Якщо `--password` не задано, запити:

- `Пароль резервної копії:`
- `Підтвердіть пароль резервної копії:`

### `restore <file>`

Відновлює вміст бази із зашифрованого `.tbu` backup.

```bash
tearleads restore ./backup.tbu
tearleads restore ./backup.tbu --force
tearleads restore ./backup.tbu --password "backup-pass"
```

Опції:

- `-f, --force` Пропустити підтвердження перезапису.
- `-p, --password <password>` Передати пароль backup без інтерактивного вводу.

Якщо `--force` не задано, запит:

- `Це перезапише наявні дані. Продовжити? (y/n):`

Якщо `--password` не задано, запит:

- `Пароль резервної копії:`

### `dump <folder>`

Експортує схему і дані в незашифровані JSON-файли.

```bash
tearleads dump ./dump-output
tearleads dump ./dump-output --force
tearleads dump ./dump-output --no-blobs
tearleads dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Опції:

- `-f, --input-file <file>` Читати з `.tbu` backup замість live БД.
- `-p, --password <password>` Пароль backup для `--input-file`.
- `--force` Перезаписати наявну папку без підтвердження.
- `--no-blobs` Не створювати директорію `files/`.

Структура виводу:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (крім випадку `--no-blobs`)

### `password`

Змінює пароль шифрування локальної бази даних.

```bash
tearleads password
```

Запити:

- `Поточний пароль:`
- `Новий пароль:`
- `Підтвердіть новий пароль:`

### `list-instances`

Показує базовий стан інстансу/сесії.

```bash
tearleads list-instances
```

Поточний вивід включає єдиний default-інстанс з:

- станом setup
- станом unlock
- станом persisted session
