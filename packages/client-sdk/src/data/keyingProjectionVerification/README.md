# Keying Projection Verification Internals

`../keyingProjectionVerification.ts` is the public client-side verifier facade
for server writer projections. Files in this folder hold internal helpers for
that facade.

- `readers.ts` decodes canonical wire records into crypto verification inputs.
- `bundleVerification.ts` owns the canonical-equality assert, bundle-map
  helper, and signed access-event bundle verification shared by both halves.
- `containerAncestorCitations.ts` rebuilds a container event's authorization
  path from the ancestor heads its signed event cites, and holds the
  no-regression rules those citations and the served heads must satisfy.
- `containerManifestVerification.ts` verifies container manifest bundles,
  including parent-path resolution and previous-manifest checks.
- `containerPathVerification.ts` verifies a served container path as a
  root-to-leaf chain whose served heads descend from the heads each element
  cites.
- `containerProjectionVerification.ts` verifies container KEK projections and
  full container writer projections, and collects their principal policies.
- `documentProjectionVerification.ts` verifies document manifest bundles and
  document writer projections over their container paths.
- `documentDependencyPaths.ts` resolves full signed container-path citations
  by parent id, rejecting missing ancestors and conflicting container heads.

Keep exported verifier functions and types on `../keyingProjectionVerification.ts`
so workflow and store layers do not import these internals directly.
