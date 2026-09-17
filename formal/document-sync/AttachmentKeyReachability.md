# Attachment keys across access changes

[`AttachmentKeyReachability.tla`](./AttachmentKeyReachability.tla) models
finding 7 of #2266. A link commits its signed blob wraps with the document
manifest. A concurrent attachment bind must either precede preparation or
invalidate the prepared binding frontier. Container rotations retain earlier
KEKs; reads can use earlier wraps without requiring another writer to repair
an unrelated document content-key bundle.

| Model action or predicate | Production seam |
| --- | --- |
| `RetainedTargetsNeedCiphertext` / `LinkedDocumentCanUnlink` | `prepareDocumentLinkBlobRewraps` verifies retained binding scope without downloading ciphertext when no new envelope is needed |
| `RemainingEnvelopesRetained` | `retainedTarget` requires an existing envelope at each remaining destination's current KEK epoch |
| `PrepareLink` | `prepareDocumentLinkBlobRewraps` authenticates bytes and wraps their DEK to verified targets |
| `cachedWraps` / `cacheValid` | `ApiClient.listDocumentAttachments` caches the envelopes used while preparing link |
| `InvalidateAttachmentCache` | `ApiClient.evictDocumentWriterProjection` also evicts the document attachment list after link/unlink or stale-state retries |
| `MovePreservesCommittedEnvelopes` | `prepareDocumentLinkBlobRewraps` retains the destination envelope committed by link instead of generating conflicting randomized material |
| `CheckBindingFrontier` | `lockDocumentLinkBlobRewraps` checks all active bindings under the exclusive document head |
| `CommitLink` / `UnlinkSource` | `applyDocumentLinkBlobRewraps` commits scoped wraps inside the link transaction |
| `BindSecond` | `lockAttachmentAuthorizationForShare` holds the document head through attachment bind |
| `RelinkSource` / `ReuseRetiredWraps` / `ReenteredTargetsRemainWritable` | `resolveRetainedBlobTargetEnvelopes` reuses a retired target envelope while rejecting changes to active key material |
| `RetainPriorWraps` | `replaceBlobContentKeyTargetsForExistingBundle` appends target sets |
| `UseHistoricalKeys` | `assertBlobWrapScopeVerified` and `unwrapBlobContentKey` use verified history and retained KEKs |
| `Hydrate` / `IsolateHydration` | `collectHydrationResults` keeps independent successes and reports typed failures |

The finite model uses two bindings, two containers, and two KEK epochs.
It abstracts signature verification, ciphertext authentication, and keyring
cryptography. Implementation tests exercise signed link tampering, transaction
rollback, retained SQL rows, a cold destination-only read, and an actual signed
container rekey with a sealed predecessor keyring. The seven negative controls
independently remove frontier validation, wrap retention, historical-key reads,
per-attachment result isolation, ciphertext-independent removal, cache
invalidation between move steps, and reuse when
a document returns to an earlier
destination. The route regression covers link, unlink, and relink at an
unchanged
KEK epoch, including a conflicting active wrap that must still return 409.
`moveAttachmentCache.test.ts` additionally exercises a warm `ApiClient` against
the real API: link commits a destination envelope and unlink must retain that
exact envelope on the first attempt. Disabling cache invalidation gives the
model the same pre-link cache on unlink and violates
`MovePreservesCommittedEnvelopes`. Envelope bytes and random generation are
abstracted as a conflict when a retained destination is missing from that cache.
Mutation response failures and late attachment read completions are covered by
`ApiClient.attachmentInvalidation.test.ts`; the model abstracts cache eviction
and the next fresh read as one transition.

In addition to safety, a fair unlink action must remain enabled when one blob is
unavailable and no new key envelope is needed. The model does not claim eventual
network delivery or access to withheld ciphertext. The prepared epoch equality
abstracts the
API's locked current target validation. Unlink preserves the historical DEK
because blob ciphertext is immutable; it does not make already obtained bytes
secret from a former reader. The model does not abstract principal membership
or authorization policy, which remain separately verified before wrapping.

Rewrap authentication streams ciphertext in bounded chunks and discards
plaintext
after each authentication check. `createAttachmentKeyAuthenticator` retains only
verified keys, metadata, and the signed ciphertext identity across bindings. It
checks every binding independently and verifies the complete ciphertext hash
before releasing a key for rewrapping. When a new envelope is needed, transport
bandwidth is still required for a cold blob because the signed header commits
the complete ciphertext. Retaining or removing existing envelopes verifies their
signed binding and scope without fetching the bytes; invalid ciphertext does not
block that removal. Creating a new recipient envelope still requires
authenticated bytes.

The unlink progress property applies while every remaining destination has an
envelope for its current KEK epoch. A concurrent or earlier rekey can invalidate
that precondition; producing the new envelope then requires ciphertext
authentication even though the operation removes a link.
