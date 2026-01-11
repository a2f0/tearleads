# Chrome Extension

The Rapid Chrome extension is located in `packages/chrome-extension`. It uses Manifest V3 and is built with Vite and TypeScript.

## Project Structure

```text
packages/chrome-extension/
├── public/
│   ├── manifest.json      # Chrome extension manifest
│   └── icons/             # Extension icons (SVG)
├── src/
│   ├── background/        # Service worker (runs in background)
│   ├── content/           # Content script (injected into pages)
│   ├── popup/             # Popup UI script
│   ├── popup.html         # Popup HTML
│   └── messages.ts        # Shared message types
├── dist/                  # Build output (load this in Chrome)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Development

### Building

```bash
# One-time build
pnpm --filter @rapid/chrome-extension build

# Watch mode (rebuilds on file changes)
pnpm --filter @rapid/chrome-extension dev
```

### Loading in Chrome (Developer Mode)

1. Build the extension (or run in watch mode)
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `packages/chrome-extension/dist` folder
6. The extension should appear in your extensions list

When running in watch mode (`pnpm dev`), the extension rebuilds automatically on file changes. After changes:

- **Background script:** Click the refresh icon on the extension card in `chrome://extensions`.
- **Content script:** Reload the target page.
- **Popup:** Close and reopen the popup.

### Testing

```bash
# Run tests once
pnpm --filter @rapid/chrome-extension test

# Watch mode
pnpm --filter @rapid/chrome-extension test:watch

# With coverage report
pnpm --filter @rapid/chrome-extension test:coverage
```

## Architecture

### Manifest V3

The extension uses [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3), Chrome's latest extension platform:

- **Service Worker**: Background script runs as a service worker (`background.js`)
- **Content Scripts**: Restricted to specific domains (`*.rapid.app` and `localhost`)
- **Permissions**: Minimal permissions (`storage`, `activeTab`)

### Components

| Component | File | Purpose |
| --------- | ---- | ------- |
| Background | `src/background/index.ts` | Service worker handling extension events and message routing |
| Content Script | `src/content/index.ts` | Injected into matching pages to interact with page content |
| Popup | `src/popup/index.ts` | UI shown when clicking the extension icon |

### Message Passing

Components communicate via Chrome's message passing API. Message types are defined in `src/messages.ts`:

```typescript
// Example: Send message from popup to background
chrome.runtime.sendMessage({ type: "PING" }, (response) => {
  console.log(response); // { type: "PONG" }
});
```

## Deployment

### Chrome Web Store

To publish to the Chrome Web Store:

1. Build the extension: `pnpm --filter @rapid/chrome-extension build`
2. Create a ZIP file of the contents of the `dist` folder (the `manifest.json` file should be at the root of the ZIP archive).
3. Upload to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)

### Version Bumping

The extension version is managed by `scripts/bumpVersion.sh`, which updates both:

- `packages/chrome-extension/package.json`
- `packages/chrome-extension/public/manifest.json`

Run from repo root:

```bash
./scripts/bumpVersion.sh
```

## Debugging

### Background Service Worker

1. Go to `chrome://extensions`
2. Find the Rapid extension
3. Click **Service Worker** link to open DevTools for the background script

### Content Script

1. Open DevTools on a page where the content script runs
2. Content script logs appear in the page's console
3. Use the **Sources** panel to set breakpoints in content scripts

### Popup

1. Click the extension icon to open the popup
2. Right-click inside the popup and select **Inspect**
3. DevTools opens for the popup context
