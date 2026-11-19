import { createHmac } from "node:crypto";
import {
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

// The SDK verifies a bounded batch of document heads on each discovery pass.
// A null result means the listing or its evidence could not be verified.
async function discoverSeedDestination(
  session: CliSession,
  containerId: string,
) {
  for (;;) {
    const applied =
      await session.sdk.containerContents.discoverContainerDocuments(
        containerId,
      );
    session.assertNoFailures();
    if (!applied)
      throw new Error(
        "Could not verify existing documents in the seed destination.",
      );
    if (applied.length === 0) return;
  }
}

async function findSeedPlacement({ sdk }: CliSession, documentId: string) {
  const localId = await sdk.documents.findLocalIdByDocumentId(documentId);
  if (!localId) return undefined;
  const summary = await sdk.containerContents
    .documentQueries()
    .loadDocumentSummary(localId);
  if (!summary?.containerId)
    throw new Error("Could not verify seed document placement.");
  return { localId, documentId, containerId: summary.containerId };
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
      for (const containerId of new Set([...folders, contactsId])) {
        await discoverSeedDestination(session, containerId);
      }
      const queries = sdk.containerContents.documentQueries();
      const coordinator = getOrCreateDomainSyncCoordinator(
        sdk.runtime.input().state.domainScope,
      );
      for (const document of documents) {
        await tracer.span(`seed ${document.key}`, async () => {
          const containerId = document.kind === "contact" ? contactsId : rootId;
          const localId = createHmac("sha256", signingPrivateKey)
            .update(
              `tearleads.continuity/${containerId}/${datasetSha256}/${document.key}`,
            )
            .digest("hex");
          const documentId = await deriveStableDocumentId(localId);
          const existing = await findSeedPlacement(session, documentId);
          const store = await writeContinuityDocument({
            destination: "account",
            sdk,
            document,
            containerId: existing?.containerId ?? containerId,
            localId,
            readAttachment,
            existing,
          });
          store.requestSync();
          const idle = await coordinator.waitForIdle({ timeoutMs: 120_000 });
          session.assertNoFailures();
          const state = await queries.loadDocumentSyncState(
            existing?.localId ?? localId,
          );
          if (
            !idle ||
            store.hasUnsavedLocalEdits() ||
            store.getSnapshot().documentId !== documentId ||
            state?.status !== "synced"
          ) {
            throw new Error(
              `Could not finish syncing ${document.key}: ${state?.lastError ?? state?.status ?? "unknown"}.`,
            );
          }
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
