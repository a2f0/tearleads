# Referencia CLI

Esta referencia documenta el comportamiento actual de `tearleads` CLI desde `packages/cli`.

## Resumen de Comandos

- `tearleads setup` Inicializa una base de datos cifrada.
- `tearleads unlock` Desbloquea la base de datos (restaura sesión si existe).
- `tearleads lock` Bloquea la base de datos.
- `tearleads backup <file>` Exporta un backup cifrado `.tbu`.
- `tearleads restore <file>` Importa un backup cifrado `.tbu`.
- `tearleads dump <folder>` Exporta JSON sin cifrar.
- `tearleads password` Cambia la contraseña de la base de datos.
- `tearleads list-instances` Muestra estado de instancia y sesión.

## Uso Global

```bash
tearleads --help
tearleads --version
```

## Comandos

### `setup`

Inicializa una nueva base de datos cifrada.

```bash
tearleads setup
```

Pide:

- `Introducir contraseña:`
- `Confirmar contraseña:`

### `unlock`

Desbloquea la base de datos. Si existe una sesión persistida, primero intenta restaurarla.

```bash
tearleads unlock
```

Pide:

- `Introducir contraseña:`

### `lock`

Bloquea la base de datos y limpia el estado de clave en memoria.

```bash
tearleads lock
```

### `backup <file>`

Exporta el estado actual a un backup cifrado `.tbu`.

```bash
tearleads backup ./backup.tbu
tearleads backup ./backup.tbu --password "backup-pass"
```

Opciones:

- `-p, --password <password>` Proveer contraseña de backup sin prompt.

Si se omite `--password`, pide:

- `Contraseña del backup:`
- `Confirmar contraseña del backup:`

### `restore <file>`

Restaura el contenido desde un backup cifrado `.tbu`.

```bash
tearleads restore ./backup.tbu
tearleads restore ./backup.tbu --force
tearleads restore ./backup.tbu --password "backup-pass"
```

Opciones:

- `-f, --force` Omitir confirmación de sobrescritura.
- `-p, --password <password>` Proveer contraseña de backup sin prompt.

Sin `--force`, pide:

- `Esto sobrescribirá los datos existentes. ¿Continuar? (s/n):`

Si se omite `--password`, pide:

- `Contraseña del backup:`

### `dump <folder>`

Exporta esquema y datos en archivos JSON sin cifrar.

```bash
tearleads dump ./dump-output
tearleads dump ./dump-output --force
tearleads dump ./dump-output --no-blobs
tearleads dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Opciones:

- `-f, --input-file <file>` Leer desde backup `.tbu` en lugar de BD en vivo.
- `-p, --password <password>` Contraseña del backup para `--input-file`.
- `--force` Sobrescribir carpeta existente sin confirmación.
- `--no-blobs` Omitir creación de `files/`.

Estructura de salida:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (excepto con `--no-blobs`)

### `password`

Cambia la contraseña de cifrado de la base de datos local.

```bash
tearleads password
```

Pide:

- `Contraseña actual:`
- `Nueva contraseña:`
- `Confirmar nueva contraseña:`

### `list-instances`

Muestra el estado básico de instancia/sesión.

```bash
tearleads list-instances
```

La salida actual incluye una instancia por defecto con:

- estado de setup
- estado de desbloqueo
- estado de sesión persistida
