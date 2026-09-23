import type { DiscoveredDocumentInput } from "../../data/documents/documentSummary";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";
import type {
  DocumentHeadLinkSetLoader,
  LocalDocumentAccessEpochLoader,
} from "./documentTombstoneEvidence";

async function verifyInput(
  input: DiscoveredDocumentInput,
  loadHead: DocumentHeadLinkSetLoader,
  loadLocalEpoch: LocalDocumentAccessEpochLoader,
): Promise<DiscoveredDocumentInput | null | "unavailable"> {
  const head = await loadHead(input.documentId);
  const localEpoch = await loadLocalEpoch(input.documentId).catch(
    () => Number.MAX_SAFE_INTEGER,
  );
  if (!head || head.accessEpoch < Math.max(localEpoch, input.accessEpoch)) {
    return "unavailable";
  }
  if (!head.linkedContainerIds.includes(input.containerId)) return null;
  if (!head.accessStateHash) return "unavailable";
  return {
    ...input,
    accessEpoch: head.accessEpoch,
    accessStateHash: head.accessStateHash,
    linkedContainerIds: head.linkedContainerIds,
  };
}

/**
 * Listings discover ids, not authoritative placement. Fetch each signed head
 * before replacing links or choosing a primary. A missing/lagging head retries
 * the listing without advancing its watermark; unlinked stale items are ignored.
 */
export function createDiscoveredDocumentVerifier(
  loadHead: DocumentHeadLinkSetLoader,
  loadLocalEpoch: LocalDocumentAccessEpochLoader,
): DiscoverContainerDocumentsOptions["verifyDiscoveredDocuments"] {
  return async (inputs) => {
    const verified: Array<DiscoveredDocumentInput | null> = inputs.map(
      () => null,
    );
    let next = 0;
    let unavailable = false;
    const worker = async () => {
      while (next < inputs.length && !unavailable) {
        const index = next++;
        const input = inputs[index];
        if (!input) break;
        const result = await verifyInput(input, loadHead, loadLocalEpoch);
        if (result === "unavailable") {
          unavailable = true;
          return;
        }
        verified[index] = result;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, inputs.length) }, worker),
    );
    return unavailable ? null : verified.filter((input) => input !== null);
  };
}
