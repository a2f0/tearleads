# Referência do Console

Esta referência documenta os comandos disponíveis na janela do Console.

## Resumo de Comandos

- `setup` Inicializar um novo banco de dados criptografado.
- `unlock` Desbloquear o banco de dados (restaura a sessão quando disponível).
- `lock` Bloquear o banco de dados.
- `backup <file>` Exportar um arquivo de backup criptografado `.tbu`.
- `restore <file>` Importar um arquivo de backup criptografado `.tbu`.
- `dump <folder>` Exportar arquivos JSON não criptografados.
- `password` Alterar a senha do banco de dados.
- `list-instances` Mostrar o status de instância e sessão.

## Uso Global

```bash
--help
--version
```

## Comandos

### `setup`

Inicializar um novo banco de dados criptografado.

```bash
setup
```

Prompts:

- `Enter password:`
- `Confirm password:`

### `unlock`

Desbloquear o banco de dados. Se uma sessão persistida existir, o CLI tenta restaurar a sessão primeiro.

```bash
unlock
```

Prompt:

- `Enter password:`

### `lock`

Bloquear o banco de dados e limpar o estado da chave em memória.

```bash
lock
```

### `backup <file>`

Exportar o estado atual do banco de dados para um arquivo de backup criptografado `.tbu`.

```bash
backup ./backup.tbu
backup ./backup.tbu --password "backup-pass"
```

Opções:

- `-p, --password <password>` Fornecer senha de backup de forma não interativa.

Se `--password` for omitido, solicita:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Restaurar conteúdos do banco de dados a partir de um backup criptografado `.tbu`.

```bash
restore ./backup.tbu
restore ./backup.tbu --force
restore ./backup.tbu --password "backup-pass"
```

Opções:

- `-f, --force` Pular confirmação de sobrescrita.
- `-p, --password <password>` Fornecer senha de backup de forma não interativa.

Prompts quando `--force` não está definido:

- `This will overwrite existing data. Continue? (y/n):`

Prompt quando `--password` é omitido:

- `Backup password:`

### `dump <folder>`

Despejar esquema e dados em arquivos JSON não criptografados.

```bash
dump ./dump-output
dump ./dump-output --force
dump ./dump-output --no-blobs
dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Opções:

- `-f, --input-file <file>` Ler de backup `.tbu` em vez do BD ativo.
- `-p, --password <password>` Senha de backup para `--input-file`.
- `--force` Sobrescrever pasta de saída existente sem prompt.
- `--no-blobs` Pular a criação do diretório `files/`.

Nota:

- Em `dump`, `-f` mapeia para `--input-file` (não `--force`), correspondendo ao comportamento atual de `packages/cli`.

Estrutura de saída:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (a menos que `--no-blobs` seja usado)

### `password`

Alterar a senha de criptografia para o banco de dados local.

```bash
password
```

Prompts:

- `Current password:`
- `New password:`
- `Confirm new password:`

### `list-instances`

Exibir o estado básico de instância/sessão.

```bash
list-instances
```

A saída atual inclui uma única instância padrão com:

- status de configuração
- status de desbloqueio
- status de sessão persistida
