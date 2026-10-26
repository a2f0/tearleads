# bob-and-alice

Multi-party scenarios that establish the keying protocol's working condition
end to end. Each scenario registers real users, gives each one or more
devices, and drives them through the client SDK's public API against the real
API served over HTTP. Nothing reaches past those two surfaces, so a scenario
can only do and observe what a deployed client could.

- `src/harness/apiServer.ts` boots one in-process API per test process from
  `@tearleads/api/test-runtime`.
- `src/harness/device.ts` is one installed client: its own SQLite database and
  a full `Tearleads` runtime. `Device.login` is a fresh install of an existing
  identity, with the same keys and an empty database.
- `src/harness/accessModel.ts` is a deliberately naive reference for who may
  read and write each document, from parent pointers, grants, and group
  memberships alone.
- `src/harness/world.ts` applies each operation to a device and, once the
  device has settled, to the model.
- `expectAccess` reads a document on every device of every user and compares
  the result with the model. A current reader must see the latest text. Anyone
  else may see nothing written after they lost access. `expectNoSecurityIncidents`
  requires an honest API to trip no device's trust-boundary checks.

Scenarios live in `src/scenarios`. Set `HARNESS_TRACE=1` to print each device's
read and each scenario's key-epoch series.

```sh
bun run --filter='@tearleads/client-sdk' build
bun test packages/bob-and-alice/src
```

The SDK resolves from `packages/client-sdk/dist`, so rebuild it after an SDK
edit. `bun run check:package @tearleads/bob-and-alice` builds it for you.
