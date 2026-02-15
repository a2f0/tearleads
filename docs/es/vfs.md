# VFS (Sistema de Archivos Virtual)

Estado: diseño en progreso (rastreado en el issue de GitHub #1220).

Este documento captura la dirección de diseño actual del VFS para Tearleads. El objetivo
es soportar compartición cifrada y multiusuario de objetos de dominio (contactos, fotos,
notas, archivos) con jerarquía flexible y gestión robusta de claves.

## Objetivos

- Organizar objetos de dominio en una jerarquía (carpetas y estructuras anidadas)
- Compartir objetos o subárboles entre usuarios
- Permitir que el mismo objeto aparezca en múltiples lugares
- Mantener el contenido cifrado de extremo a extremo con envolvimiento explícito de claves

## Modelo de Datos Central

### `vfs_registry`

Tabla de identidad para todos los elementos participantes del VFS.

- `id`: clave primaria compartida para el objeto
- `object_type`: `folder`, `contact`, `photo`, `note`, etc.
- `owner_id`: id del usuario propietario
- `encrypted_session_key`: clave de cifrado de contenido (cifrada en reposo)
- `public_hierarchical_key`: clave pública para compartición de subárbol
- `encrypted_private_hierarchical_key`: clave jerárquica privada cifrada

### `vfs_folders`

Metadatos específicos de carpeta para elementos del registro de tipo `folder`.

- `id`: clave foránea a `vfs_registry.id`
- `encrypted_name`: nombre de carpeta cifrado con la clave de sesión del elemento

### `vfs_links`

Relaciones padre-hijo entre elementos del registro.

- `parent_id`, `child_id`
- `wrapped_session_key`: clave de sesión del hijo envuelta con la clave jerárquica del padre
- `wrapped_hierarchical_key`: clave jerárquica del hijo envuelta (opcional)
- `visible_children`: filtrado opcional de hijos para vistas de compartición parcial

Esto soporta un diseño tipo DAG donde un objeto puede estar enlazado desde múltiples
padres.

### `user_keys`

Material de claves por usuario.

- clave pública de cifrado (para recibir comparticiones)
- clave pública de firma
- claves privadas cifradas
- sal Argon2 para derivación basada en contraseña

### `vfs_access`

Concesiones directas de elemento a usuario.

- claves de elemento envueltas para el destinatario
- nivel de permiso (`read`, `write`, `admin`)
- metadatos de expiración opcionales

## Patrón de Registro

Las tablas de dominio comparten claves primarias con `vfs_registry`.

Ejemplo:

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
  encrypted_data BYTEA NOT NULL
);
```

Esto mantiene la integridad referencial fuerte y permite que las operaciones del VFS traten
objetos de dominio a través de una capa de identidad.

## Modelo de Compartición y Recorrido

### Apertura de una raíz

1. Leer concesiones directas en `vfs_access`
2. Descifrar claves envueltas con la clave privada del usuario
3. Renderizar elementos raíz

### Recorrido de hijos

1. Consultar `vfs_links` por `parent_id`
2. Desenvolver claves de hijos usando la clave jerárquica del padre
3. Repetir recursivamente

### Compartición de un subárbol

1. Envolver claves raíz para el usuario destinatario
2. Insertar concesión en `vfs_access`
3. El destinatario recorre el subárbol a través de claves de enlace envueltas

### Ubicación múltiple

El mismo objeto puede estar enlazado desde múltiples padres agregando más filas
en `vfs_links`. Cada enlace puede tener restricciones de visibilidad independientes.

## Dirección de Cifrado

Dirección de diseño actual:

- cifrado de contenido: `AES-256-GCM`
- derivación de contraseña: `Argon2id` + `HKDF`
- compartición/envolvimiento de claves: híbrido `ML-KEM-768 + X25519`
- firmas: `ML-DSA` (o `Ed25519` donde sea necesario)

La intención del diseño es defensa en profundidad más un camino hacia la resistencia post-cuántica.

## Ejemplo de Jerarquía

```text
Carpeta "Personas"
  - Contacto "Juan Pérez"
    - Foto (avatar)
    - Nota "Conocido en conferencia"

Carpeta "Contactos de Trabajo"
  - Contacto "Juan Pérez" (mismo objeto, diferente enlace)
```

Diferentes enlaces al mismo hijo pueden exponer diferentes subconjuntos de descendientes.

## Notas sobre OPFS

Se espera que las cargas binarias (fotos/archivos) residan en OPFS con cifrado
a nivel de elemento. El registro VFS almacena metadatos y claves envueltas; los bytes binarios permanecen
en almacenamiento gestionado por el cliente.

## Fases de Implementación

1. Tablas centrales y primitivas de ciclo de vida de claves
2. Plomería criptográfica (generación de claves, envolvimiento, flujos de desenvolvimiento)
3. Operaciones VFS (enlazar, compartir, dejar de compartir, recorrido)
4. Integraciones de dominio (contactos/fotos/notas + campos cifrados)
5. Características avanzadas (`visible_children`, rotación de claves, expiración, recuperación)

## Advertencias Actuales

- Este es un documento de diseño en evolución, no una especificación finalizada.
- Las restricciones de tipo padre/hijo actualmente se esperan en la capa de aplicación.
- Los flujos de rotación de claves y recuperación están planificados pero no finalizados.
