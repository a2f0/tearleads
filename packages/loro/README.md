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

## Import refusals

Import blobs through `importUpdates` and `importSnapshot`, never through a
document's own `import`. Loro throws its refusals as bare strings; these
helpers name the ones callers act on:

- `LoroReusedOperationIdError`: the blob carries an operation id the document
  already holds with other content. It names the first such id Loro met. The
  sync judge voids the update and, when the update's declared span reuses ids
  under the peer this device writes with, records a
  [preemption notice](../../docs/peer-ownership.md#preemption-notices).
- `LoroImportUnresolvedDependenciesError`: the blob depends on operations the
  document lacks, which Loro keeps as pending.

`importUpdates` is not all-or-nothing. When one update of a batch is refused
on its own, it throws and the document keeps what the other updates brought.
Operations a document already holds import again as a no-op.

## Text writes

Write a document's text through `updateText`, never through a text
container's own `update`. Loro's diffs run in one synchronous WebAssembly call
and take time quadratic in how much of the text differs, so `updateText` gives
each one `TEXT_DIFF_BUDGET_MS` and falls back when it runs out. A diff that
runs out leaves the document as it was. The result says how the write was
expressed, which decides how it merges with a concurrent edit:

- `character`: only the characters that differ were deleted and inserted. An
  ordinary edit or paste takes this path.
- `line`: only the lines that differ were. A concurrent edit inside a line the
  write kept merges into it; one inside a rewritten line loses its
  surroundings.
- `whole`: every character held was deleted and the new text inserted. A
  concurrent insert survives, without any of the text it was written into.

## Runtime contract

[`runtimeContract.test.ts`](./src/runtimeContract.test.ts) pins behavior of the
exact Loro version that document sync is built on:

- One large text insert imports into a non-empty document in bounded time.
  Loro 1.16.4 took time quadratic in the insert's size.
- While an update is pending under a document's own peer id, Loro refuses that
  document's local writes with `ConcurrentOpsWithSamePeerID`. The way out is a
  fresh peer id. Sync never leaves such an update in a live document: the
  judge voids an update whose dependencies no earlier update carries before it
  reaches one.

[`textUpdate.test.ts`](./src/textUpdate.test.ts) pins what `updateText` relies
on: a diff past its `timeoutMs` throws an `Error` whose message is
`Update timeout`, and leaves the document as it was.

See [dependency maintenance](../../docs/dependency-upgrades.md#current-constraints)
for what moving the Loro pin requires.
