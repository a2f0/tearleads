import {
  createDocumentHeadLinkSetLoader,
  type DocumentStore,
  deriveStableDocumentId,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import {
  captureContinuityScope,
  type loadContinuityAssets,
  writeContinuityDocument,
} from "app/continuity";
import { loadFolderTree } from "./folderTree";
import { seedLocalId } from "./seedAccount";
import type { CliSession } from "./session";

type SeedDocument = Parameters<typeof writeContinuityDocument>[0]["document"];

/** What every seeded document of one run shares. */
export interface SeedRun {
  readonly session: CliSession;
  readonly rootId: string;
  readonly signingPrivateKey: Uint8Array;
  readonly datasetSha256: string;
  readonly readAttachment: Awaited<
    ReturnType<typeof loadContinuityAssets>
  >["readAttachment"];
  /** Folders a seeded document may already sit in; grows as folders load. */
  readonly folders: Set<string>;
  readonly lookup: ReturnType<typeof createDocumentHeadLinkSetLoader>;
  readonly assertCurrent: () => void;
}

export function createSeedRun(
  session: CliSession,
  input: Omit<SeedRun, "session" | "lookup" | "assertCurrent">,
): SeedRun {
  const { sdk } = session;
  return {
    ...input,
    session,
    lookup: createDocumentHeadLinkSetLoader(
      sdk.containerContents.workflowRuntime(),
    ),
    assertCurrent: captureContinuityScope(sdk).assertCurrent,
  };
}

/** A fixture's stable document ID in this account and dataset version. */
export function seedDocumentIds(run: SeedRun, key: string) {
  const localId = seedLocalId(
    run.signingPrivateKey,
    run.rootId,
    run.datasetSha256,
    key,
  );
  return { localId, documentId: deriveStableDocumentId(localId) };
}

async function findSeedPlacement(run: SeedRun, documentId: string) {
  const { session, folders, assertCurrent } = run;
  const { sdk } = session;
  const head = await run.lookup(documentId, undefined, session.userId);
  if (head === "not-found") {
    session.recordExpectedSeedFailure("missing head");
    return undefined;
  }
  if (
    head?.organizationId === sdk.session.organizationId &&
    !head.linkedContainerIds.some((id) => folders.has(id))
  ) {
    const { nodes } = await loadFolderTree(session);
    for (const node of nodes) {
      if (node.organizationId === head.organizationId) folders.add(node.id);
    }
  }
  const containerId = head?.linkedContainerIds.find((id) => folders.has(id));
  if (
    !containerId ||
    !head?.accessStateHash ||
    head.organizationId !== sdk.session.organizationId
  ) {
    throw new Error("Could not verify seed document placement.");
  }
  assertCurrent();
  // The timestamp belongs only to this run's local discovery record.
  const [summary] = await sdk.containerContents
    .documentQueries()
    .upsertDiscoveredDocuments(
      [
        {
          documentId,
          containerId,
          createdAt: new Date().toISOString(),
          accessEpoch: head.accessEpoch,
          accessStateHash: head.accessStateHash,
          linkedContainerIds: head.linkedContainerIds,
        },
      ],
      assertCurrent,
    );
  if (!summary || summary.documentId !== documentId)
    throw new Error("Could not open the verified seed document.");
  return { localId: summary.id, documentId, containerId };
}

/** Waits until the API holds every local edit of the document. */
export async function confirmDocumentSynced(
  session: CliSession,
  store: DocumentStore,
  documentId: string,
  key: string,
) {
  const coordinator = getOrCreateDomainSyncCoordinator(
    session.sdk.runtime.input().state.domainScope,
  );
  const idle = await coordinator.waitForIdle({ timeoutMs: 120_000 });
  session.assertNoFailures();
  const localId =
    await session.sdk.documents.findLocalIdByDocumentId(documentId);
  if (!localId) throw new Error("Missing synced document.");
  const state = await session.sdk.containerContents
    .documentQueries()
    .loadDocumentSyncState(localId);
  if (
    !idle ||
    store.hasUnsavedLocalEdits() ||
    store.getSnapshot().documentId !== documentId ||
    state?.status !== "synced"
  ) {
    throw new Error(
      `Could not finish syncing ${key}: ${state?.lastError ?? state?.status ?? "unknown"}.`,
    );
  }
}

/**
 * Writes one fixture into `containerId`, or resumes it wherever an earlier
 * run left it, and waits until the API holds it. Returns its store, holding
 * what the API holds, or "purged" when the account permanently deleted it,
 * which the seed then skips.
 */
export async function seedContinuityDocument(
  run: SeedRun,
  document: SeedDocument,
  containerId: string,
): Promise<DocumentStore | "purged"> {
  const { session, assertCurrent } = run;
  const { tracer } = session;
  return tracer.span(`seed ${document.key}`, async () => {
    const ids = seedDocumentIds(run, document.key);
    const documentId = await ids.documentId;
    const existing = await findSeedPlacement(run, documentId);
    assertCurrent();
    const store = await writeContinuityDocument({
      traceAttachment: (event) => tracer.event(`seed ${document.key} ${event}`),
      onRecoveredStaleTarget: () =>
        session.recordExpectedSeedFailure("recovered stale target"),
      onRefusedStaleBind: () =>
        session.recordExpectedSeedFailure("refused stale bind"),
      sdk: session.sdk,
      document,
      containerId: existing?.containerId ?? containerId,
      localId: ids.localId,
      readAttachment: run.readAttachment,
      existing,
    });
    if (store === "purged") {
      session.recordExpectedSeedFailure("verified purge");
      return "purged";
    }
    await tracer.span(`confirm sync ${document.key}`, () =>
      confirmDocumentSynced(session, store, documentId, document.key),
    );
    return store;
  });
}
