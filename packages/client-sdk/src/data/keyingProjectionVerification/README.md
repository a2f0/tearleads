# Keying Projection Verification Internals

`index.ts` is the public client-side verifier facade for server writer
projections. The rest of this folder holds its internal helpers.

- At the root, `readers.ts` decodes canonical wire records into crypto
  verification inputs, and `error.ts`, `types.ts`, `dependencyUnavailable.ts`,
  `projectionLifetimes.ts`, and `userKeyResolver.ts` hold the shared error,
  type, lifetime, and user-key helpers.
- `checkpoints/bundleVerification.ts` owns the canonical-equality assert,
  bundle-map helper, and signed access-event bundle verification shared by both
  halves. The folder also enforces manifest and access-manifest checkpoints.
- `container/containerAncestorCitations.ts` rebuilds a container event's
  authorization path from the ancestor heads its signed event cites, and holds
  the no-regression rules those citations and the served heads must satisfy.
- `container/containerManifestVerification.ts` verifies container manifest
  bundles, including parent-path resolution and previous-manifest checks.
- `container/containerPathVerification.ts` verifies a served container path as
  a root-to-leaf chain whose served heads descend from the heads each element
  cites.
- `container/containerProjectionVerification.ts` verifies container KEK
  projections and full container writer projections, and collects their
  principal policies.
- `document/documentProjectionVerification.ts` verifies document manifest
  bundles and document writer projections over their container paths.
- `document/documentDependencyPaths.ts` resolves full signed container-path
  citations by parent id, rejecting missing ancestors and conflicting container
  heads.
- `documentPurge/` verifies document purge proofs and their checkpoint and
  policy currency.
- `principalPolicy/` holds the principal policy cache and verification,
  projection policy and authorization evidence, and organization founder
  binding.

Keep exported verifier functions and types on `index.ts` so workflow and store
layers do not import these internals directly.
