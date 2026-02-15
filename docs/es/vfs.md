# VFS (Sistema de Archivos Virtual)

Estado: diseno en progreso (rastreado en el issue de GitHub #1220).

Este documento captura la direccion de diseno actual del VFS para Tearleads. El objetivo
es soportar comparticion cifrada y multiusuario de objetos de dominio (contactos, fotos,
notas, archivos) con jerarquia flexible y gestion robusta de claves.

## Objetivos

- Organizar objetos de dominio en una jerarquia (carpetas y estructuras anidadas)
- Compartir objetos o subarboles entre usuarios
- Permitir que el mismo objeto aparezca en multiples lugares
- Mantener el contenido cifrado de extremo a extremo con envolvimiento explicito de claves

## Modelo de Datos Central

### `vfs_registry`

Tabla de identidad para todos los elementos participantes del VFS.

- `id`: clave primaria compartida para el objeto
- `object_type`: `folder`, `contact`, `photo`, `note`, etc.
- `owner_id`: id del usuario propietario
- `encrypted_session_key`: clave de cifrado de contenido (cifrada en reposo)
- `public_hierarchical_key`: clave publica para comparticion de subarbol
- `encrypted_private_hierarchical_key`: clave jerarquica privada cifrada

### `vfs_folders`

Metadatos especificos de carpeta para elementos del registro de tipo `folder`.

- `id`: clave foranea a `vfs_registry.id`
- `encrypted_name`: nombre de carpeta cifrado con la clave de sesion del elemento

### `vfs_links`

Relaciones padre-hijo entre elementos del registro.

- `parent_id`, `child_id`
- `wrapped_session_key`: clave de sesion del hijo envuelta con la clave jerarquica del padre
- `wrapped_hierarchical_key`: clave jerarquica del hijo envuelta (opcional)
- `visible_children`: filtrado opcional de hijos para vistas de comparticion parcial

Esto soporta un diseno tipo DAG donde un objeto puede estar enlazado desde multiples
padres.

### `user_keys`

Material de claves por usuario.

- clave publica de cifrado (para recibir comparticiones)
- clave publica de firma
- claves privadas cifradas
- sal Argon2 para derivacion basada en contrasena

### `vfs_access`

Concesiones directas de elemento a usuario.

- claves de elemento envueltas para el destinatario
- nivel de permiso (`read`, `write`, `admin`)
- metadatos de expiracion opcionales

## Patron de Registro

Las tablas de dominio comparten claves primarias con `vfs_registry`.

Ejemplo:

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
  encrypted_data BYTEA NOT NULL
);
```

Esto mantiene la integridad referencial fuerte y permite que las operaciones del VFS traten
objetos de dominio a traves de una capa de identidad.

## Modelo de Comparticion y Recorrido

### Apertura de una raiz

1. Leer concesiones directas en `vfs_access`
2. Descifrar claves envueltas con la clave privada del usuario
3. Renderizar elementos raiz

### Recorrido de hijos

1. Consultar `vfs_links` por `parent_id`
2. Desenvolver claves de hijos usando la clave jerarquica del padre
3. Repetir recursivamente

### Comparticion de un subarbol

1. Envolver claves raiz para el usuario destinatario
2. Insertar concesion en `vfs_access`
3. El destinatario recorre el subarbol a traves de claves de enlace envueltas

### Ubicacion multiple

El mismo objeto puede estar enlazado desde multiples padres agregando mas filas
en `vfs_links`. Cada enlace puede tener restricciones de visibilidad independientes.

## Direccion de Cifrado

Direccion de diseno actual:

- cifrado de contenido: `AES-256-GCM`
- derivacion de contrasena: `Argon2id` + `HKDF`
- comparticion/envolvimiento de claves: hibrido `ML-KEM-768 + X25519`
- firmas: `ML-DSA` (o `Ed25519` donde sea necesario)

La intencion del diseno es defensa en profundidad mas un camino hacia la resistencia post-cuantica.

## Ejemplo de Jerarquia

```text
Carpeta "Personas"
  - Contacto "Juan Perez"
    - Foto (avatar)
    - Nota "Conocido en conferencia"

Carpeta "Contactos de Trabajo"
  - Contacto "Juan Perez" (mismo objeto, diferente enlace)
```

Diferentes enlaces al mismo hijo pueden exponer diferentes subconjuntos de descendientes.

## Notas sobre OPFS

Se espera que las cargas binarias (fotos/archivos) residan en OPFS con cifrado
a nivel de elemento. El registro VFS almacena metadatos y claves envueltas; los bytes binarios permanecen
en almacenamiento gestionado por el cliente.

## Fases de Implementacion

1. Tablas centrales y primitivas de ciclo de vida de claves
2. Plomeria criptografica (generacion de claves, envolvimiento, flujos de desenvolvimiento)
3. Operaciones VFS (enlazar, compartir, dejar de compartir, recorrido)
4. Integraciones de dominio (contactos/fotos/notas + campos cifrados)
5. Caracteristicas avanzadas (`visible_children`, rotacion de claves, expiracion, recuperacion)

## Advertencias Actuales

- Este es un documento de diseno en evolucion, no una especificacion finalizada.
- Las restricciones de tipo padre/hijo actualmente se esperan en la capa de aplicacion.
- Los flujos de rotacion de claves y recuperacion estan planificados pero no finalizados.
