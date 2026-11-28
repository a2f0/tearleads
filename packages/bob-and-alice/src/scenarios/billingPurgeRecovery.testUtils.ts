import { expect } from "bun:test";
import { PurgedOrganizationRecoveryBillingRequiredError } from "@tearleads/client-sdk";
import type { Device } from "../harness/device";
import { until } from "../harness/until";
import type { Folder, SharedDocument, User, World } from "../harness/world";

/** Runs the full billing-purge replacement flow, starting a trial when required. */
async function recoverPersonalOrganization(
  device: Device,
  purgedOrganizationId: string,
) {
  const firstAttempt = await device.sdk.session
    .recoverPurgedOrganization(purgedOrganizationId)
    .then(
      (result) => ({ kind: "recovered" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
  if (firstAttempt.kind === "recovered") {
    throw new Error("Expected billing-required error before starting a trial");
  }
  if (
    !(
      firstAttempt.error instanceof
      PurgedOrganizationRecoveryBillingRequiredError
    )
  ) {
    throw new Error("Expected PurgedOrganizationRecoveryBillingRequiredError");
  }
  const billingError = firstAttempt.error;
  const trial = await device.sdk.organizations.startTrial(
    billingError.replacementOrganizationId,
  );
  expect(trial?.status).toBe("trialing");

  const recovered =
    await device.sdk.session.recoverPurgedOrganization(purgedOrganizationId);
  if (!recovered) throw device.failure("purged organization recovery failed");
  expect(recovered.organizationId).toBe(billingError.replacementOrganizationId);
  expect(recovered.replacedOrganizationId).toBe(purgedOrganizationId);
  return recovered;
}

interface WsFrame {
  readonly declarationId?: unknown;
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

function isWsFrame(value: unknown): value is WsFrame {
  return typeof value === "object" && value !== null;
}

/** Connects a real server-events WebSocket and forwards document hints to `store`. */
export async function connectDocumentRealtime(input: {
  readonly device: Device;
  readonly folderId: string;
  readonly store: {
    updateRuntime: (
      runtime: ReturnType<Device["sdk"]["documents"]["workflowRuntime"]>,
    ) => void;
  };
}) {
  const ticket = await input.device.sdk.requestWebSocketTicket();
  if (!ticket) throw input.device.failure("could not mint a WebSocket ticket");
  const ws = input.device.sdk.openServerEventsSocket(
    `${input.device.apiOrigin.replace(/^http/u, "ws")}/events`,
    ticket,
  );
  const frames: WsFrame[] = [];
  let nextEventId = 1;
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const parsed: unknown = JSON.parse(event.data);
    if (!isWsFrame(parsed)) return;
    const frame = parsed;
    frames.push(frame);
    if (
      frame.type === "document_update_created" ||
      frame.type === "document_mutation_created"
    ) {
      input.device.sdk.events.push({ ...frame, id: String(nextEventId++) });
      input.store.updateRuntime(
        input.device.sdk.documents.workflowRuntime(input.folderId),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WS failed to open")), {
      once: true,
    });
  });
  const declarationId = crypto.randomUUID();
  ws.send(
    JSON.stringify({
      containerIds: [input.folderId],
      declarationId,
      type: "known_containers",
    }),
  );
  await until(
    () =>
      frames.some(
        (frame) =>
          frame.type === "known_containers_ack" &&
          frame.declarationId === declarationId,
      ),
    `${input.device.label} known_containers_ack`,
  );
  input.device.sdk.events.setConnected(true);
  input.store.updateRuntime(
    input.device.sdk.documents.workflowRuntime(input.folderId),
  );
  return { close: () => ws.close(), frames };
}

/** Recovers `staleOwner` after a purge and waits for `document` to republish. */
export async function recoverAndRepublishDocument(input: {
  readonly document: SharedDocument;
  readonly expectedSeedText: string;
  readonly folder: Folder;
  readonly oldOrgId: string;
  readonly owner: User;
  readonly staleDocLocalId: string;
  readonly staleOwner: Device;
  readonly world: World;
}) {
  input.staleOwner.setOnline(true);
  const recovered = await recoverPersonalOrganization(
    input.staleOwner,
    input.oldOrgId,
  );
  const ownerDevice = await input.world.reloadDevice(
    input.owner,
    input.staleOwner,
  );
  const recoveredTree = await ownerDevice.tree();
  await recoveredTree.refresh();
  recoveredTree.requestSync();
  await ownerDevice.idle();

  const recoveredDocStore = ownerDevice.sdk.documents.open({
    containerId: input.folder.id,
    localId: input.staleDocLocalId,
  });
  await recoveredDocStore.ensureInitialized();
  await recoveredDocStore.requestRemoteSyncAndWait(
    new AbortController().signal,
  );
  await ownerDevice.idle();
  await until(
    async () =>
      recoveredDocStore.getSnapshot().documentId ===
        input.document.documentId &&
      !(
        await ownerDevice.sdk.containerContents
          .documentQueries()
          .listPendingWrites()
      ).some(
        (item) =>
          item.localId === input.staleDocLocalId ||
          item.remoteId === input.document.documentId,
      ),
    "recovered folder and document to republish",
  );
  expect(recoveredDocStore.getSnapshot().text).toBe(input.expectedSeedText);
  return { ownerDevice, recovered, recoveredDocStore };
}
