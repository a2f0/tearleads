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

export async function saveAppliedContainerDocumentWatermark(input: {
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

/**
 * Verifies and applies one container's completed listing under a discovery
 * generation captured before the listing request, then advances its
 * watermark. Returns `null` when nothing was applied.
 */
export async function applyListedContainerDocuments(
  options: ContainerDocumentDiscoveryLane,
  generation: number,
  listedDocuments: ListedContainerDocuments,
): Promise<ReadonlyArray<DocumentSummary> | null> {
  const { containerId, upsertDiscoveredDocuments } = options;
  await options.cacheReferencedPrincipalPolicies?.(
    dedupeReferencedPrincipalStates(
      listedDocuments.items.flatMap(
        (document) => document.referencedPrincipals,
      ),
    ),
  );

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
    getApplicableDocumentTombstones(listedDocuments),
  );
  if (!(await verification.isCurrent())) return null;
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
    tombstones: getApplicableDocumentTombstones(listedDocuments),
  });

  const complete = await verification.commit();
  if (!(await verification.isCurrent())) return null;
  await saveAppliedContainerDocumentWatermark({
    containerId,
    listedDocuments,
    saveContainerDocumentWatermark: options.saveContainerDocumentWatermark,
    stillCurrent: verification.isCurrent,
  });
  if (!(await verification.isCurrent())) return null;

  if (listedDocuments.isFullListing) {
    // Initial probes consume ids as discovery hints and verify their own heads.
    options.onFullListing?.(
      listedDocuments.items.map((document) => document.id),
    );
  }

  return !complete &&
    discoveredDocuments.length === 0 &&
    tombstoneDocumentSummaries.length === 0
    ? null
    : [...discoveredDocuments, ...tombstoneDocumentSummaries];
}
