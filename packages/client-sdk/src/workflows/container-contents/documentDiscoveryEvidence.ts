import type { DiscoveredDocumentInput } from "../../data/documents/documentSummary";
import type {
  DiscoveredDocumentCandidate,
  DocumentDiscoveryEvidenceStore,
} from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";
import type {
  DocumentHeadLinkSetLoader,
  LocalDocumentAccessEpochLoader,
} from "./documentTombstoneEvidence";
import {
  HEAD_LINK_SET_LOAD_CONCURRENCY,
  HEAD_LINK_SET_LOADS_PER_RUN,
} from "./documentTombstoneEvidence";

async function verifyInput(
  input: DiscoveredDocumentCandidate,
  loadHead: DocumentHeadLinkSetLoader,
  loadLocalEpoch: LocalDocumentAccessEpochLoader,
  store: DocumentDiscoveryEvidenceStore,
): Promise<DiscoveredDocumentInput | null | "unavailable"> {
  const localEpoch = await loadLocalEpoch(input.documentId).catch(
    () => Number.MAX_SAFE_INTEGER,
  );
  const cached = await store.loadHead(input.documentId, input.accessStateHash);
  const minimumEpoch = Math.max(localEpoch, input.accessEpoch);
  const head =
    cached && cached.accessEpoch >= minimumEpoch
      ? cached
      : await loadHead(input.documentId);
  if (!head || head.accessEpoch < Math.max(localEpoch, input.accessEpoch))
    return "unavailable";
  // A stale first lane must not hide a document present in another listed lane.
  const containerId = input.listedContainerIds.find((id) =>
    head.linkedContainerIds.includes(id),
  );
  if (!containerId) return null;
  if (!head.accessStateHash) return "unavailable";
  await store.saveHead(input.documentId, head);
  const { listedContainerIds: _listedContainerIds, ...document } = input;
  return {
    ...document,
    containerId,
    accessEpoch: head.accessEpoch,
    accessStateHash: head.accessStateHash,
    linkedContainerIds: head.linkedContainerIds,
  };
}

/**
 * Persist untrusted candidates before advancing listing watermarks. Each pass
 * checks a bounded batch; unavailable heads back off independently while verified
 * siblings and tombstones still settle. Acknowledgement follows local apply so
 * a crash cannot lose a candidate behind an already advanced listing watermark.
 */
export function createDiscoveredDocumentVerifier(
  loadHead: DocumentHeadLinkSetLoader,
  loadLocalEpoch: LocalDocumentAccessEpochLoader,
  store: DocumentDiscoveryEvidenceStore,
  onPendingDiscovery?: ((delayMs: number) => void) | undefined,
): DiscoverContainerDocumentsOptions["verifyDiscoveredDocuments"] {
  return async (inputs, containerIds, generation) => {
    await store.stage(inputs, generation);
    const candidates = await store.pending(
      containerIds,
      HEAD_LINK_SET_LOADS_PER_RUN,
    );
    const verified = new Map<string, DiscoveredDocumentInput>();
    const settled: DiscoveredDocumentCandidate[] = [];
    let next = 0;
    const worker = async () => {
      while (next < candidates.length) {
        const input = candidates[next++];
        if (!input) break;
        const result = await verifyInput(
          input,
          loadHead,
          loadLocalEpoch,
          store,
        );
        if (result === "unavailable") {
          await store.defer(input);
        } else {
          if (result) verified.set(result.documentId, result);
          settled.push(input);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(HEAD_LINK_SET_LOAD_CONCURRENCY, candidates.length) },
        worker,
      ),
    );
    return {
      inputs: [...verified.values()],
      commit: async () => {
        await store.acknowledge(settled);
        const retryDelay = await store.retryDelay(containerIds);
        if (retryDelay !== null) onPendingDiscovery?.(retryDelay);
        return retryDelay === null;
      },
    };
  };
}
