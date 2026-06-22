# Productionize Scrub — packages/app, packages/api, packages/api-client

_Date: 2026-06-22. Method: multi-agent review (22 zones) → adversarial verification of every finding → synthesis. The 3 "high" app/api findings were additionally re-read by hand; corrections are noted inline._

## Baseline (all green before the scrub)

`knip` (all + production), `dependency-cruiser` architecture, `source-shape`, `biome`, and `tsc --build` all pass. Zero `any` casts, zero stray `console.log`/`debugger`, zero unmanaged TODO/FIXME in production source. The only suppressions are 7 deliberate, baselined `biome-ignore` complexity exemptions. This was a latent-quality hunt, not a fix-the-breakage pass.

**Headline:** The code is in good shape. No critical data-corruption or security holes. The adversarial pass rejected 38 of 99 raw findings as false (plausible "races"/"NaN bugs" actually handled by downstream validation, transaction rollback, React cleanup semantics, or JS execution order). After my hand re-read, **2 of 3 reported "highs" were overstated** — the real top-tier list is short.

---

## Tier 1 — Do these (confirmed, real)

| # | File:Lines | Issue | Fix | Effort |
|---|-----------|-------|-----|--------|
| 1 | `api/src/workflows/auth/registration.ts:1158-1163` | `toRegisterPrincipalPolicyError` maps via `error.message.startsWith("Principal state " / "Principal member envelope(s)")`, collapsing messages that are deliberately **403/409** elsewhere (`putPrincipalState.ts`, `putPrincipalMemberEnvelopes.ts`) into **400**. | Exact `===` match per known message, or typed/`instanceof` errors; assign 403/409/400 to match the source modules. | M |
| 2 | `api/src/wsInterestStore.ts:76-78` | `apply()` returns after `srem` on the `remove` kind without re-arming `deps.expire(key, TTL)`. `add`/`replace` re-arm; the file's own comment says every write should. | Add `await deps.expire(key, WS_INTEREST_TTL_SECONDS)` after the `srem` in the remove branch; add a TTL test. | S |
| 3 | `api/src/workflows/documents/mutations/syncDocument.ts:410-412` | Throws bare `new Error("Missing audit entry hash…")`; `toMutationError` returns null for non-`DocumentMutationError`, so it escapes as a **500** instead of a 4xx. | Throw `new DocumentMutationError(…, 409)`. | S |
| 4 | `app/src/document-types/importers.ts:62-73` | `inferMimeType` explicitly rejects `application/octet-stream` to force extension inference, but the final fallback still `return declaredMimeType`, re-introducing exactly that value for unknown extensions. | Drop `declaredMimeType` from the fallback: `return MIME_BY_EXTENSION.get(ext) ?? ""`. | S |
| 5 | `api/src/adapters/s3BlobObjectStreams.ts:58-91` | `stream.getReader()`'s lock isn't released on the success/cancel paths (`reader.cancel()` does not release per spec). Sibling helpers release in `finally`. **Correction:** leak is *bounded* — reader + source stream GC together when the wrapping stream is dropped; it's a contract/consistency issue, not the "steady leak under load" originally claimed. Treat as **medium**. | Track the reader; `releaseLock()` on all exits, mirroring `readBlobObjectStream`. | S |
| 6 | `api/src/workflows/principals/putPrincipalMemberEnvelopes.ts:189-227` | Response returns `currentState.stateHash` (pre-write) rather than the validated/written `input.stateHash`. Bounded by optimistic-concurrency check, so it's response *accuracy*, not corruption. | Return `input.stateHash` (or the written envelopes' hash) at line 225. | S |

## Tier 2 — Resource-cleanup asymmetry (one root pattern, API)

Success paths skip cleanup that error paths perform. Worth fixing together:
- `s3BlobObjectStreams.ts:118-143` — `asyncIterableToStream` doesn't `closeAsyncIterator` on normal `done` (error/cancel paths do). **S**
- `services/blobs/multipartStage.ts:409-422` — object-store `deleteObject` runs before the DB stage update on validation failure; a delete throw orphans the row. Reorder DB-first or wrap deletes in defensive try/catch. **M**
- `services/blobs/multipartStage.ts:205-219` — `cleanupExpiredBlobStages` increments `failedStages` but never adds the id to `cleanedStageIds`, so an un-cleanable row is retried forever with no logging. Add logging + an age/retry bound. **M**
- `services/blobs/multipartStage.ts:274-279` — non-`BlobObjectStoreError` DB-insert failure rethrows without aborting the multipart upload (the `stageBlob` path aborts). **S, low**
- `adapters/blobObjectStore.ts:193-241` — in-memory store strands upload state + key lock when part validation throws before map cleanup. Mostly affects the test adapter. **S, low**

## Tier 3 — App async-error discipline (one root pattern)

