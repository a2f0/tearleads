import { Buffer } from "node:buffer";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type {
  DocumentSyncResponse,
  DocumentSyncUpdateResponse,
} from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES } from "@tearleads/validators/util";
import type { StoredDocumentContentKeyBundle } from "../../../access/read/documentContentKeyStore";
import {
  resolveBaselineRedirectAfterSequence,
  selectServedSyncUpdateEntries,
  selectServedSyncUpdates,
} from "../../../documents/documentSyncBaselineRedirect";
import { DocumentMutationError, documentSyncStateStale } from "./errors";
import { toContentKeyBundleResponse } from "./shared/records";
import {
  assertSyncPullResponseFits,
  createSyncPullPageResponse,
  type SyncPullPagePlan,
} from "./syncPullPagination";
import { listMissingSyncUpdateEntries } from "./syncResponseUpdates";

type SyncResponseWithoutCommit = Omit<
  DocumentSyncResponse,
  "commitLsn" | "commitLsnMode"
>;

type SyncResponseBase = Omit<
  SyncResponseWithoutCommit,
  "contentKeyBundles" | "pullPage" | "updates"
>;

interface PullResponseEntry {
  readonly sequence: number;
  readonly update: DocumentSyncUpdateResponse;
  readonly writeHeader: { readonly contentKeyEpoch: number };
}

interface PullIdentity {
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
}

interface RawPullPage {
  readonly hasMore: boolean;
  readonly lastUpdateId: string | null;
  readonly lastSequence: number;
}

const MAX_COMMIT_LSN = "FFFFFFFF/FFFFFFFF";

