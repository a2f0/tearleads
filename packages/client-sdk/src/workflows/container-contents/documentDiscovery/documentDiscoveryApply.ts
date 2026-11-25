import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { dedupeReferencedPrincipalStates } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import { withoutDeferredDocumentLinks } from "../documentLinks/deferredDocumentLinks";
import { settleContainerDocumentTombstones } from "../tombstones/documentTombstoneGate";
import { getApplicableDocumentTombstones } from "./documentDiscoveryInputs";
import type {
  DiscoverContainerDocumentsOptions,
  ListedContainerDocuments,
} from "./documentDiscoveryTypes";

/** A discovery lane's local stores; the listing itself is supplied by the caller. */
export type ContainerDocumentDiscoveryLane = Omit<
  DiscoverContainerDocumentsOptions,
  | "beginDocumentDiscovery"
  | "listContainerDocumentLanes"
  | "loadContainerDocumentWatermark"
>;

async function saveAppliedContainerDocumentWatermark(input: {
  containerId: string;
  listedDocuments: ListedContainerDocuments;
  saveContainerDocumentWatermark: DiscoverContainerDocumentsOptions["saveContainerDocumentWatermark"];
  stillCurrent: () => Promise<boolean>;
}) {
  const { containerId, listedDocuments, saveContainerDocumentWatermark } =
    input;
  if (!listedDocuments.nextWatermark) {
    return;
  }

  await saveContainerDocumentWatermark(
    containerId,
    listedDocuments.nextWatermark,
    input.stillCurrent,
  );
}

/** What applying one lane's listing did. */
export type ListedContainerDocumentsApply =
  | {
      /** `null` when the listing held nothing new. */
      readonly documents: ReadonlyArray<DocumentSummary> | null;
      readonly status: "applied";
    }
  /**
   * A reset, an access change or a pause cancelled the apply. Its watermark
   * may not have moved, so the lane was not listed.
   */
  | { readonly status: "superseded" };

const SUPERSEDED: ListedContainerDocumentsApply = { status: "superseded" };

/**
 * Verifies and applies one container's completed listing under a discovery
 * generation captured before the listing request, then advances its
 * watermark.
 */
export async function applyListedContainerDocuments(
  options: ContainerDocumentDiscoveryLane,
  generation: number,
  listedDocuments: ListedContainerDocuments,
): Promise<ListedContainerDocumentsApply> {
  const { containerId, upsertDiscoveredDocuments } = options;
  await options.cacheReferencedPrincipalPolicies?.(
    dedupeReferencedPrincipalStates(
      listedDocuments.items.flatMap(
        (document) => document.referencedPrincipals,
      ),
    ),
  );

  const tombstones = getApplicableDocumentTombstones(listedDocuments);
  const verification = await options.verifyDiscoveredDocuments(
    listedDocuments.items.map((document) => ({
      accessEpoch: document.currentAccessEpoch,
      accessStateHash: document.currentAccessStateHash,
      containerId,
      listedContainerIds: [containerId],
      createdAt: document.createdAt,
      documentId: document.id,
      effectiveAccessLevel: document.effectiveAccessLevel,
      linkedContainerIds: document.linkedContainerIds,
    })),
    [containerId],
    generation,
    tombstones,
    new Set(tombstones.map((row) => row.documentId)),
  );
  if (!(await verification.isCurrent())) return SUPERSEDED;
  // Every listed row is checked, verified or not: the debt names the server
  // document, and the watermark below passes all of them. It is checked
  // before the rows are applied: applying a row whose access epoch moved
  // drops the key bundle its record held, which would hide that move.
  const owedDocumentIds = await options.oweListedDocumentReads(
    listedDocuments.items.map((document) => ({
      accessStateHash: document.currentAccessStateHash,
      documentId: document.id,
      updateCount: document.updateCount,
    })),
    verification.isCurrent,
  );
  if (!(await verification.isCurrent())) return SUPERSEDED;
  const verifiedInputs = verification.inputs;
  const discoveredDocuments = verifiedInputs.length
    ? await upsertDiscoveredDocuments(verifiedInputs, verification.isCurrent)
    : [];

  if (verifiedInputs.length)
    await options.replaceDocumentLinksBatch(
      await withoutDeferredDocumentLinks(
        verifiedInputs.map((document) => ({
          documentId: document.documentId,
          accessEpoch: document.accessEpoch,
          containerIds: document.linkedContainerIds,
        })),
        discoveredDocuments,
      ),
      verification.isCurrent,
    );

  const tombstoneDocumentSummaries = await settleContainerDocumentTombstones({
    containerIds: [containerId],
    store: options,
    isCurrent: verification.isCurrent,
    tombstones,
  });

  const complete = await verification.commit();
  if (!(await verification.isCurrent())) return SUPERSEDED;
  if (owedDocumentIds.length > 0) {
    options.onDocumentReadsOwed?.(owedDocumentIds);
  }
  await saveAppliedContainerDocumentWatermark({
    containerId,
    listedDocuments,
    saveContainerDocumentWatermark: options.saveContainerDocumentWatermark,
    stillCurrent: verification.isCurrent,
  });
  if (!(await verification.isCurrent())) return SUPERSEDED;

  if (listedDocuments.isFullListing) {
    // Initial probes consume ids as discovery hints and verify their own heads.
    options.onFullListing?.(
      listedDocuments.items.map((document) => document.id),
    );
  }

  return {
    documents:
      !complete &&
      discoveredDocuments.length === 0 &&
      tombstoneDocumentSummaries.length === 0
        ? null
        : [...discoveredDocuments, ...tombstoneDocumentSummaries],
    status: "applied",
  };
}
