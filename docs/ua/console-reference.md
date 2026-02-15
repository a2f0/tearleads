# Довідник Консолі

Цей довідник документує команди, доступні у вікні Консолі.

## Огляд Команд

- `setup` Ініціалізувати нову зашифровану базу даних.
- `unlock` Розблокувати базу даних (відновлює сесію, коли доступна).
- `lock` Заблокувати базу даних.
- `backup <file>` Експортувати зашифрований файл резервної копії `.tbu`.
- `restore <file>` Імпортувати зашифрований файл резервної копії `.tbu`.
- `dump <folder>` Експортувати незашифровані JSON-файли.
- `password` Змінити пароль бази даних.
- `list-instances` Показати стан екземпляра та сесії.

## Глобальне Використання

```bash
--help
--version
```

## Команди

### `setup`

Ініціалізувати нову зашифровану базу даних.

```bash
setup
```

Запити:

- `Enter password:`
- `Confirm password:`

### `unlock`

Розблокувати базу даних. Якщо існує збережена сесія, CLI спочатку намагається відновити сесію.

```bash
unlock
```

Запит:

- `Enter password:`

### `lock`

Заблокувати базу даних та очистити стан ключа в пам'яті.

```bash
lock
```

### `backup <file>`

Експортувати поточний стан бази даних у зашифрований файл резервної копії `.tbu`.

```bash
backup ./backup.tbu
backup ./backup.tbu --password "backup-pass"
```

Опції:

- `-p, --password <password>` Надати пароль резервної копії неінтерактивно.

Якщо `--password` пропущено, запитує:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Відновити вміст бази даних із зашифрованої резервної копії `.tbu`.

```bash
restore ./backup.tbu
restore ./backup.tbu --force
restore ./backup.tbu --password "backup-pass"
```

Опції:

- `-f, --force` Пропустити підтвердження перезапису.
- `-p, --password <password>` Надати пароль резервної копії неінтерактивно.

Запити, коли `--force` не встановлено:

- `This will overwrite existing data. Continue? (y/n):`

Запит, коли `--password` пропущено:

- `Backup password:`

### `dump <folder>`

Вивантажити схему та дані у незашифровані JSON-файли.

```bash
dump ./dump-output
dump ./dump-output --force
dump ./dump-output --no-blobs
dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Опції:

- `-f, --input-file <file>` Читати з резервної копії `.tbu` замість активної БД.
- `-p, --password <password>` Пароль резервної копії для `--input-file`.
- `--force` Перезаписати існуючу вихідну папку без запиту.
- `--no-blobs` Пропустити створення директорії `files/`.

Примітка:

- У `dump`, `-f` відповідає `--input-file` (не `--force`), що відповідає поточній поведінці `packages/cli`.

Структура виводу:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (якщо не використовується `--no-blobs`)

### `password`

Змінити пароль шифрування для локальної бази даних.

```bash
password
```

Запити:

- `Current password:`
- `New password:`
- `Confirm new password:`

### `list-instances`

Показати базовий стан екземпляра/сесії.

```bash
list-instances
```

Поточний вивід включає один екземпляр за замовчуванням з:

- статусом налаштування
- статусом розблокування
- статусом збереженої сесії
