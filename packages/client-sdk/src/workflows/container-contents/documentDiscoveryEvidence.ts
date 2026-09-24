import type { DiscoveredDocumentInput } from "../../data/documents/documentSummary";
import type {
  DiscoveredDocumentCandidate,
  DocumentDiscoveryEvidenceStore,
} from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { groupPendingDocumentDiscoveries } from "./documentDiscoveryCandidates";
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
  generation: number,
): Promise<DiscoveredDocumentInput | null | "unavailable"> {
  const localEpoch = await loadLocalEpoch(input.documentId).catch(
    () => Number.MAX_SAFE_INTEGER,
  );
  const cached = await store.loadHead(input.documentId, input.accessStateHash);
  const minimumEpoch = Math.max(localEpoch, input.accessEpoch);
  const head =
    cached && cached.accessEpoch >= minimumEpoch
      ? cached
      : await loadHead(
          input.documentId,
          input.accessEpoch >= localEpoch
            ? (input.accessStateHash ?? undefined)
            : undefined,
        );
  if (head === "not-found") return null;
  if (!head || head.accessEpoch < Math.max(localEpoch, input.accessEpoch))
    return "unavailable";
  // A stale first lane must not hide a document present in another listed lane.
  const containerId = input.listedContainerIds.find((id) =>
    head.linkedContainerIds.includes(id),
  );
  if (!containerId) {
    // A same-epoch head can predate a link addition. Only the named head or
    // terminal signed purge evidence can settle a candidate without a retry.
    return head.accessEpoch > input.accessEpoch ||
      head.accessStateHash === input.accessStateHash ||
      (!head.accessStateHash && head.accessEpoch === Number.MAX_SAFE_INTEGER)
      ? null
      : "unavailable";
  }
  if (!head.accessStateHash) return "unavailable";
  if (!(await store.saveHead(input.documentId, head, generation)))
    return "unavailable";
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
  return async (inputs, containerIds, generation, tombstones = []) => {
    const isCurrent = () => store.isCurrent(generation);
    const lanes = new Set(containerIds);
    const removed = tombstones.filter((row) => lanes.has(row.containerId));
    if (!(await store.stage(inputs, generation, removed)))
      return { inputs: [], isCurrent, commit: async () => true };
    const candidates = groupPendingDocumentDiscoveries(
      await store.pending(containerIds, HEAD_LINK_SET_LOADS_PER_RUN),
    );
    const verified = new Map<string, DiscoveredDocumentInput>();
    const settled: DiscoveredDocumentCandidate[] = [];
    let next = 0;
    const worker = async () => {
      while (next < candidates.length) {
        const group = candidates[next++];
        if (!group) break;
        const { input, rows } = group;
        const result = await verifyInput(
          input,
          loadHead,
          loadLocalEpoch,
          store,
          generation,
        );
        if (result === "unavailable") {
          await Promise.all(rows.map((row) => store.defer(row, generation)));
        } else {
          if (result) verified.set(result.documentId, result);
          settled.push(...rows);
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
      isCurrent,
      commit: async () => {
        await store.acknowledge(settled, generation);
        const retryDelay = await store.retryDelay(containerIds);
        if (retryDelay !== null) onPendingDiscovery?.(retryDelay);
        return retryDelay === null;
      },
    };
  };
}
