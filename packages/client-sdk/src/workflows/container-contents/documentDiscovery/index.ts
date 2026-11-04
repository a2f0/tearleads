import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { dedupeReferencedPrincipalStates } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import { withoutDeferredDocumentLinks } from "../documentLinks/deferredDocumentLinks";
import { settleContainerDocumentTombstones } from "../tombstones/documentTombstoneGate";
import { listContainerDocumentsFromWatermarks } from "./containerDocumentListing";
import { saveAppliedContainerDocumentWatermark } from "./documentDiscoveryApply";
import {
  collectApplicableDocumentTombstones,
  collectDiscoveredDocumentInputs,
} from "./documentDiscoveryInputs";
import { discoverContainerDocumentLanes } from "./documentDiscoveryLanes";
import type {
  DiscoverAllContainerDocumentsOptions,
  DiscoverContainerDocumentsOptions,
  ListedContainerDocumentsLane,
} from "./documentDiscoveryTypes";

export async function discoverContainerDocuments({
  beginDocumentDiscovery,
  listContainerDocumentLanes,
  loadContainerDocumentWatermark,
  ...lane
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const [outcome] = await discoverContainerDocumentLanes({
    generation: await beginDocumentDiscovery(),
    lanes: [lane],
    listContainerDocumentLanes,
    loadContainerDocumentWatermark,
  });
  if (outcome?.status === "rejected") throw outcome.reason;
  return outcome?.value ?? null;
}

async function listDiscoveryLanes(
  input: Parameters<typeof listContainerDocumentsFromWatermarks>[0],
): Promise<ListedContainerDocumentsLane[]> {
  const listed = await listContainerDocumentsFromWatermarks(input);
  return input.containerIds.map((containerId) => ({
    containerId,
    listedDocuments: listed.get(containerId) ?? null,
  }));
}

async function saveListedWatermarks(
  lanes: readonly ListedContainerDocumentsLane[],
  saveContainerDocumentWatermark: DiscoverContainerDocumentsOptions["saveContainerDocumentWatermark"],
  stillCurrent: () => Promise<boolean>,
): Promise<void> {
  await Promise.all(
    lanes.map(({ containerId, listedDocuments }) =>
      listedDocuments
        ? saveAppliedContainerDocumentWatermark({
            containerId,
            listedDocuments,
            saveContainerDocumentWatermark,
            stillCurrent,
          })
        : undefined,
    ),
  );
}

export async function discoverAllContainerDocuments(
  options: DiscoverAllContainerDocumentsOptions,
): Promise<ReadonlyArray<DocumentSummary> | null> {
  const {
    cacheReferencedPrincipalPolicies,
    containerIds,
    loadContainerDocumentWatermark,
    listContainerDocumentLanes,
    replaceDocumentLinksBatch,
    saveContainerDocumentWatermark,
    upsertDiscoveredDocuments,
  } = options;
  const uniqueContainerIds = Array.from(new Set(containerIds)).filter(
    (containerId): containerId is string =>
      typeof containerId === "string" && containerId.length > 0,
  );
  const generation = await options.beginDocumentDiscovery();
  const listedDocumentsByContainer = await listDiscoveryLanes({
    containerIds: uniqueContainerIds,
    listContainerDocumentLanes,
    loadContainerDocumentWatermark,
  });
  await cacheReferencedPrincipalPolicies?.(
    dedupeReferencedPrincipalStates(
      listedDocumentsByContainer.flatMap(
        ({ listedDocuments }) =>
          listedDocuments?.items.flatMap(
            (document) => document.referencedPrincipals,
          ) ?? [],
      ),
    ),
  );
  const verification = await options.verifyDiscoveredDocuments(
    collectDiscoveredDocumentInputs(listedDocumentsByContainer),
    uniqueContainerIds,
    generation,
    collectApplicableDocumentTombstones(listedDocumentsByContainer),
  );
  if (!(await verification.isCurrent())) return null;
  const discoveredDocumentInputs = verification.inputs;
  const discoveredDocuments =
    discoveredDocumentInputs.length === 0
      ? []
      : await upsertDiscoveredDocuments(
          discoveredDocumentInputs,
          verification.isCurrent,
        );

  if (discoveredDocumentInputs.length > 0) {
    await replaceDocumentLinksBatch(
      await withoutDeferredDocumentLinks(
        discoveredDocumentInputs.map((input) => ({
          documentId: input.documentId,
          accessEpoch: input.accessEpoch,
          containerIds: input.linkedContainerIds,
        })),
        discoveredDocuments,
      ),
      verification.isCurrent,
    );
  }

  const tombstoneDocumentSummaries = await settleContainerDocumentTombstones({
    containerIds: listedDocumentsByContainer.flatMap(
      ({ containerId, listedDocuments }) =>
        listedDocuments ? [containerId] : [],
    ),
    store: options,
    tombstones: collectApplicableDocumentTombstones(listedDocumentsByContainer),
  });

  const complete = await verification.commit();
  if (!(await verification.isCurrent())) return null;

  await saveListedWatermarks(
    listedDocumentsByContainer,
    saveContainerDocumentWatermark,
    verification.isCurrent,
  );
  if (!(await verification.isCurrent())) return null;

  return !complete &&
    discoveredDocuments.length === 0 &&
    tombstoneDocumentSummaries.length === 0
    ? null
    : [...discoveredDocuments, ...tombstoneDocumentSummaries];
}
