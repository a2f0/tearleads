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
  device has settled, to the model. A member added to another user's
  organization works inside it from then on, on every device, as a member
  switching to that organization would.
- `expectAccess` reads a document on every device of every user and compares
  the result with the model. A current reader must see the latest text. Anyone
  else may see nothing written after they lost access, apart from their own
  refused edit. `expectNoSecurityIncidents` requires an honest API to trip no
  device's trust-boundary checks.
- An edit the actor may make must settle with nothing left pending, so a write
  that only ever landed locally fails the operation.
- An operation runs on the actor's first device unless a scenario names
  another. A device acts on a folder only once its own tree holds it, so a
  fresh install first pulls the folder from the API.
- `keyEpoch` reads a folder's current key epoch from the API, bypassing the
  reading device's cached projection.

## Scenarios

Scenarios live in `src/scenarios`. Set `HARNESS_TRACE=1` to print each
operation, each device's read, each scenario's key-epoch series, and every
request the API refuses with its error body.

| Scenario | Establishes |
| --- | --- |
| `overlappingGrants` | A direct grant keeps access after an overlapping group grant goes. Read-only and revoked edits are refused. |
| `rotationHistory` | A group shrink, a revoke, and a move each rotate the folder key, and each shrink rotates the content key. A fresh install makes the first write after a shrink. A newcomer reads through the folder keyring before any re-wrap. |
| `nestedTree` | A revoke rotates exactly the folder and the level above a deeper direct grant. The grantee repairs its own subtree with its first write, from a device that held the path before the revoke. A move takes a group's access away from the moved subtree. |
| `multiLinkDocument` | A document linked into two folders follows each link's access through a write via either link, a group shrink, and an unlink. |
| `groupPaths` | A member keeps access, and write access, while any of its groups still grants it. |
| `groupShrinkCarry` | A group shrink above a deeper direct grant carries the level between in its policy commit. One group granted at two levels of a chain, in either order, re-signs both grants and shrinks in one commit, from fresh admin installs. |

Pin a reproducible open issue in `src/scenarios/knownIssues.test.ts` as a
`test.failing` case. It passes while the bug stands and fails once it is
fixed; convert it into an ordinary scenario then. The scenarios above route
around these open issues:

- [#2647](https://github.com/a2f0/tearleads/issues/2647): a share shortly
  after a group share on an ancestor can race the SDK's own descendant
  re-cite. It is intermittent, so it has no `test.failing` reproduction.

## Limits

- The API runs without realtime hints, so devices learn about changes only
  when they pull. A device removed from a group may keep accepting local edits
  that never sync. The harness records those as the device's own refused edits.
- Every device trusts identities on first use through the SDK's own pins; no
  scenario models a malicious API.

## Running

```sh
bun run --filter='@tearleads/client-sdk' build
bun test packages/bob-and-alice/src
```

The SDK resolves from `packages/client-sdk/dist`, so rebuild it after an SDK
edit. `bun run check:package @tearleads/bob-and-alice` builds it for you.
