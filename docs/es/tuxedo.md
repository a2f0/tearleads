# Tuxedo

Tuxedo es un orquestador de espacios de trabajo basado en tmux para la configuración de desarrollo de tearleads.
Crea una sesión de tmux con ventanas para cada workspace y, opcionalmente,
persiste cada shell de workspace mediante GNU screen.

## Estructura

- `tuxedo/tuxedo.sh`: punto de entrada principal
- `tuxedo/tuxedoKill.sh`: helper para desmontar
- `tuxedo/config/`: configuración de tmux, screen, neovim y Ghostty
- `tuxedo/lib/`: helpers de shell reutilizables
- `tuxedo/scripts/`: scripts del panel de PR usados por las ventanas de Tuxedo
- `tuxedo/tests/`: pruebas de shell y scripts de cobertura

Los scripts wrapper se mantienen en `scripts/tuxedo.sh` y `scripts/tuxedoKill.sh` por
compatibilidad con versiones anteriores.

## Nombres de workspaces

Tuxedo asume un workspace `tearleads-shared` más uno o varios workspaces numerados:

- `tearleads-shared`: fuente de verdad compartida para `.secrets`, `.test_files` y `packages/api/.env`
- `tearleads-main`: primera ventana de workspace
- `tearleads2...tearleadsN`: workspaces adicionales según `TUXEDO_WORKSPACES`

## Requisitos

- `tmux` (obligatorio)
- `screen` (opcional, habilita persistencia de sesión)
- `nvim` (opcional, usado por el comando de editor predeterminado)
- `jq` (opcional, usado para sincronizar los títulos de ventana de VS Code)
- `ghostty` (opcional, usado cuando se inicia fuera de una terminal)

## Uso

```sh
# Ejecutar tuxedo
./tuxedo/tuxedo.sh

# O mediante el wrapper heredado
./scripts/tuxedo.sh
```

### Variables de entorno

- `TUXEDO_BASE_DIR`: directorio base para workspaces (predeterminado: `$HOME/github`)
- `TUXEDO_EDITOR`: comando de editor para el panel derecho de tmux
- `TUXEDO_WORKSPACES`: cantidad de workspaces a crear (predeterminado: 10)
- `TUXEDO_FORCE_SCREEN`: fuerza activar GNU screen (`1`)
- `TUXEDO_FORCE_NO_SCREEN`: fuerza desactivar GNU screen (`1`)
- `TUXEDO_ENABLE_PR_DASHBOARDS`: habilita paneles de PR en ventanas 0/1 (`1` por defecto)
- `TUXEDO_PR_REFRESH_SECONDS`: intervalo de actualización para paneles de PR (predeterminado: `30`)
- `TUXEDO_PR_LIST_LIMIT`: cantidad de PR por actualización del panel (predeterminado: `20`)
- `TUXEDO_SKIP_MAIN`: omite la ejecución del flujo principal (`1`, usado por pruebas)

## Configuración

- `tuxedo/config/tmux.conf`: layout de tmux, atajos de teclado y barra de estado
- `tuxedo/config/screenrc`: configuración de GNU screen para paneles persistentes
- `tuxedo/config/neovim.lua`: configuración predeterminada de Neovim para el panel del editor
- `tuxedo/config/ghostty.conf`: valores predeterminados de Ghostty cuando no hay TTY

### Configuración de PATH en shell

Tuxedo define `TUXEDO_WORKSPACE` como la raíz del workspace para cada panel. Añada esto a
la configuración de su shell para incluir scripts del workspace en `PATH`:

```sh
# Para zsh: añadir a ~/.zshenv (se carga para TODAS las shells, incluidas las no interactivas)
# Para bash: añadir a ~/.bashrc
if [ -n "$TUXEDO_WORKSPACE" ]; then
  export PATH="$TUXEDO_WORKSPACE/scripts:$TUXEDO_WORKSPACE/scripts/agents:$PATH"
fi
```

Usar `.zshenv` garantiza que los scripts estén disponibles en shells no interactivas (p. ej.,
cuando Codex u otros agentes ejecutan comandos).

Esto permite ejecutar scripts como `refresh.sh`, `bumpVersion.sh` y scripts de agentes
directamente sin especificar la ruta completa.

## Notas de comportamiento

- Usa `tearleads-shared/` como fuente de verdad para `.secrets`, `.test_files` y `packages/api/.env`.
- Inicia `listOpenPrs.sh` en la ventana `0` y `listRecentClosedPrs.sh` en la ventana `1` (panel izquierdo) con actualización automática.
- Hace fast-forward automáticamente en workspaces `main` limpios antes de crear symlinks.
- Cuando `screen` está disponible, cada workspace se ejecuta dentro de una sesión screen con nombre
  para que los procesos de larga duración sobrevivan a reinicios de tmux.
- Cuando ya existe una sesión, Tuxedo se adjunta a ella y sincroniza los títulos de VS Code
  en lugar de recrear ventanas de tmux.

## Pruebas

```sh
# Ejecutar pruebas de shell de tuxedo
./tuxedo/tests/run.sh

# Generar cobertura (requiere bashcov + bash >= 4)
./tuxedo/tests/coverage.sh

# O mediante script de pnpm
pnpm test:coverage
```

La ejecución de cobertura escribe un baseline de resumen en `tuxedo/tests/coverage-baseline.txt`.
