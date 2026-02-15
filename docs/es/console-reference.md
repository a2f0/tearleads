# Referencia de Consola

Esta referencia documenta los comandos disponibles en la ventana de Consola.

## Resumen de Comandos

- `setup` Inicializar una nueva base de datos cifrada.
- `unlock` Desbloquear la base de datos (restaura la sesión cuando está disponible).
- `lock` Bloquear la base de datos.
- `backup <file>` Exportar un archivo de respaldo cifrado `.tbu`.
- `restore <file>` Importar un archivo de respaldo cifrado `.tbu`.
- `dump <folder>` Exportar archivos JSON sin cifrar.
- `password` Cambiar la contraseña de la base de datos.
- `list-instances` Mostrar el estado de instancia y sesión.

## Uso Global

```bash
--help
--version
```

## Comandos

### `setup`

Inicializar una nueva base de datos cifrada.

```bash
setup
```

Solicitudes:

- `Enter password:`
- `Confirm password:`

### `unlock`

Desbloquear la base de datos. Si existe una sesión persistida, el CLI intenta restaurar la sesión primero.

```bash
unlock
```

Solicitud:

- `Enter password:`

### `lock`

Bloquear la base de datos y limpiar el estado de clave en memoria.

```bash
lock
```

### `backup <file>`

Exportar el estado actual de la base de datos a un archivo de respaldo cifrado `.tbu`.

```bash
backup ./backup.tbu
backup ./backup.tbu --password "backup-pass"
```

Opciones:

- `-p, --password <password>` Proporcionar contraseña de respaldo de forma no interactiva.

Si se omite `--password`, solicita:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Restaurar contenidos de la base de datos desde un respaldo cifrado `.tbu`.

```bash
restore ./backup.tbu
restore ./backup.tbu --force
restore ./backup.tbu --password "backup-pass"
```

Opciones:

- `-f, --force` Omitir confirmación de sobrescritura.
- `-p, --password <password>` Proporcionar contraseña de respaldo de forma no interactiva.

Solicitudes cuando `--force` no está establecido:

- `This will overwrite existing data. Continue? (y/n):`

Solicitud cuando `--password` se omite:

- `Backup password:`

### `dump <folder>`

Volcar esquema y datos a archivos JSON sin cifrar.

```bash
dump ./dump-output
dump ./dump-output --force
dump ./dump-output --no-blobs
dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Opciones:

- `-f, --input-file <file>` Leer desde respaldo `.tbu` en lugar de la BD activa.
- `-p, --password <password>` Contraseña de respaldo para `--input-file`.
- `--force` Sobrescribir carpeta de salida existente sin solicitud.
- `--no-blobs` Omitir la creación del directorio `files/`.

Nota:

- En `dump`, `-f` mapea a `--input-file` (no `--force`), coincidiendo con el comportamiento actual de `packages/cli`.

Estructura de salida:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (a menos que se use `--no-blobs`)

### `password`

Cambiar la contraseña de cifrado para la base de datos local.

```bash
password
```

Solicitudes:

- `Current password:`
- `New password:`
- `Confirm new password:`

### `list-instances`

Mostrar el estado básico de instancia/sesión.

```bash
list-instances
```

La salida actual incluye una sola instancia predeterminada con:

- estado de configuración
- estado de desbloqueo
- estado de sesión persistida
