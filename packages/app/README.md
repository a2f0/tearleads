# app

The Tearleads React application: the shell, mini-apps, document types, and
product UI shared by every deployment target. [app-web](../app-web/README.md),
[app-capacitor](../app-capacitor/README.md), and
[app-electrobun](../app-electrobun/README.md) each build a host configuration
from their platform adapters and render this app with it; the app itself
contains no platform code.

The app runs on the [client SDK](../client-sdk/README.md) and draws its
windows with [`@tearleads/windowing`](../windowing/README.md). Presentation
goes through stores and providers; it does not import persistence, SQLite,
sync, or workflow internals directly.

## Entry points

| Entry point | Use for |
| --- | --- |
| `app/client` | `renderApp(root, { hostConfig })` |
| `app/App` | The root `App` component |
| `app/host/AppHostConfig` | `createAppHostConfig`, host profiles (`app`, `demo`, `screenshot`), and the adapter types a host supplies |
| `app/host/AppDiagnostics` | The diagnostics contract a host implements |

## Layout

| Path | Contents |
| --- | --- |
| [`src/shell`](src/shell/) | Windowed and routed layouts and pane chrome |
| [`src/mini-apps`](src/mini-apps/README.md) | Mini-apps (notes, contacts, explorer, organization manager, system monitor, and more) and the bus between their windows |
| [`src/document-types`](src/document-types/) | One folder per document type and the registry that maps stored kinds to editors |
| [`src/document-projectors`](src/document-projectors/) | SQL projections of document content for listing and search |
| [`src/providers`](src/providers/README.md) | Pane-level runtime providers: host configuration, identity, database, SDK, API, billing |
| [`src/stores`](src/stores/README.md) | Long-lived domain state between presentation and the SDK |
| [`src/navigation`](src/navigation/), [`src/theme`](src/theme/) | Navigation actions over the windowing launcher; themes |
| [`src/demo`](src/demo/) | The two-pane demo's peer seeding |

The [UI design system](../../docs/ui-design-system.md) describes the two shells
and the chrome conventions across desktop, tablet, and phone.

## Tests

```sh
bun run check:package app
```

The test preload refuses to start when `packages/client-sdk/dist` is older
than the SDK source; `check:package` rebuilds it first. The suite also boots
the API in-process for its request mocks.
[`test/screenshot-seed`](test/screenshot-seed/) builds the
seeded database the shared screenshots start from.