export async function listMissingSyncUpdatesForResponse(input: {
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly pullPagePlan: SyncPullPagePlan | null;
  readonly request: DocumentSyncRequest;
}) {
  const rawHistoryRequested = input.request.historyMode === "raw";
  const effectivePullPagePlan =
    input.pullPagePlan === null
      ? null
      : {
          ...input.pullPagePlan,
          afterSequence: rawHistoryRequested
            ? input.pullPagePlan.afterSequence
            : await resolveBaselineRedirectAfterSequence({
                afterSequence: input.pullPagePlan.afterSequence,
                contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
                documentId: input.documentId,
                executor: input.executor,
                localVersionVector: input.request.localVersionVector,
                upperBoundSequence: input.pullPagePlan.upperBoundSequence,
              }),
        };
  const missingUpdateResult = await listMissingSyncUpdateEntries({
    documentId: input.documentId,
    executor: input.executor,
    localVersionVector: input.request.localVersionVector,
    minLsn: input.request.minLsn,
    ...(effectivePullPagePlan === null
      ? {}
      : { pullPage: effectivePullPagePlan }),
  });
  const missingUpdateEntries = missingUpdateResult.entries;
  if (
    missingUpdateEntries.some(
      (entry) =>
        entry.writeHeader.contentKeyEpoch >
        input.contentKeyBundle.contentKeyEpoch,
    )
  ) {
    throw documentSyncStateStale(
      "Document content key changed while building sync response",
    );
  }
  // Readers behind a rotation receive the current-epoch baseline instead of
  // older ciphertext only when that authenticated baseline covers every
  // omitted update. The sequence ceiling keeps a newer concurrent baseline
  // from redirecting a snapshot that cannot include it.
  const servedUpdateEntries = rawHistoryRequested
    ? selectServedSyncUpdates({
        baselineCoverage: null,
        currentContentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
        entries: missingUpdateEntries,
        historyMode: "raw",
      })
    : effectivePullPagePlan === null
      ? await selectServedSyncUpdateEntries({
          currentContentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
          documentId: input.documentId,
          entries: missingUpdateEntries,
          executor: input.executor,
        })
      : missingUpdateEntries;
  return {
    entries: servedUpdateEntries,
    page: "page" in missingUpdateResult ? missingUpdateResult.page : undefined,
  };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function responsePagePropertyBytes(pullPage: unknown): number {
  // The base object is non-empty. Adding { pullPage } replaces its closing
  // brace with a comma, the property body, and the same closing brace.
  return serializedBytes({ pullPage }) - 1;
}

type WireContentKeyBundle = ReturnType<typeof toContentKeyBundleResponse>;

async function selectPullResponsePrefix(input: {
  readonly baseBytes: number;
  readonly currentBundle: WireContentKeyBundle;
  readonly cursorHmacKey: string | null;
  readonly entries: readonly PullResponseEntry[];
  readonly historyMode?: DocumentSyncRequest["historyMode"];
  readonly identity: PullIdentity;
  readonly loadContentKeyBundle: (
    contentKeyEpoch: number,
  ) => Promise<StoredDocumentContentKeyBundle | null>;
  readonly maxBytes: number;
  readonly page: RawPullPage;
  readonly plan: SyncPullPagePlan;
}) {
  const selectedBundlesByEpoch = new Map([
    [input.identity.contentKeyEpoch, input.currentBundle],
  ]);
  let bundleArrayDelta = serializedBytes(input.currentBundle);
  let selectedCount = 0;
  let updateArrayDelta = 0;
  let pullPage = createSyncPullPageResponse({
    cursorHmacKey: input.cursorHmacKey,
    hasMore: input.page.hasMore,
    historyMode: input.historyMode,
    identity: input.identity,
    lastUpdateId: input.page.lastUpdateId,
    plan: input.plan,
  });

  for (const [index, entry] of input.entries.entries()) {
    const entryEpoch = entry.writeHeader.contentKeyEpoch;
    const selectedBundle = selectedBundlesByEpoch.get(entryEpoch);
    let candidateBundle = selectedBundle;
    if (!candidateBundle) {
      const storedBundle = await input.loadContentKeyBundle(entryEpoch);
      if (!storedBundle) {
        throw new DocumentMutationError(
          "Document content-key bundle missing",
          409,
        );
      }
      candidateBundle = toContentKeyBundleResponse(storedBundle);
    }
    const candidateBundleDelta = selectedBundle
      ? bundleArrayDelta
      : bundleArrayDelta + 1 + serializedBytes(candidateBundle);
    const candidateUpdateDelta =
      updateArrayDelta + (index === 0 ? 0 : 1) + serializedBytes(entry.update);
    const candidateCount = index + 1;
    const selectedEveryEntry = candidateCount === input.entries.length;
    const candidatePullPage = createSyncPullPageResponse({
      cursorHmacKey: input.cursorHmacKey,
      hasMore: input.page.hasMore || !selectedEveryEntry,
      historyMode: input.historyMode,
      identity: input.identity,
      lastUpdateId: selectedEveryEntry
        ? input.page.lastUpdateId
        : entry.update.id,
      plan: input.plan,
    });
    const responseBytes =
      input.baseBytes +
      candidateBundleDelta +
      candidateUpdateDelta +
      responsePagePropertyBytes(candidatePullPage);
    if (responseBytes > input.maxBytes) break;
    selectedBundlesByEpoch.set(entryEpoch, candidateBundle);
    bundleArrayDelta = candidateBundleDelta;
    selectedCount = candidateCount;
    updateArrayDelta = candidateUpdateDelta;
    pullPage = candidatePullPage;
  }
  return {
    contentKeyBundles: [...selectedBundlesByEpoch.values()].sort(
      (left, right) => left.contentKeyEpoch - right.contentKeyEpoch,
    ),
    pullPage,
    selectedCount,
  };
}

/**
 * Select the longest response prefix whose actual updates, epoch bundles, and
 * cursor fit the wire ceiling. Sizing uses the largest possible Postgres LSN
 * plus the longer commit mode before the transaction may commit.
 */
export async function buildPaginatedSyncPullResponse(input: {
  readonly base: SyncResponseBase;
  readonly currentBundle: StoredDocumentContentKeyBundle;
  readonly cursorHmacKey: string | null;
  readonly entries: readonly PullResponseEntry[];
  readonly historyMode?: DocumentSyncRequest["historyMode"];
  readonly identity: PullIdentity;
  readonly loadContentKeyBundle: (
    contentKeyEpoch: number,
  ) => Promise<StoredDocumentContentKeyBundle | null>;
  readonly maxBytes?: number | undefined;
  readonly page: RawPullPage;
  readonly plan: SyncPullPagePlan;
}): Promise<SyncResponseWithoutCommit> {
  const maxBytes = input.maxBytes ?? MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES;
  if (input.currentBundle.contentKeyEpoch !== input.identity.contentKeyEpoch) {
    throw new DocumentMutationError("Document content-key bundle missing", 409);
  }
  const currentBundle = toContentKeyBundleResponse(input.currentBundle);
  const sizingBase = {
    ...input.base,
    commitLsn: MAX_COMMIT_LSN,
    commitLsnMode: "untracked" as const,
    contentKeyBundles: [],
    updates: [],
  };
  const baseBytes = serializedBytes(sizingBase);
  const { contentKeyBundles, pullPage, selectedCount } =
    await selectPullResponsePrefix({
      baseBytes,
      currentBundle,
      cursorHmacKey: input.cursorHmacKey,
      entries: input.entries,
      historyMode: input.historyMode,
      identity: input.identity,
      loadContentKeyBundle: input.loadContentKeyBundle,
      maxBytes,
      page: input.page,
      plan: input.plan,
    });

  if (input.entries.length > 0 && selectedCount === 0) {
    throw new DocumentMutationError(
      "Document update and key bundle exceed the pull page byte ceiling",
      409,
    );
  }
  const selectedEntries = input.entries.slice(0, selectedCount);
  const response = {
    ...input.base,
    contentKeyBundles,
    pullPage,
    updates: selectedEntries.map(({ update }) => update),
  };
  assertSyncPullResponseFits(
    {
      ...response,
      commitLsn: MAX_COMMIT_LSN,
      commitLsnMode: "untracked",
    },
    maxBytes,
  );
  return response;
}
