# Tuxedo

Tuxedo — це оркестратор робочих просторів на базі tmux для середовища розробки tearleads.
Він створює сесію tmux з вікнами для кожного workspace та за потреби
зберігає shell кожного workspace через GNU screen.

## Структура

- `tuxedo/tuxedo.sh`: основна точка входу
- `tuxedo/tuxedoKill.sh`: helper для завершення
- `tuxedo/config/`: конфіги tmux, screen, neovim і Ghostty
- `tuxedo/lib/`: повторно використовувані shell-хелпери
- `tuxedo/scripts/`: скрипти PR-дашборду, які використовуються у вікнах Tuxedo
- `tuxedo/tests/`: shell-тести та скрипти покриття

Wrapper-скрипти залишаються в `scripts/tuxedo.sh` і `scripts/tuxedoKill.sh` для
зворотної сумісності.

## Іменування workspace

Tuxedo очікує workspace `tearleads-shared` плюс один або кілька пронумерованих workspace:

- `tearleads-shared`: спільне джерело істини для `.secrets`, `.test_files` і `packages/api/.env`
- `tearleads-main`: перше вікно workspace
- `tearleads2...tearleadsN`: додаткові workspace на основі `TUXEDO_WORKSPACES`

## Вимоги

- `tmux` (обов'язково)
- `screen` (необов'язково, вмикає збереження сесії)
- `nvim` (необов'язково, використовується стандартною командою редактора)
- `jq` (необов'язково, використовується для синхронізації заголовків вікон VS Code)
- `ghostty` (необов'язково, використовується під час запуску поза терміналом)

## Використання

```sh
# Запустити tuxedo
./tuxedo/tuxedo.sh

# Або через legacy wrapper
./scripts/tuxedo.sh
```

### Змінні середовища

- `TUXEDO_BASE_DIR`: базовий каталог для workspace (типово: `$HOME/github`)
- `TUXEDO_EDITOR`: команда редактора для правої панелі tmux
- `TUXEDO_WORKSPACES`: кількість workspace для створення (типово: 10)
- `TUXEDO_FORCE_SCREEN`: примусово увімкнути GNU screen (`1`)
- `TUXEDO_FORCE_NO_SCREEN`: примусово вимкнути GNU screen (`1`)
- `TUXEDO_ENABLE_PR_DASHBOARDS`: увімкнути PR-дашборди у вікнах 0/1 (`1` за замовчуванням)
- `TUXEDO_PR_REFRESH_SECONDS`: інтервал оновлення PR-дашбордів (типово: `30`)
- `TUXEDO_PR_LIST_LIMIT`: кількість PR на одне оновлення дашборду (типово: `20`)
- `TUXEDO_SKIP_MAIN`: пропустити виконання основного потоку (`1`, використовується в тестах)

## Конфігурація

- `tuxedo/config/tmux.conf`: розкладка tmux, прив'язки клавіш і статус-бар
- `tuxedo/config/screenrc`: налаштування GNU screen для стійких панелей
- `tuxedo/config/neovim.lua`: конфіг Neovim за замовчуванням для панелі редактора
- `tuxedo/config/ghostty.conf`: налаштування Ghostty за замовчуванням, коли немає TTY

### Налаштування PATH у shell

Tuxedo встановлює `TUXEDO_WORKSPACE` у корінь workspace для кожної панелі. Додайте це до
конфігурації shell, щоб включити скрипти workspace у `PATH`:

```sh
# Для zsh: додайте до ~/.zshenv (підвантажується для ВСІХ shell, включно з неінтерактивними)
# Для bash: додайте до ~/.bashrc
if [ -n "$TUXEDO_WORKSPACE" ]; then
  export PATH="$TUXEDO_WORKSPACE/scripts:$TUXEDO_WORKSPACE/scripts/agents:$PATH"
fi
```

Використання `.zshenv` гарантує доступність скриптів у неінтерактивних shell (наприклад,
коли Codex або інші агенти запускають команди).

Це дозволяє запускати скрипти на кшталт `refresh.sh`, `bumpVersion.sh` і скрипти агентів
без вказування повного шляху.

## Нотатки щодо поведінки

- Використовує `tearleads-shared/` як джерело істини для `.secrets`, `.test_files` і `packages/api/.env`.
- Запускає `listOpenPrs.sh` у вікні `0` і `listRecentClosedPrs.sh` у вікні `1` (ліва панель) з автооновленням.
- Автоматично робить fast-forward для чистих workspace `main` перед встановленням symlink.
- Якщо `screen` доступний, кожен workspace запускається в іменованій screen-сесії,
  тож довготривалі процеси переживають перезапуск tmux.
- Коли сесія вже існує, Tuxedo під'єднується до неї й синхронізує заголовки VS Code
  замість повторного створення вікон tmux.

## Тести

```sh
# Запустити shell-тести tuxedo
./tuxedo/tests/run.sh

# Згенерувати покриття (потрібно bashcov + bash >= 4)
./tuxedo/tests/coverage.sh

# Або через pnpm-скрипт
pnpm test:coverage
```

Під час запуску покриття записується базовий підсумок у `tuxedo/tests/coverage-baseline.txt`.
