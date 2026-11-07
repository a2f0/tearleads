# Keying Projection Verification Internals

[`index.ts`](index.ts) is the public client-side verifier facade for server
writer
projections. The rest of this folder holds its internal helpers.

- At the root, [`readers.ts`](readers.ts) decodes canonical wire records into
  crypto
  verification inputs, and [`error.ts`](error.ts), [`types.ts`](types.ts),
  [`dependencyUnavailable.ts`](dependencyUnavailable.ts),
  [`projectionLifetimes.ts`](projectionLifetimes.ts), and
  [`userKeyResolver.ts`](userKeyResolver.ts) hold the shared error,
  type, lifetime, and user-key helpers.
- [`checkpoints/bundleVerification.ts`](checkpoints/bundleVerification.ts) owns
  the canonical-equality assert,
  bundle-map helper, and signed access-event bundle verification shared by both
  halves. The folder also enforces manifest and access-manifest checkpoints.
- [`container/containerAncestorCitations.ts`][file-1] rebuilds a container
  event's
  authorization path from the ancestor heads its signed event cites, and holds
  the no-regression rules those citations and the served heads must satisfy.
- [`container/containerManifestVerification.ts`][file-2] verifies container
  manifest
  bundles, including parent-path resolution and previous-manifest checks.
- [`container/containerPathVerification.ts`][file-3] verifies a served
  container path as
  a root-to-leaf chain whose served heads descend from the heads each element
  cites.
- [`container/containerProjectionVerification.ts`][file-4] verifies container
  KEK
  projections and full container writer projections, and collects their
  principal policies.
- [`document/documentProjectionVerification.ts`][file-5] verifies document
  manifest
  bundles and document writer projections over their container paths.
- [`document/documentDependencyPaths.ts`](document/documentDependencyPaths.ts)
  resolves full signed container-path
  citations by parent id, rejecting missing ancestors and conflicting container
  heads.
- [`documentPurge/`](documentPurge/) verifies document purge proofs and their
  checkpoint and
  policy currency.
- [`principalPolicy/`](principalPolicy/) holds the principal policy cache and
  verification,
  projection policy and authorization evidence, and organization founder
  binding.

Keep exported verifier functions and types on [`index.ts`](index.ts) so workflow
and store
layers do not import these internals directly.

[file-1]: container/containerAncestorCitations.ts
[file-2]: container/containerManifestVerification.ts
[file-3]: container/containerPathVerification.ts
[file-4]: container/containerProjectionVerification.ts
[file-5]: document/documentProjectionVerification.ts
