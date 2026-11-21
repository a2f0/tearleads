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

[Contact addresses](src/document-types/contact/README.md) documents the shared
Contacts/Explorer editor, repeated Loro records, and attribution boundaries.

[Document history](src/stores/document-history/README.md) documents Explorer's
History view: replaying a document's changes, restoring a past version, and
saving one as a copy.

In the regular app’s windowed layout, right-click the bare desktop and choose
**Start Screensaver**. To start it from the routed layout, first switch to the
windowed layout. The grayscale lasers start on demand with no idle timer.
Without a PIN,
input dismisses the animation. With a local-keyring PIN configured, it becomes a
full-screen privacy gate that checks the existing PIN before dismissal.
Incorrect PINs keep the overlay visible; Cancel or Escape from the PIN prompt
returns to the artwork. Editors, unsaved changes, sessions, and app data remain
live underneath, including across workspace and layout changes. This hides
the app from view; it does not lock the keyring or secure live app data.
**Lock** remains a separate security action that locks the local keyring.
An active gate fails closed if another tab removes the PIN or storage prevents
verification. If verification cannot recover, reloading may be necessary and
can discard unsaved edits; removing the PIN elsewhere does not dismiss a gate.

The isolated two-peer demo does not expose this action: its peers have
independent runtimes and PINs rather than one app-wide privacy gate.

## Creating documents

In Explorer, choose **New Document** and use **Search document types** to narrow
the available types as you type. Search matches part of a type's name, ignores
case and surrounding spaces, and shows a message when nothing matches. Clear
the search to restore every type, then select a type to open its editor.

## Resetting this device

**Identity Manager → Local Data → Reset Device** erases everything the app
keeps on the device and restarts it as a fresh install, on web, desktop, and
mobile alike. A locked keychain offers the same action as **Forgot PIN? Reset
Device**. Type `reset device` to confirm. Data on the server is not touched;
an identity's recovery phrase signs it back in.

Every shell keeps local data in its WebView's origin storage: OPFS (the SQLite
databases, blobs, and desktop state), IndexedDB (the local keyring),
localStorage, and sessionStorage. Capacitor also stages decrypted share and
preview copies in its native cache directory, which it clears through the
`clearNativeCache` host hook. Confirming records a request and reloads;
[`DeviceResetGate`](src/providers/device-reset/DeviceResetGate.tsx) then wipes
all of it before the app renders, so nothing on the page holds or rewrites the
data being removed, and the reload restarts the SDK from nothing. WKWebView
(iOS and the macOS desktop) has no OPFS on the main thread, so there the first
database boot has the SQLite worker wipe OPFS before it opens anything.

On the web, the app's other tabs reload when a reset starts and come back to a
notice instead of the app, so only one page boots the fresh device. A page
mounts the app only once it holds a shared Web Lock, and keeps it while the
app is mounted; the wipe takes that lock exclusively, so it starts only after
those pages have unloaded and none of their in-flight writes can land
afterwards. A page that gets its lock while a reset is pending stops at the
notice. A tab that cannot unload, such as a frozen background tab, makes the
reset time out and report a failure; the reset then has to be retried,
because part of the device may already be wiped.
The web app's offline asset cache is kept; it holds no user data.

## Tests

```sh
bun run check:package app
```

The test preload refuses to start when `packages/client-sdk/dist` is older
than the SDK source; `check:package` rebuilds it first. The suite also boots
the API in-process for its request mocks.
[`test/screenshot-seed`](test/screenshot-seed/) builds the
seeded database the shared screenshots start from.

## Headless Continuity import

The `app/continuity` entry point exposes the app document projectors, pinned
dataset loader, Contacts folder resolver, and seed writer used by the
[CLI](../cli/README.md#seed-an-account-with-continuity) and screenshot builder.
