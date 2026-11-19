import { createHmac } from "node:crypto";
import {
  createDocumentHeadLinkSetLoader,
  deriveStableDocumentId,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  continuityDocuments,
  ensureContactsContainer,
  loadContinuityAssets,
  writeContinuityDocument,
} from "app/continuity";
import type { CommandInput } from "../cliContext";
import { loadFolderTree } from "../folderTree";
import type { CliSession } from "../session";
import { withSavedSession } from "./account";

async function resolveSeedAccount(
  session: CliSession,
  organizationId: string | undefined,
) {
  const { sdk } = session;
  if (
    organizationId !== undefined &&
    organizationId !== sdk.session.defaultOrganizationId
  ) {
    throw new Error(
      "Seed requires the signed-in account's personal organization.",
    );
  }
  const { memberships, nodes } = await loadFolderTree(session);
  const org = memberships.find((m) => m.isPersonalOrganizationOwner);
  if (!org || org.organizationId !== sdk.session.organizationId) {
    throw new Error(
      "Seed requires the signed-in account's personal organization.",
    );
  }
  const rootId = sdk.runtime.input().auth.rootContainerId;
  const root = nodes.find(
    (node) =>
      node.id === rootId &&
      node.organizationId === org.organizationId &&
      node.parentId === null,
  );
  const keys = sdk.identity.signingKeyPair;
  if (!root || !keys)
    throw new Error(
      "Could not resolve the account's root and signing identity.",
    );
  return {
    rootId: root.id,
    signingPrivateKey: keys.signingPrivateKey,
    folders: nodes
      .filter((node) => node.organizationId === org.organizationId)
      .map((node) => node.id),
  };
}

async function findSeedPlacement(
  session: CliSession,
  documentId: string,
  folders: Set<string>,
  lookup: ReturnType<typeof createDocumentHeadLinkSetLoader>,
) {
  const { sdk } = session;
  const head = await lookup(documentId);
  if (head === "not-found") return undefined;
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
  // The timestamp belongs only to this run's local discovery record.
  const [summary] = await sdk.containerContents
    .documentQueries()
    .upsertDiscoveredDocuments([
      {
        documentId,
        containerId,
        createdAt: new Date().toISOString(),
        accessEpoch: head.accessEpoch,
        accessStateHash: head.accessStateHash,
        linkedContainerIds: head.linkedContainerIds,
      },
    ]);
  if (!summary || summary.documentId !== documentId)
    throw new Error("Could not open the verified seed document.");
  return { localId: summary.id, documentId, containerId };
}

async function confirmSeedSync(
  session: CliSession,
  store: Awaited<ReturnType<typeof writeContinuityDocument>>,
  documentId: string,
  key: string,
  missingHeads: number,
) {
  const coordinator = getOrCreateDomainSyncCoordinator(
    session.sdk.runtime.input().state.domainScope,
  );
  const idle = await coordinator.waitForIdle({ timeoutMs: 120_000 });
  session.assertNoFailures(missingHeads);
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

/** Import the pinned screenshot dataset into the signed-in personal root. */
export async function seed(input: CommandInput): Promise<void> {
  const count = await withSavedSession(
    input,
    async (session) => {
      const { sdk, tracer } = session;
      const { rootId, signingPrivateKey, folders } = await resolveSeedAccount(
        session,
        input.organizationId,
      );
      const { spec, datasetSha256, readAttachment } =
        await loadContinuityAssets();
      const documents = continuityDocuments(spec);
      const contactsId = await ensureContactsContainer(sdk, signingPrivateKey);
      const accessibleFolders = new Set([...folders, contactsId]);
      const lookup = createDocumentHeadLinkSetLoader(
        sdk.containerContents.workflowRuntime(),
      );
      let missingHeads = 0;
      for (const document of documents) {
        await tracer.span(`seed ${document.key}`, async () => {
          const containerId = document.kind === "contact" ? contactsId : rootId;
          const localId = createHmac("sha256", signingPrivateKey)
            .update(
              `tearleads.continuity/${rootId}/${datasetSha256}/${document.key}`,
            )
            .digest("hex");
          const documentId = await deriveStableDocumentId(localId);
          const existing = await findSeedPlacement(
            session,
            documentId,
            accessibleFolders,
            lookup,
          );
          if (!existing) missingHeads++;
          const store = await writeContinuityDocument({
            destination: "account",
            sdk,
            document,
            containerId: existing?.containerId ?? containerId,
            localId,
            readAttachment,
            existing,
          });
          await confirmSeedSync(
            session,
            store,
            documentId,
            document.key,
            missingHeads,
          );
        });
      }
      return documents.length;
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  input.context.stdout(
    `Synced ${count} Continuity documents to your ${input.target} account.`,
  );
}
