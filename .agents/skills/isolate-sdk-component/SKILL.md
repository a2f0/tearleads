---
name: isolate-sdk-component
description: Untangle or extract a component inside packages/client-sdk along clear seams, naming ports for its collaborators, moving its per-database or per-scope state into a scoped singleton, composing them in a service, and enforcing the boundary with dependency rules. Use when isolating an SDK component for clearer boundaries or cheaper tests, adding a collaborator to one, or reviewing such a change. Not for splitting the SDK into new workspace packages without measured need.
---

# Isolate an SDK Component

Give one client SDK component boundaries a reader can see and tests can
exercise alone. The patterns are in `docs/developer/client-sdk-seams.md`; this
skill is the workflow for applying them. Keep matching copies of this skill
under `.agents/skills` and `.claude/skills`.

An isolation request authorizes refactoring inside `packages/client-sdk` and
the test or caller updates it forces in other packages. Honor report-only
requests. Shipping is separate: use `ship-pr` only when requested. Read
`AGENTS.md` for validation, build prerequisites, output capture, and
versioning.

## Survey before cutting

1. Record HEAD and the component's paths. Measure its size (files, lines,
   tests) and, when tests are the motivation, its share of suite time from a
   recent run.
2. List its collaborators: every module outside the component it imports at
   runtime, every runtime field it reads (`apiClient`, `infra.execSql`,
   timers, the sync coordinator), and every callback threaded into it through
   an option bag.
3. List its process-local state: module-level `WeakMap`, `Map`, `Set`, and
   counters. Note what each is keyed by, and whether that key is the canonical
   executor (`resolveCanonicalExecSql`), a `DomainScope`, or something else.
4. For each collaborator, note every implementation that exists today:
   production, alternate production paths (local bundles, pinned or replayed
   data), and test fakes. A collaborator with only one implementation is a
   dependency, not yet a seam.

## Plan the seams

Order the work so each pull request is one reviewable seam:

1. **Ports** for collaborators with more than one implementation. These are
   renames and type consolidation, so they are low risk.
2. **A scoped singleton** for the component's process-local state.
3. **A service** that composes the ports and the singleton behind one entry
   point, replacing option bags, together with the component's dependency
   rules.

Present the plan with the evidence from the survey before starting a large
extraction. Start each later seam only when the user has approved it or
approved the whole sequence. Recommend a separate workspace package only when
the component's tests are heavy enough for Turbo caching to matter or it has
consumers outside the SDK; the SDK publishes to npm, so every new workspace
dependency must be published too.

## Cut a port

1. Declare the interface once, named for the capability (`…Reader`, `…Clock`),
   with a doc comment saying which adapters exist and that their output is
   still verified.
2. Replace every inline copy of the signature: API slices extend the port and
   option bags take the port.
3. Name fields for the role (`historyReader`, `currentPolicyReader`). Keep
   `apiClient` where the value really is an API client slice.
4. Pass the adapter object. Remove lambdas and `.bind` calls that only rewrap
   one of its methods.
5. Name inline adapters, such as a reader that serves pinned heads, as small
   functions returning the port.
6. Let the compiler find the callers. Rebuild the SDK, then typecheck each
   dependent package directly with
   `bunx tsc -p packages/<name>/tsconfig.json --noEmit`. Do not trust an
   incremental `tsc --build` alone.

## Move state into a scoped singleton

1. Create one `getOrCreate<Name>(scope)` module backed by a private `WeakMap`.
   Key per-database state by `resolveCanonicalExecSql(execSql)` and per-scope
   state by `DomainScope`.
2. Put the related state in that one object and share primitives inside it.
   Delete the old modules rather than leaving forwarding wrappers.
3. Place the module in the lowest layer that writes the state; data-layer
   writers need it under `src/data/`.
4. If the key changes, for example from the caller's executor to the canonical
   one, check every caller's executor and every re-entrant path. Queued work
   that queues again on the same key deadlocks.
5. Add a unit test for sharing across executors and for per-key ordering. Make
   it fail under the old keying before relying on it.

## Compose a service and enforce the boundary

1. Give the service one entry point that takes its ports and resolves its
   singleton, so callers stop threading the same collaborators through every
   call.
2. Add rules to `scripts/architecture/dependencyCruiserClientSdkRules.ts`:
   index-only entry, no runtime imports of upper layers, type-only imports
   allowed. Probe each rule with a temporary violating import, then remove the
   import.
3. Register new paths in the subsystem manifest if `lint:architecture` asks.

## Hold back

- Do not add a port over code with one implementation and no test that needs
  a fake. Say so in the pull request instead.
- Do not swap a fake that exercises trust-boundary code, such as the real API
  client iterator against a `Bun.serve` server, for an in-memory adapter.
- Do not merge look-alike code on verifier paths when the call sites differ in
  provenance, types, or conditions.
- Do not weaken a verifier, a check, or a test to make a seam fit.

## Validate and report

- Run the component's focused tests and the full client SDK suite. For API
  callers, rebuild the SDK and run the affected API files with
  `API_DATABASE=memory` and `API_DATABASE=sqlite`.
- Run `bun run lint:architecture`, `bun run lint:source-shape -- --staged`,
  and `bun run check:fast`. Run `bun run lint:formal-maps` when a renamed or
  removed function appears in a `formal/` abstraction map, and update the map
  in the same change.
- Report what moved, what deliberately stayed and why, any public option
  renames, any keying or ordering change with the test that pins it, and the
  next seam with its evidence.
