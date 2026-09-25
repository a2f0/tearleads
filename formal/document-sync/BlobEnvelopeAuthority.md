# Blob envelope write authority

[`BlobEnvelopeAuthority.tla`](./BlobEnvelopeAuthority.tla) models findings 9 and
11 of #2365. A writer binding an existing blob to document B may read document A,
but that read does not authorize replacing A's stored envelopes. The transaction
validates B's exact binding targets, retains every other stored envelope byte for
byte, and recomputes the merged bundle hash while holding the blob lock.

| Model action or predicate | Production seam |
| --- | --- |
| `BindB` / `ScopeBindingWrites` / `ForeignEnvelopesUnchanged` | `storeBlobContentKeyBundleInTransaction` validates one binding; `replaceBlobContentKeyTargetsForExistingBundle` persists the merged target set under `lockAttachmentAuthorizationForShare` |
| `Rotate` / `epoch` | `resolveCurrentBlobKekTargets` derives current epochs from stored container heads |
| `PrepareFreshWrap` / `VerifyFreshDestination` / `FreshKeysUseCurrentEpoch` | `collectRelinkKeks` derives a full destination identity from each verified current projection; `prepareDocumentLinkBlobRewraps` uses that identity before encrypting |
| `observedForeign` / `served` | `getLatestBlobContentKeyBundle` supplies the stored foreign envelope bytes carried into the new set |

The bounded model uses two documents and two epochs. It abstracts a complete
verified destination tuple (container, manifest, epoch identity, and epoch
number) into the current epoch. Signature verification, encryption, SQL locking,
and byte equality are assumed at the named seams. It does not model network
availability or claim that old keys can no longer decrypt old ciphertext.
Historical keys remain valid for opening existing content; the fresh DEK in
this model did not exist before rotation.

The API regression uses two users: a source reader and destination writer tries
to replace the source's first envelope after rotation. The refused request rolls
back, a binding-only retry preserves the source bytes, and the source's own later
rewrap still succeeds. The full SDK relink regression uploads a fresh attachment
after rotation, omits that linked container's current path, and offers its retired
key through the new destination's verified parent history. It proves the unfixed
planner discloses the fresh DEK under that retired key. An honest partial view
continues to retain authenticated existing envelopes without needing a new wrap.
