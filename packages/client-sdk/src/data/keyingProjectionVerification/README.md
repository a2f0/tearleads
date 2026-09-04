# Keying Projection Verification Internals

`../keyingProjectionVerification.ts` is the public client-side verifier facade
for server writer projections. Files in this folder hold internal helpers for
that facade.

- `readers.ts` decodes canonical wire records into crypto verification inputs.
- `bundleVerification.ts` owns the canonical-equality assert, bundle-map
  helper, and signed access-event bundle verification shared by both halves.
- `containerAncestorCitations.ts` rebuilds a container event's authorization
  path from the ancestor heads its signed event cites, and holds the
  no-regression rule those citations must satisfy.
- `containerAncestorCurrency.ts` holds the currency rule: a served head newer
  than the local checkpoint must cite the served current ancestor heads or be
  signed by a member still authorized at them, with a move's source ancestors
  held to the device's own checkpoints.
- `containerManifestVerification.ts` verifies container manifest bundles,
  including parent-path resolution and previous-manifest checks.
- `containerPathVerification.ts` verifies a served container path as a
  root-to-leaf chain and holds a current path's elements to the served heads
  above them, re-checking a stale-citing head's signer at the current path.
- `containerProjectionVerification.ts` verifies container KEK projections and
  full container writer projections, and collects their principal policies.
- `documentProjectionVerification.ts` verifies document manifest bundles and
  document writer projections over their container paths.
- `documentDependencyPaths.ts` reconstructs verified container paths from
  history and resolves the container paths a link event cites.

Keep exported verifier functions and types on `../keyingProjectionVerification.ts`
so workflow and store layers do not import these internals directly.
