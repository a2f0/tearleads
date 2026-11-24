import {
  createDocumentHeadLinkSetLoader,
  deriveStableDocumentId,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  captureContinuityScope,
  continuityDocuments,
  continuityGroups,
  ensureContactsContainer,
  loadContinuityAssets,
  writeContinuityDocument,
} from "app/continuity";
import type { CommandInput } from "../cliContext";
import { loadFolderTree } from "../folderTree";
import { resolveSeedAccount, seedLocalId } from "../seedAccount";
import { seedRoster } from "../seedRoster";
import type { CliSession } from "../session";
import { apiBaseUrl, apiLabel, withSavedSession } from "./account";

async function findSeedPlacement(
  session: CliSession,
  documentId: string,
  folders: Set<string>,
  lookup: ReturnType<typeof createDocumentHeadLinkSetLoader>,
  assertCurrent: () => void,
) {
  const { sdk } = session;
  const head = await lookup(documentId, undefined, session.userId);
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

async function confirmSeedSync(
  session: CliSession,
  store: Exclude<Awaited<ReturnType<typeof writeContinuityDocument>>, "purged">,
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

/** Runs `--roster` after the documents synced; null when not requested. */
function seedRequestedRoster(
  input: CommandInput,
  session: CliSession,
  spec: Awaited<ReturnType<typeof loadContinuityAssets>>["spec"],
  signingPrivateKey: Uint8Array,
) {
  if (!input.roster) return null;
  return session.tracer.span("seed roster", () =>
    seedRoster(session, {
      apiBaseUrl: apiBaseUrl(input),
      groups: continuityGroups(spec),
      signingPrivateKey,
    }),
  );
}

function reportSeed(
  input: CommandInput,
  count: {
    readonly purged: number;
    readonly roster: Awaited<ReturnType<typeof seedRoster>> | null;
    readonly synced: number;
  },
) {
  input.context.stdout(
    `Synced ${count.synced} Continuity documents to your ${apiLabel(input)} account.${count.purged ? ` Skipped ${count.purged} permanently deleted.` : ""}`,
  );
  if (count.roster) {
    input.context.stdout(
      `Seeded ${count.roster.members} roster members in ${count.roster.groups} ${count.roster.groups === 1 ? "group" : "groups"}.`,
    );
  }
}

/** Import the pinned screenshot dataset into the signed-in personal root. */
export async function seed(input: CommandInput): Promise<void> {
  const count = await withSavedSession(
    input,
    async (session) => {
      const { sdk, tracer } = session;
      const { assertCurrent } = captureContinuityScope(sdk);
      const { rootId, signingPrivateKey, folders } = await resolveSeedAccount(
        session,
        input.organizationId,
      );
      const { spec, datasetSha256, readAttachment } =
        await loadContinuityAssets();
      const documents = continuityDocuments(spec);
      assertCurrent();
      const contactsId = await ensureContactsContainer(sdk);
      const accessibleFolders = new Set([
        ...folders.map((node) => node.id),
        contactsId,
      ]);
      const lookup = createDocumentHeadLinkSetLoader(
        sdk.containerContents.workflowRuntime(),
      );
      let purged = 0;
      for (const document of documents) {
        await tracer.span(`seed ${document.key}`, async () => {
          const containerId = document.kind === "contact" ? contactsId : rootId;
          const localId = seedLocalId(
            signingPrivateKey,
            rootId,
            datasetSha256,
            document.key,
          );
          const documentId = await deriveStableDocumentId(localId);
          const existing = await findSeedPlacement(
            session,
            documentId,
            accessibleFolders,
            lookup,
            assertCurrent,
          );
          assertCurrent();
          const store = await writeContinuityDocument({
            traceAttachment: (event) =>
              tracer.event(`seed ${document.key} ${event}`),
            onRecoveredStaleTarget: () =>
              session.recordExpectedSeedFailure("recovered stale target"),
            onRefusedStaleBind: () =>
              session.recordExpectedSeedFailure("refused stale bind"),
            sdk,
            document,
            containerId: existing?.containerId ?? containerId,
            localId,
            readAttachment,
            existing,
          });
          if (store === "purged") {
            session.recordExpectedSeedFailure("verified purge");
            purged++;
            return;
          }
          await tracer.span(`confirm sync ${document.key}`, () =>
            confirmSeedSync(session, store, documentId, document.key),
          );
        });
      }
      assertCurrent();
      session.assertNoFailures();
      const roster = await seedRequestedRoster(
        input,
        session,
        spec,
        signingPrivateKey,
      );
      return { synced: documents.length - purged, purged, roster };
    },
    {
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      automaticSessionRenewal: false,
    },
  );
  reportSeed(input, count);
}
