# @tearleads/loro

Build support for [Loro](https://loro.dev), the CRDT library behind document
sync.

`@tearleads/loro/bun-plugin` exports `loroWasmPlugin` for Bun build scripts.
It resolves Loro to its supported base64 entrypoint, embedding WASM and its
JavaScript glue in the resulting bundle or standalone executable. Use it for
browser builds and `Bun.build({ compile: ... })` builds so deployment does not
require files from `node_modules`. Runtime consumers import the regular
`@tearleads/loro` entrypoints.

## Change timestamps

`createDocument` is the only way to make a document that authors. It turns on
Loro timestamp recording, so every change carries the Unix time, in seconds, of
its commit, and a writer's consecutive commits share a change only within
`DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS` of its timestamp. The setting belongs
to the document instance rather than its exported bytes: a bare `new LoroDoc()`
that edits would stamp the newest time it has imported instead of the current
one. Read-only scratch documents may be bare; `fork()` keeps the setting.

## History timeline

`openHistoryViewer` takes a scratch document from `createReadOnlyDocument` that
already holds the history to browse, and returns its changes as ordered `stops`
with `checkout(index)` and `versionAt(index)`. `orderHistoryStops` is the pure
ordering: recorded time, then Lamport time, then peer, with a change never
placed before one it depends on, so every prefix is a real version whatever the
clocks recorded. The viewer keeps its document detached, so it cannot be
edited; never hand it a document that is being edited.
