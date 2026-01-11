# Extensión de Chrome

La extensión de Chrome de Rapid se encuentra en `packages/chrome-extension`. Utiliza Manifest V3 y está construida con Vite y TypeScript.

## Estructura del Proyecto

```text
packages/chrome-extension/
├── public/
│   ├── manifest.json      # Manifiesto de la extensión de Chrome
│   └── icons/             # Iconos de la extensión (SVG)
├── src/
│   ├── background/        # Service worker (se ejecuta en segundo plano)
│   ├── content/           # Script de contenido (inyectado en páginas)
│   ├── popup/             # Script de UI del popup
│   ├── popup.html         # HTML del popup
│   └── messages.ts        # Tipos de mensajes compartidos
├── dist/                  # Salida de compilación (cargar esto en Chrome)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Desarrollo

### Compilación

```bash
# Compilación única
pnpm --filter @rapid/chrome-extension build

# Modo watch (recompila con cambios de archivos)
pnpm --filter @rapid/chrome-extension dev
```

### Cargar en Chrome (Modo Desarrollador)

1. Compile la extensión (o ejecute en modo watch)
2. Abra Chrome y navegue a `chrome://extensions`
3. Habilite el **Modo desarrollador** (interruptor en la esquina superior derecha)
4. Haga clic en **Cargar descomprimida**
5. Seleccione la carpeta `packages/chrome-extension/dist`
6. La extensión debería aparecer en su lista de extensiones

Cuando se ejecuta en modo watch (`pnpm dev`), la extensión se recompila automáticamente con los cambios de archivos. Después de los cambios:

- **Script de fondo:** Haga clic en el icono de actualización en la tarjeta de la extensión en `chrome://extensions`.
- **Script de contenido:** Recargue la página de destino.
- **Popup:** Cierre y vuelva a abrir el popup.

### Pruebas

```bash
# Ejecutar pruebas una vez
pnpm --filter @rapid/chrome-extension test

# Modo watch
pnpm --filter @rapid/chrome-extension test:watch

# Con informe de cobertura
pnpm --filter @rapid/chrome-extension test:coverage
```

## Arquitectura

### Manifest V3

La extensión utiliza [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3), la última plataforma de extensiones de Chrome:

- **Service Worker**: El script de fondo se ejecuta como un service worker (`background.js`)
- **Scripts de Contenido**: Restringidos a dominios específicos (`*.rapid.app` y `localhost`)
- **Permisos**: Permisos mínimos (`storage`, `activeTab`)

### Componentes

| Componente | Archivo | Propósito |
| ---------- | ------- | --------- |
| Background | `src/background/index.ts` | Service worker que maneja eventos de extensión y enrutamiento de mensajes |
| Script de Contenido | `src/content/index.ts` | Inyectado en páginas coincidentes para interactuar con el contenido de la página |
| Popup | `src/popup/index.ts` | UI mostrada al hacer clic en el icono de la extensión |

### Paso de Mensajes

Los componentes se comunican a través de la API de paso de mensajes de Chrome. Los tipos de mensajes se definen en `src/messages.ts`:

```typescript
// Ejemplo: Enviar mensaje desde popup a background
chrome.runtime.sendMessage({ type: "PING" }, (response) => {
  console.log(response); // { type: "PONG" }
});
```

## Despliegue

### Chrome Web Store

Para publicar en la Chrome Web Store:

1. Compile la extensión: `pnpm --filter @rapid/chrome-extension build`
2. Cree un archivo ZIP del contenido de la carpeta `dist` (el archivo `manifest.json` debe estar en la raíz del archivo ZIP).
3. Suba al [Panel de Desarrollador de Chrome](https://chrome.google.com/webstore/devconsole)

### Incremento de Versión

La versión de la extensión es gestionada por `scripts/bumpVersion.sh`, que actualiza ambos:

- `packages/chrome-extension/package.json`
- `packages/chrome-extension/public/manifest.json`

Ejecute desde la raíz del repositorio:

```bash
./scripts/bumpVersion.sh
```

## Depuración

### Service Worker de Fondo

1. Vaya a `chrome://extensions`
2. Encuentre la extensión Rapid
3. Haga clic en el enlace **Service Worker** para abrir DevTools para el script de fondo

### Script de Contenido

1. Abra DevTools en una página donde se ejecute el script de contenido
2. Los registros del script de contenido aparecen en la consola de la página
3. Use el panel **Sources** para establecer puntos de interrupción en los scripts de contenido

### Popup

1. Haga clic en el icono de la extensión para abrir el popup
2. Haga clic derecho dentro del popup y seleccione **Inspeccionar**
3. DevTools se abre para el contexto del popup
