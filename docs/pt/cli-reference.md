# Referência da CLI

_Atualizado para refletir a versão em inglês de 11 de fevereiro de 2026._

Esta referência documenta os comandos da CLI `tearleads`.

## Resumo de Comandos

- `tearleads setup` Inicializa um novo banco de dados criptografado.
- `tearleads unlock` Desbloqueia o banco de dados (restaura a sessão quando disponível).
- `tearleads lock` Bloqueia o banco de dados.
- `tearleads backup <file>` Exporta um arquivo de backup `.tbu` criptografado.
- `tearleads restore <file>` Importa um arquivo de backup `.tbu` criptografado.
- `tearleads dump <folder>` Exporta arquivos JSON sem criptografia.
- `tearleads password` Altera a senha do banco de dados.
- `tearleads list-instances` Mostra o status da instância e da sessão.

## Uso Global

```bash
tearleads --help
tearleads --version
```

## Comandos

### `setup`

Inicializa um novo banco de dados criptografado.

```bash
tearleads setup
```

Solicita:

- `Enter password:`
- `Confirm password:`

### `unlock`

Desbloqueia o banco de dados. Se existir uma sessão persistida, a CLI tenta restaurar a sessão primeiro.

```bash
tearleads unlock
```

Solicita:

- `Enter password:`

### `lock`

Bloqueia o banco de dados e limpa o estado da chave em memória.

```bash
tearleads lock
```

### `backup <file>`

Exporta o estado atual do banco de dados para um arquivo de backup `.tbu` criptografado.

```bash
tearleads backup ./backup.tbu
tearleads backup ./backup.tbu --password "backup-pass"
```

Opções:

- `-p, --password <password>` Fornece a senha do backup sem interação.

Se `--password` for omitido, solicita:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Restaura o conteúdo do banco de dados a partir de um backup `.tbu` criptografado.

```bash
tearleads restore ./backup.tbu
tearleads restore ./backup.tbu --force
tearleads restore ./backup.tbu --password "backup-pass"
```

Opções:

- `-f, --force` Pula a confirmação de sobrescrita.
- `-p, --password <password>` Fornece a senha do backup sem interação.

Solicitações quando `--force` não está definido:

- `This will overwrite existing data. Continue? (y/n):`

Solicitação quando `--password` é omitido:

- `Backup password:`

### `dump <folder>`

Exporta esquema e dados para arquivos JSON sem criptografia.

```bash
tearleads dump ./dump-output
tearleads dump ./dump-output --force
tearleads dump ./dump-output --no-blobs
tearleads dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Opções:

- `-f, --input-file <file>` Lê de um backup `.tbu` em vez do banco ao vivo.
- `-p, --password <password>` Senha do backup para `--input-file`.
- `--force` Sobrescreve a pasta de saída existente sem confirmação.
- `--no-blobs` Pula a criação do diretório `files/`.

Observação:

- Em `dump`, `-f` corresponde a `--input-file` (não `--force`), correspondendo ao comportamento atual de `packages/cli`.

Estrutura de saída:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (a menos que `--no-blobs`)

### `password`

Altera a senha de criptografia do banco de dados local.

```bash
tearleads password
```

Solicita:

- `Current password:`
- `New password:`
- `Confirm new password:`

### `list-instances`

Exibe o estado básico de instância/sessão.

```bash
tearleads list-instances
```

A saída atual inclui uma única instância padrão com:

- status de setup
- status de desbloqueio
- status de sessão persistida
