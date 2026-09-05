# Workflow request audit

These measurements use the real application, SDK and test API through the
proxied-request recorder. They include background convergence after a successful
operation. They are healthy-network fixture budgets, not retry limits or a claim
that larger organizations, pagination, attachments and outages cost the same.

## Coverage and measurements

| Operation and fixture | Requests | Coverage |
| --- | ---: | --- |
| Personal identity/org bootstrap, one pane, Explorer and system folders ready | **30 → 25** | New total and endpoint budgets |
| Additional organization creation and activation, existing identity | 8 | New budget; provisioning itself is one `POST /organizations` |
| Create a custom group, two provisioned panes | 6 | New budget for first and subsequent group |
| Add a previously unknown peer to a custom group | 9 | New budget |
| Add that verified peer to another custom group | 8 | New budget; identity lookup reused |
| Add a new peer to Admins, including peer convergence | 56 observed, existing ceiling 58 | Existing `DualPaneProvider.groupsRequestVolume` budget |
| Create an ordinary child folder under a warm root | 3 | New budget |
| Link a document into the new folder, retaining its root link | 1 | New budget |
| Unlink that folder, retaining the root link | 3 | New budget |
| Move the previously unlinked document into Trash | 5 | New budget and regression for consecutive structural operations |
| Move the emptied folder into Trash | 6 | New budget |
| Restore that folder to the root | 8 | New budget |

The new tests are `OrganizationBootstrapRequestVolume`,
`GroupMutationRequestVolume` and `FolderMutationRequestVolume` in
`packages/app/src/components/pane/tests`. Each phase pins successful mutation
counts as well as total and endpoint ceilings. Local-first moves must reach their
remote commits before the helper checks idle: an optimistic row appearing in
Trash alone does not prove that the move completed.

Existing upload, shared-attachment, active-peer and writer-projection tests cover
other request boundaries. Sidebar reload budgets count local projection reloads,
not HTTP requests. Separate operation budgets remain useful for member removal,
group deletion, nonempty folder moves, permanent deletion/Empty Trash, paginated
organizations, and retry/restart variants. Failure tests should establish eventual
convergence and bounded retry behavior separately from healthy-path ceilings.

## Bootstrap reduction

The original single-pane bootstrap made ten container-document list requests:
five normal discovery reads followed by five full-list reads for the initial
missing-document recovery probe. The probe cannot infer absence from incremental
deltas, so simply deleting its reads would break recovery.

The reconciler now gives the probe a completed unwatermarked discovery listing.
It accepts the listing only after all pages and local persistence succeed, and
only for the same probe generation and eligible container. Incremental responses,
failed/partial pagination, failed local apply, and completions from an earlier
lifecycle cannot substitute for a full probe read. The candidate scan still
syncs locally stored documents absent from the server listing; the ordinary
server-authorized sync verdict decides deletion or revoked access.

This removes five requests per cold pane (about 17% overall, 50% of document-list
reads). The other 25 requests include eight document syncs, four parent-lane
queries, authentication/session setup, Contacts/self-contact creation and initial
projection/billing reads. Additional organization provisioning already commits
its root, policies and core system artifacts atomically, with persisted retry
artifacts; its eight-request activation did not need a new batching endpoint.

## Integrity bug found by the baselines

The sequence create note → link folder → unlink folder → move to Trash could
update the local UI while its durable move remained pending. Rotation preflight
pulled older content and quarantined it because a retained content-key bundle's
latest link-set/target metadata differed from the older update's signed header.
Same-epoch rewrapping after linking makes that difference legitimate.

Historical keys that can be unwrapped now proceed through the existing signed
writer/history authorization and authenticated ciphertext/plaintext validation.
Document identity, content epoch, canonical target hashes and consistent key
unwraps remain checked. An unavailable key still must match the original signed
target commitments before being classified as missing history; forged unavailable
targets remain integrity failures. A substituted key that unwraps but cannot
authenticate the record is isolated at `decrypt` instead of `content_key`.
Ordinary and raw-history decryption tests,
existing tampering/isolation tests, and the real application link/unlink/Trash
sequence cover this distinction.

## Further reductions and their constraints

- Group creation and membership updates spend most requests reading policy heads
  and refreshing the organization read model. Current policy reads feed signed
  compare-and-swap mutations. Reusing stale authorization state to save those
  reads would be a poor trade. Coalescing read-model refreshes is a narrower
  opportunity, provided cursor advancement, in-flight invalidation and failed
  refresh retry remain correct.
- Linking already takes one write. Unlink's three requests include a current
  writer projection and a rotation-preflight sync; removing either requires a
  proof that the client still has the current authorization and complete history.
- Document Trash/move uses a durable link-then-unlink workflow. An outage can
  temporarily leave both links present; retry completes the remaining leg.
  A future atomic final-link-set endpoint could replace the two writes with one.
  It must validate destination access, serialize against concurrent document
  writes, commit the rotation baseline with the final manifest, and support
  lost-response replay. This audit keeps that protocol boundary intact.
