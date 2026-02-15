# Referencia do Console

Esta referencia documenta os comandos disponiveis na janela do Console.

## Resumo de Comandos

- `setup` Inicializar um novo banco de dados criptografado.
- `unlock` Desbloquear o banco de dados (restaura a sessao quando disponivel).
- `lock` Bloquear o banco de dados.
- `backup <file>` Exportar um arquivo de backup criptografado `.tbu`.
- `restore <file>` Importar um arquivo de backup criptografado `.tbu`.
- `dump <folder>` Exportar arquivos JSON nao criptografados.
- `password` Alterar a senha do banco de dados.
- `list-instances` Mostrar o status de instancia e sessao.

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

Desbloquear o banco de dados. Se uma sessao persistida existir, o CLI tenta restaurar a sessao primeiro.

```bash
unlock
```

Prompt:

- `Enter password:`

### `lock`

Bloquear o banco de dados e limpar o estado da chave em memoria.

```bash
lock
```

### `backup <file>`

Exportar o estado atual do banco de dados para um arquivo de backup criptografado `.tbu`.

```bash
backup ./backup.tbu
backup ./backup.tbu --password "backup-pass"
```

Opcoes:

- `-p, --password <password>` Fornecer senha de backup de forma nao interativa.

Se `--password` for omitido, solicita:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Restaurar conteudos do banco de dados a partir de um backup criptografado `.tbu`.

```bash
restore ./backup.tbu
restore ./backup.tbu --force
restore ./backup.tbu --password "backup-pass"
```

Opcoes:

- `-f, --force` Pular confirmacao de sobrescrita.
- `-p, --password <password>` Fornecer senha de backup de forma nao interativa.

Prompts quando `--force` nao esta definido:

- `This will overwrite existing data. Continue? (y/n):`

Prompt quando `--password` e omitido:

- `Backup password:`

### `dump <folder>`

Despejar esquema e dados em arquivos JSON nao criptografados.

```bash
dump ./dump-output
dump ./dump-output --force
dump ./dump-output --no-blobs
dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Opcoes:

- `-f, --input-file <file>` Ler de backup `.tbu` em vez do BD ativo.
- `-p, --password <password>` Senha de backup para `--input-file`.
- `--force` Sobrescrever pasta de saida existente sem prompt.
- `--no-blobs` Pular a criacao do diretorio `files/`.

Nota:

- Em `dump`, `-f` mapeia para `--input-file` (nao `--force`), correspondendo ao comportamento atual de `packages/cli`.

Estrutura de saida:

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

Exibir o estado basico de instancia/sessao.

```bash
list-instances
```

A saida atual inclui uma unica instancia padrao com:

- status de configuracao
- status de desbloqueio
- status de sessao persistida
