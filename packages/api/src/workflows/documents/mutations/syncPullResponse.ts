import { Buffer } from "node:buffer";
import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type {
  DocumentSyncResponse,
  DocumentSyncUpdateResponse,
} from "@symcrypt/validators/response";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES } from "@symcrypt/validators/util";
import {
  getDocumentContentKeyBundle,
  type StoredDocumentContentKeyBundle,
} from "../../../access/read/documentContentKeyStore";
import { selectServedSyncUpdateEntries } from "../../../documents/documentSyncBaselineRedirect";
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

function uniqueContentKeyEpochs(contentKeyEpochs: Iterable<number>): number[] {
  return [...new Set(contentKeyEpochs)].sort((left, right) => left - right);
}

async function listContentKeyBundlesForSyncResponse(input: {
  readonly contentKeyEpochs: Iterable<number>;
  readonly currentBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
}): Promise<StoredDocumentContentKeyBundle[]> {
  const bundleByEpoch = new Map<number, StoredDocumentContentKeyBundle>([
    [input.currentBundle.contentKeyEpoch, input.currentBundle],
  ]);

  for (const contentKeyEpoch of uniqueContentKeyEpochs(
    input.contentKeyEpochs,
  )) {
    if (bundleByEpoch.has(contentKeyEpoch)) continue;
    const bundle = await getDocumentContentKeyBundle(
      input.documentId,
      contentKeyEpoch,
      input.executor,
    );
    if (!bundle) {
      throw new DocumentMutationError(
        "Document content-key bundle missing",
        409,
      );
    }
    bundleByEpoch.set(contentKeyEpoch, bundle);
  }

  return [...bundleByEpoch.values()].sort(
    (left, right) => left.contentKeyEpoch - right.contentKeyEpoch,
  );
}

export async function listMissingSyncUpdatesWithBundles(input: {
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly pullPagePlan: SyncPullPagePlan | null;
  readonly request: DocumentSyncRequest;
}) {
  const missingUpdateResult = await listMissingSyncUpdateEntries({
    documentId: input.documentId,
    executor: input.executor,
    localVersionVector: input.request.localVersionVector,
    minLsn: input.request.minLsn,
    ...(input.pullPagePlan === null ? {} : { pullPage: input.pullPagePlan }),
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
  const servedUpdateEntries = await selectServedSyncUpdateEntries({
    currentContentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId: input.documentId,
    entries: missingUpdateEntries,
    executor: input.executor,
    upperBoundSequence: input.pullPagePlan?.upperBoundSequence,
  });
  const contentKeyBundles = await listContentKeyBundlesForSyncResponse({
    contentKeyEpochs: servedUpdateEntries.map(
      (entry) => entry.writeHeader.contentKeyEpoch,
    ),
    currentBundle: input.contentKeyBundle,
    documentId: input.documentId,
    executor: input.executor,
  });

  return {
    contentKeyBundles,
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

function selectPullResponsePrefix(input: {
  readonly baseBytes: number;
  readonly bundlesByEpoch: ReadonlyMap<number, WireContentKeyBundle>;
  readonly currentBundle: WireContentKeyBundle;
  readonly entries: readonly PullResponseEntry[];
  readonly identity: PullIdentity;
  readonly maxBytes: number;
  readonly page: RawPullPage;
  readonly plan: SyncPullPagePlan;
}) {
  const selectedEpochs = new Set([input.identity.contentKeyEpoch]);
  let bundleArrayDelta = serializedBytes(input.currentBundle);
  let selectedCount = 0;
  let updateArrayDelta = 0;
  let pullPage = createSyncPullPageResponse({
    hasMore: input.page.hasMore,
    identity: input.identity,
    lastUpdateId: input.page.lastUpdateId,
    plan: input.plan,
  });

  for (const [index, entry] of input.entries.entries()) {
    const entryEpoch = entry.writeHeader.contentKeyEpoch;
    const candidateBundle = input.bundlesByEpoch.get(entryEpoch);
    if (!candidateBundle) {
      throw new DocumentMutationError(
        "Document content-key bundle missing",
        409,
      );
    }
    const candidateBundleDelta = selectedEpochs.has(entryEpoch)
      ? bundleArrayDelta
      : bundleArrayDelta + 1 + serializedBytes(candidateBundle);
    const candidateUpdateDelta =
      updateArrayDelta + (index === 0 ? 0 : 1) + serializedBytes(entry.update);
    const candidateCount = index + 1;
    const selectedEveryEntry = candidateCount === input.entries.length;
    const candidatePullPage = createSyncPullPageResponse({
      hasMore: input.page.hasMore || !selectedEveryEntry,
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
    selectedEpochs.add(entryEpoch);
    bundleArrayDelta = candidateBundleDelta;
    selectedCount = candidateCount;
    updateArrayDelta = candidateUpdateDelta;
    pullPage = candidatePullPage;
  }
  return { pullPage, selectedCount };
}

/**
 * Select the longest response prefix whose actual updates, epoch bundles, and
 * cursor fit the wire ceiling. Sizing uses the largest possible Postgres LSN
 * plus the longer commit mode before the transaction may commit.
 */
export function buildPaginatedSyncPullResponse(input: {
  readonly base: SyncResponseBase;
  readonly contentKeyBundles: readonly StoredDocumentContentKeyBundle[];
  readonly entries: readonly PullResponseEntry[];
  readonly identity: PullIdentity;
  readonly maxBytes?: number | undefined;
  readonly page: RawPullPage;
  readonly plan: SyncPullPagePlan;
}): SyncResponseWithoutCommit {
  const maxBytes = input.maxBytes ?? MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES;
  const bundlesByEpoch = new Map(
    input.contentKeyBundles.map((bundle) => [
      bundle.contentKeyEpoch,
      toContentKeyBundleResponse(bundle),
    ]),
  );
  const currentBundle = bundlesByEpoch.get(input.identity.contentKeyEpoch);
  if (!currentBundle) {
    throw new DocumentMutationError("Document content-key bundle missing", 409);
  }
  const sizingBase = {
    ...input.base,
    commitLsn: MAX_COMMIT_LSN,
    commitLsnMode: "untracked" as const,
    contentKeyBundles: [],
    updates: [],
  };
  const baseBytes = serializedBytes(sizingBase);
  const { pullPage, selectedCount } = selectPullResponsePrefix({
    baseBytes,
    bundlesByEpoch,
    currentBundle,
    entries: input.entries,
    identity: input.identity,
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
  const responseEpochs = new Set([
    input.identity.contentKeyEpoch,
    ...selectedEntries.map((entry) => entry.writeHeader.contentKeyEpoch),
  ]);
  const response = {
    ...input.base,
    contentKeyBundles: [...responseEpochs]
      .map((epoch) => bundlesByEpoch.get(epoch))
      .filter((bundle) => bundle !== undefined)
      .sort((left, right) => left.contentKeyEpoch - right.contentKeyEpoch),
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