Fire-and-forget IIFEs / bare `catch {}` that swallow errors or skip fallback state, diverging from the try/catch-with-logging used elsewhere in the same zones. All small:
- `mini-apps/explorer/detail/ExplorerDocumentDetail.tsx:131-134` — `.catch` only applies `fallbackSyncState` when the document changed; the same-document retry path swallows failures with no log/state. **(medium)**
- `mini-apps/explorer/hooks/useSelectedDocumentStructuralState.ts:167-183` — async IIFE with no try/catch (sibling hook wraps it).
- `mini-apps/explorer/detail/ExplorerLinkedContainers.tsx:76-79, 115-118` — two bare `catch {}` set a generic error without logging.
- `mini-apps/backup-restore/BackupRestoreController.ts:248-265` — `useRestoreFileSelection` reads `file.text()` with no cancellation; a fast second selection can restore content from a *different* file than the one displayed. Guard with an AbortController/selection token. **(medium)**
- `providers/sdk/TearleadsProvider.tsx:330-332` — ws-ticket request IIFE lacks error handling (no leak; just silent failure). **(low)**
- `mini-apps/contacts/hooks/useContactsModel.ts:269-288` — import failures logged but never surfaced to the UI (other mini-apps show `MiniAppStatus tone=error`).

## Tier 4 — api-client

- **Unbounded cache Maps** (`ApiClient.ts:144-171`): five `cachedRequest`-backed Maps (writer projections, attachment lists, encapsulation keys, org groups) cache successful responses with no size cap/LRU; cleared only by `setAuthToken` or targeted mutations. The same missing bound makes the on-failure `.clear()` wipe *all* documents' attachment caches. Add a shared bounded/LRU helper, prioritizing the document/container-keyed Maps. **(medium)** — extends the existing [cache-staleness] note (remote changes still don't invalidate these).
- **`ApiClient.ts` is 1196 lines** (>2× the 500 budget). Split per the source-shape ratchet (don't baseline): extract the bounded cache → `ApiCache.ts` and transport/retry → `ApiTransport.ts`, leaving route delegation. **(medium, large effort)**
- **Test response factories untyped** (`ApiClient.testFactories.ts`): request factories are typed, response factories aren't, so wire-shape drift won't fail them. Add return-type annotations + the needed `@tearleads/validators/response` imports. **(small)** _(no `createBlobAttachmentDetachResponse` exists — don't import that type.)_
- Low: header constants lowercase vs server title-case (`routes/blobs/get.ts:5-8`); internal helpers file-exported (`getChallenge`, `appendQuery`, `appendOptionalWatermark`); test-support files in `src/` vs other packages' `test/helpers/`.

## Tier 5 — Quality/DRY/types (low, batchable)

- WS reconnect hydration race can clobber interest declared during async open — `api/src/ws.ts:66-68`. **(medium, edge-case)**
- `listContainerDocuments.ts:245-283` — false-positive `hasMore` from independent slice-then-merge-then-slice. **(medium)**
- Redundant `useMemo` deps defeating memoization: `LocalKeyringLockProvider.tsx:433` (depends on whole rebuilt `input`), `ExplorerTree.tsx:709-717` (`collapsedIdsKey` vs `collapsedIds`), `PaneProvider.tsx:41-53`.
- DRY duplication: UUID regex (blob routes), `compactId` (explorer detail), `EMPTY_PROFILE_DISPLAY_NAMES` (×4 org-manager files), `readAttachmentUpload` (×3), `principalStateReferenceKey` (container workflow), boot-pane log logic (Pane/RoutedPane).
- Type nits: `?? ""` on guaranteed strings (`DriverLicense.tsx:45,59`), mistyped `setDraftUserId` (should be `Dispatch<SetStateAction<string>>`), `containerListRevision` param actually receives a nodes array, vestigial `note` callback names in `documentSummaryUtils.ts`.
- Cross-domain `DocumentMutationError` import in `routes/containers/mutations.ts` (wrap as `ContainerMutationError`).

---

## Corrections to the automated report (re-read by hand)

- **`useRestoreKeyPackage` (localIdentityPersistence.ts:393-409)** was ranked "high / corrupted identity." Overstated: the real serialization primitive is `generationIdRef.current += 1` (line 395), which *does* cancel in-flight generates. The only gap is restore-vs-restore re-entry. **Low/medium.**
- **`useWindowFileMenuItem` (WindowMenuContext.tsx:278-303)** was ranked "high / stale entries accumulate." Mostly wrong: on `enabled→disabled` React fires the prior effect's cleanup (`unregisterFileMenuItem`, line 293) before the new body's early return, so it *does* unregister. Only a cosmetic asymmetry vs the refresh hook. **Drop or low.**
- **`listContainerDocuments.ts` "false-positive `hasMore`" (Tier 5)** — DROPPED on follow-up (2026-06-22). Empirically modeled: the third `hasMore` condition (`returnedChanges.length < items.length + tombstones.length`) is *necessary*, not buggy. The loaders fetch `limit+1`, so per-source overflow (conditions 1–2) only catches a single source exceeding the page; condition 3 catches the case where documents + tombstones *combined* exceed the page while neither overflows alone (e.g. `limit=10, docs=6, tombs=6` drops 2 real changes). The recommended "drop condition 3" fix would **under-report** `hasMore` and strand those changes. Current code is correct; left as-is.

## Out of scope / already correct
WS auth + scoping (the old global-broadcast bug) is **fixed** by #1052–#1056. 38 rejected findings (NaN/bounds validation, several "races", transaction-rollback "leaks") were verified false — kept in the raw task output if you want the rationale.
