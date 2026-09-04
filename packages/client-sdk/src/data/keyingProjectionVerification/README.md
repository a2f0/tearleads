# Keying Projection Verification Internals

`../keyingProjectionVerification.ts` is the public client-side verifier facade
for server writer projections. Files in this folder hold internal helpers for
that facade.

- `readers.ts` decodes canonical wire records into crypto verification inputs.
- `bundleVerification.ts` owns the canonical-equality assert, bundle-map
  helper, and signed access-event bundle verification shared by both halves.
- `containerAncestorCitations.ts` rebuilds a container event's authorization
  path from the ancestor heads its signed event cites, and holds the
  currency and no-regression rules those citations must satisfy.
- `containerManifestVerification.ts` verifies container manifest bundles,
  including parent-path resolution and previous-manifest checks.
- `containerProjectionVerification.ts` verifies container KEK projections and
  full container writer projections, and collects their principal policies.
- `documentProjectionVerification.ts` verifies document manifest bundles and
  document writer projections over their container paths.
- `documentDependencyPaths.ts` reconstructs verified container paths from
  history and resolves the container paths a link event cites.

Keep exported verifier functions and types on `../keyingProjectionVerification.ts`
so workflow and store layers do not import these internals directly.
