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
  identity, with the same keys and an empty database. `Device.restart` reopens
  the runtime with the same database, blob store, identity, and trust pins.
- `src/harness/transport.ts` puts a device-local HTTP proxy in front of the real
  API. A scenario can hold a selected request before submission or its response
  after commit, then release or drop it. Gates make races reproducible and
  recorded HTTP statuses prove which transaction lost the race. A scenario can
  also rewrite matching JSON responses to play a dishonest server at the
  network boundary, while the API itself stays honest.
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
  refused edit of that document. Restored writers must converge again.
  `expectNoSecurityIncidents` requires an honest API to trip no device's
  trust-boundary checks.
- An edit the actor may make must change local text and settle with nothing
  left pending. Reads by the other devices check that it reached the API.
- An operation runs on the actor's first device unless a scenario names
  another. A device acts on a folder only once its own tree holds it, so a
  fresh install first pulls the folder from the API. Cold document reads also
  start from folders in that device's discovered tree.
- `keyEpoch` reads a folder's current key epoch from the API, bypassing the
  reading device's cached projection.

## Scenarios

Scenarios live in `src/scenarios`. Set `HARNESS_TRACE=1` to print each
operation, each device's read, each scenario's key-epoch series, and every
request the API refuses with its error body.

| Scenario | Establishes |
| --- | --- |
| `overlappingGrants` | A direct grant keeps access after an overlapping group grant goes. The original read-only editor becomes writable after a direct grant; revoked edits are refused. |
| `writeAccessRecovery` | Read/write group overlap, membership and grant downgrades, refused edits, restoration observed in the original device's stored permissions, recovery from a cached projection with old policy evidence, later remote edits, and empty content. |
| `rotationHistory` | A group shrink, a revoke, and a move each rotate the folder key, and each shrink rotates the content key. A fresh install makes the first write after a shrink. A newcomer reads through the folder keyring before any re-wrap. |
| `nestedTree` | A revoke rotates exactly the folder and the level above a deeper direct grant. The grantee repairs its own subtree with its first write, from a device that held the path before the revoke. A move takes a group's access away from the moved subtree. |
| `multiLinkDocument` | A document linked into two folders follows each link's access through a write via either link, a group shrink, and an unlink. |
| `groupPaths` | A member keeps access, and write access, while any of its groups still grants it. |
| `groupShrinkCarry` | A group shrink above a deeper direct grant carries the level between in its policy commit. One group granted at two levels of a chain, in either order, re-signs both grants and shrinks in one commit, from fresh admin installs. |
| `groupRevoke` | Unsharing a folder from a group carries the level above a deeper direct grant, whose grantee repairs from the device that held the path. Revoking either of one group's two grants on a chain leaves the member exactly what the other reaches. |
| `heldPathRehydration` | Writers whose devices held a path from before a revoke, a group shrink, and a second revoke all write afterwards, each repairing what it may. |
| `manyRotations` | Eight rounds of a group gaining and losing a member rotate the folder sixteen times, with a confidentiality check after every removal; an idle direct grantee then writes, and a reader admitted last reads. An organization admin who is not one of the group's own admins mints a new group key on every add, and the API re-keys every container granted to a group whose key epoch advances. |
| `retryAfterRestart` | A committed edit whose response is lost survives a restart of the same database, replays its persisted update IDs, drains the outbox, and converges without duplicate content. |
| `leaveRequestMembership` | A leave request survives another member's removal, which Alice's device confirms by walking verified Members history to the head the request cites. A dishonest server that serves the request again after its member was removed and added back cannot make Alice's device show it. |
| `offlineRevocation` | An offline outbox survives restart without publishing a revoked writer's edit or disclosing later content; the original database writes again after a regrant. |
| `concurrentFirstWriters` | Two writers race the first content-key repair after revocation. One gets a stale-write refusal, retries, and preserves both edits while the revoked reader stays excluded. |
| `concurrentShareAndRevoke` | In both controlled orderings, a stale share or revoke retries once against the newer path, preserving the concurrent grant and the revocation. |
| `concurrentGroupShareAndRevoke` | A direct share racing a group revocation succeeds in both orderings. The stale group-policy commit rebuilds its container batch once, preserves the new grant, and excludes old and fresh revoked readers. |
| `shareAfterGroupShare` | A user share right after a group share above it lands, though this device's own background re-citation advances the shared folder's head meanwhile. |

Pin a reproducible open issue in `src/scenarios/knownIssues.test.ts` as a
`test.failing` case. It passes while the bug stands and fails once it is
fixed; convert it into an ordinary scenario then, as the scenarios above did
for [#2646](https://github.com/a2f0/tearleads/issues/2646),
[#2647](https://github.com/a2f0/tearleads/issues/2647),
[#2648](https://github.com/a2f0/tearleads/issues/2648), and
[#2651](https://github.com/a2f0/tearleads/issues/2651). No issue is pinned now.

## Limits

- The API runs without realtime hints, so devices learn about changes only
  when they pull. A device that lost write access may keep accepting local
  edits that never sync, and keeps showing them. The harness records those as
  the device's own refused edits and accepts them on that device and document
  alone while it lacks write access.
- Every device trusts identities on first use through the SDK's own pins; no
  scenario models a malicious API.

## Running

```sh
bun run --filter='@tearleads/client-sdk' build
bun test packages/bob-and-alice/src
```

The SDK resolves from `packages/client-sdk/dist`, so rebuild it after an SDK
edit. `bun run check:package @tearleads/bob-and-alice` builds it for you.
