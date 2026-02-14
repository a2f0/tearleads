# Tuxedo

O Tuxedo é um orquestrador de workspaces baseado em tmux para o ambiente de desenvolvimento do tearleads.
Ele cria uma sessão tmux com janelas para cada workspace e pode opcionalmente
persistir cada shell de workspace via GNU screen.

## Layout

- `tuxedo/tuxedo.sh`: ponto de entrada principal
- `tuxedo/tuxedoKill.sh`: auxiliar de encerramento
- `tuxedo/config/`: configuração de tmux, screen, neovim e Ghostty
- `tuxedo/lib/`: helpers de shell reutilizáveis
- `tuxedo/scripts/`: scripts de painel de PR usados pelas janelas do Tuxedo
- `tuxedo/tests/`: testes de shell e scripts de cobertura

## Nomenclatura de workspaces

O Tuxedo assume um workspace `tearleads-shared` e um ou mais workspaces numerados:

- `tearleads-shared`: fonte compartilhada de `.secrets`, `.test_files` e `packages/api/.env`
- `tearleads-main`: primeira janela de workspace
- `tearleads2...tearleadsN`: workspaces adicionais com base em `TUXEDO_WORKSPACES`

## Requisitos

- `tmux` (obrigatório)
- `screen` (opcional, habilita persistência de sessão)
- `nvim` (opcional, usado pelo comando de editor padrão)
- `jq` (opcional, usado para sincronizar títulos de janela do VS Code)
- `ghostty` (opcional, usado quando iniciado fora de um terminal)

## Uso

```sh
./tuxedo/tuxedo.sh
```

### Variáveis de ambiente

- `TUXEDO_BASE_DIR`: diretório base para os workspaces (padrão: `$HOME/github`)
- `TUXEDO_EDITOR`: comando do editor para o painel direito do tmux
- `TUXEDO_WORKSPACES`: número de workspaces a criar (padrão: 10)
- `TUXEDO_FORCE_SCREEN`: força GNU screen ligado (`1`)
- `TUXEDO_FORCE_NO_SCREEN`: força GNU screen desligado (`1`)
- `TUXEDO_ENABLE_PR_DASHBOARDS`: habilita painéis de PR nas janelas 0/1 (`1` por padrão)
- `TUXEDO_PR_REFRESH_SECONDS`: intervalo de atualização dos painéis de PR (padrão: `30`)
- `TUXEDO_PR_LIST_LIMIT`: quantidade de PRs por atualização do painel (padrão: `20`)
- `TUXEDO_SKIP_MAIN`: ignora execução do fluxo principal (`1`, usado por testes)

## Configuração

- `tuxedo/config/tmux.conf`: layout do tmux, atalhos de teclado e barra de status
- `tuxedo/config/screenrc`: configurações do GNU screen para painéis persistentes
- `tuxedo/config/neovim.lua`: configuração padrão do Neovim para o painel do editor
- `tuxedo/config/ghostty.conf`: padrões do Ghostty quando não há TTY presente

### Configuração de PATH no shell

O Tuxedo define `TUXEDO_WORKSPACE` como a raiz do workspace para cada painel. Adicione isto
à configuração do seu shell para incluir scripts do workspace no PATH:

```sh
# Para zsh: adicione em ~/.zshenv (carregado para TODOS os shells, incluindo não interativos)
# Para bash: adicione em ~/.bashrc
if [ -n "$TUXEDO_WORKSPACE" ]; then
  export PATH="$TUXEDO_WORKSPACE/scripts:$TUXEDO_WORKSPACE/scripts/agents:$PATH"
fi
```

Usar `.zshenv` garante que os scripts estejam disponíveis em shells não interativos (por exemplo,
quando Codex ou outros agentes executam comandos).

Isso permite executar scripts como `refresh.sh`, `bumpVersion.sh` e scripts de agentes
diretamente sem especificar o caminho completo.

## Notas de comportamento

- Usa `tearleads-shared/` como fonte da verdade para `.secrets`, `.test_files` e `packages/api/.env`.
- Inicia `listOpenPrs.sh` na janela `0` e `listRecentClosedPrs.sh` na janela `1` (painel esquerdo) com atualização automática.
- Aplica fast-forward automaticamente em workspaces `main` limpos antes de configurar symlinks.
- Quando `screen` está disponível, cada workspace é executado dentro de uma sessão screen nomeada
  para que processos longos sobrevivam a reinicializações do tmux.
- Quando uma sessão já existe, o Tuxedo se conecta a ela e sincroniza os títulos do VS Code
  em vez de recriar janelas do tmux.

## Testes

```sh
# Executar testes de shell do tuxedo
./tuxedo/tests/run.sh

# Gerar cobertura (requer bashcov + bash >= 4)
./tuxedo/tests/coverage.sh

# Ou via script pnpm
pnpm test:coverage
```

A execução de cobertura grava um baseline de resumo em `tuxedo/tests/coverage-baseline.txt`.
