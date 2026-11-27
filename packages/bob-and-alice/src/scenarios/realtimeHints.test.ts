import { afterEach, expect, test } from "bun:test";
import type { Device } from "../harness/device";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

interface WsFrame {
  readonly type?: unknown;
  readonly declarationId?: unknown;
  readonly containerIds?: unknown;
  readonly containerId?: unknown;
  readonly documentId?: unknown;
}

function parseWsFrame(raw: unknown): WsFrame | null {
  const parsed: unknown = JSON.parse(String(raw));
  return typeof parsed === "object" && parsed !== null
    ? (parsed as WsFrame)
    : null;
}

/**
 * Opens a real authenticated server-events WebSocket for `device` through the
 * SDK's public `requestWebSocketTicket` + `openServerEventsSocket` surface.
 */
async function connectRealtime(
  device: Device,
  onFrame?: (frame: WsFrame) => void,
) {
  const ticket = await device.sdk.requestWebSocketTicket();
  if (!ticket) throw device.failure("could not mint a WebSocket ticket");
  const wsOrigin = `${device.apiOrigin.replace(/^http/u, "ws")}/events`;
  const ws = device.sdk.openServerEventsSocket(wsOrigin, ticket);
  const frames: WsFrame[] = [];
  let closed: { readonly code: number; readonly reason: string } | null = null;
  ws.addEventListener("message", (event) => {
    const parsed = parseWsFrame(event.data);
    if (!parsed) return;
    frames.push(parsed);
    onFrame?.(parsed);
  });
  await new Promise<void>((resolve, reject) => {
    let opened = false;
    const onOpen = () => {
      opened = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${device.label} WebSocket failed to open`));
    };
    const onEarlyClose = (event: CloseEvent) => {
      closed = { code: event.code, reason: event.reason };
      if (!opened) {
        cleanup();
        reject(
          new Error(
            `${device.label} WebSocket closed before open (${event.code}: ${event.reason})`,
          ),
        );
      }
    };
    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onEarlyClose);
  });

  return {
    frames,
    closedEvent: () => closed,
    isClosed: () => closed !== null,
    async declare(containerIds: readonly string[]): Promise<string[]> {
      const declarationId = crypto.randomUUID();
      const from = frames.length;
      ws.send(
        JSON.stringify({
          type: "known_containers",
          declarationId,
          containerIds,
        }),
      );
      let ack: WsFrame | undefined;
      await until(() => {
        ack = frames
          .slice(from)
          .find(
            (frame) =>
              frame.type === "known_containers_ack" &&
              frame.declarationId === declarationId,
          );
        return ack !== undefined;
      }, `${device.label} known_containers_ack`);
      return Array.isArray(ack?.containerIds)
        ? ack.containerIds.filter((id): id is string => typeof id === "string")
        : [];
    },
    async waitForFrame(
      from: number,
      predicate: (frame: WsFrame) => boolean,
      label: string,
    ): Promise<WsFrame> {
      let matched: WsFrame | undefined;
      await until(() => {
        matched = frames.slice(from).find(predicate);
        return matched !== undefined;
      }, label);
      if (!matched) throw new Error(`Expected ${label}`);
      return matched;
    },
    close(): void {
      if (closed === null) ws.close();
    },
  };
}

async function localDocumentText(
  device: Device,
  documentId: string,
): Promise<string | null> {
  const localId =
    await device.sdk.documents.findLocalIdByDocumentId(documentId);
  if (!localId) return null;
  const store = device.sdk.documents.open(
    { documentId, localId },
    { createIfMissing: false, remoteSyncMode: "on-demand" },
  );
  if (!(await store.ensureInitialized())) return null;
  return store.getSnapshot().text;
}

// End-to-end realtime gateway contract (#3353 baseline): a socket's
// `known_containers` declaration installs interest only for folders the user
// holds verified read access to, live hints drive automatic device-first sync,
// moving a subfolder out of a shared tree or revoking a grant evicts interest
// and stops all later hints, and a new share delivers `shared_with_you`.
test("realtime interest authorizes only readable folders, drives live sync, and stops hints after move or revocation", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);

  const privateFolder = await world.createFolder(
    alice,
    world.root(alice),
    "Private",
  );
  const shared = await world.createFolder(alice, world.root(alice), "Shared");
  const child = await world.createFolder(alice, shared, "Child");
  const privateDoc = await world.createDocument(alice, privateFolder, "secret");
  const sharedDoc = await world.createDocument(alice, shared, "shared v1");
  const childDoc = await world.createDocument(alice, child, "child v1");
  await world.shareWithUser(alice, shared, bob);

  const bobDevice = bob.devices[0];
  if (!bobDevice) throw new Error("Expected Bob's device");
  const handle = await bobDevice.openDeviceFirst();
  await bobDevice.holdFolder(shared.id);
  await bobDevice.holdFolder(child.id);

  let nextEventId = 0;
  const socket = await connectRealtime(bobDevice, (frame) => {
    if (
      frame.type === "document_update_created" ||
      frame.type === "document_mutation_created" ||
      frame.type === "container_mutation_created" ||
      frame.type === "container_children_changed" ||
      frame.type === "container_path_changed"
    ) {
      bobDevice.sdk.events.push({ ...frame, id: String(nextEventId++) });
    }
  });
  try {
    // Declare readable folders alongside Alice's private folder: the hub must
    // authorize only the readable subset.
    const authorized = await socket.declare([
      shared.id,
      child.id,
      privateFolder.id,
    ]);
    expect(authorized.sort()).toEqual([shared.id, child.id].sort());

    bobDevice.sdk.events.setConnected(true);
    handle.view.updateRuntime(
      bobDevice.sdk.containerContents.workflowRuntime(),
    );
    await until(
      async () =>
        (await localDocumentText(bobDevice, childDoc.documentId)) ===
        "child v1",
      "Bob's initial child document hydration",
    );
    await bobDevice.idle();

    // Edits in Alice's private folder emit zero frames on Bob's socket.
    const beforePrivateEdit = socket.frames.length;
    await world.editDocument(alice, privateDoc, "secret v2");
    await Bun.sleep(150);
    expect(
      socket.frames
        .slice(beforePrivateEdit)
        .filter((frame) => frame.documentId === privateDoc.documentId),
    ).toEqual([]);

    // Edits in the shared child folder emit a live hint and Bob's device-first
    // scope converges automatically without any manual refresh or read call.
    const beforeLiveEdit = socket.frames.length;
    await world.editDocument(alice, childDoc, "child v2 live");
    await socket.waitForFrame(
      beforeLiveEdit,
      (frame) =>
        frame.type === "document_update_created" &&
        frame.documentId === childDoc.documentId,
      "live document_update_created hint for childDoc",
    );
    await until(
      async () =>
        (await localDocumentText(bobDevice, childDoc.documentId)) ===
        "child v2 live",
      "Bob's device-first scope to pull live edit from hint",
    );

    // Moving Child out of Shared into Private evicts Child from Bob's socket;
    // subsequent edits in Child send zero hints to Bob.
    const beforeMove = socket.frames.length;
    await world.moveFolder(alice, child, privateFolder);
    await socket.waitForFrame(
      beforeMove,
      (frame) =>
        frame.type === "resync_required" &&
        Array.isArray(frame.containerIds) &&
        frame.containerIds.includes(child.id),
      "resync_required eviction for moved Child",
    );
    const afterMove = socket.frames.length;
    await world.editDocument(alice, childDoc, "child v3 after move out");
    await Bun.sleep(150);
    expect(
      socket.frames
        .slice(afterMove)
        .filter((frame) => frame.documentId === childDoc.documentId),
    ).toEqual([]);

    // Revoking Bob from Shared evicts Shared from Bob's socket; subsequent
    // edits in Shared send zero hints to Bob.
    const beforeRevoke = socket.frames.length;
    await world.revoke(alice, shared, bob);
    await socket.waitForFrame(
      beforeRevoke,
      (frame) =>
        frame.type === "resync_required" &&
        Array.isArray(frame.containerIds) &&
        frame.containerIds.includes(shared.id),
      "resync_required eviction for revoked Shared",
    );
    const afterRevoke = socket.frames.length;
    await world.editDocument(alice, sharedDoc, "shared v2 after revoke");
    await Bun.sleep(150);
    expect(
      socket.frames
        .slice(afterRevoke)
        .filter((frame) => frame.documentId === sharedDoc.documentId),
    ).toEqual([]);

    // Sharing a fresh folder notifies Bob's socket with `shared_with_you`.
    const freshShare = await world.createFolder(
      alice,
      world.root(alice),
      "Fresh Share",
    );
    const beforeNewShare = socket.frames.length;
    await world.shareWithUser(alice, freshShare, bob);
    await socket.waitForFrame(
      beforeNewShare,
      (frame) => frame.type === "shared_with_you",
      "shared_with_you notification",
    );
  } finally {
    socket.close();
  }
  expectNoSecurityIncidents(world);
}, 240_000);

// Revoking a device's session from another device immediately publishes
// `session_revoked` to that session's live WebSocket and closes it.
test("destroying a session revokes and closes its live realtime socket", async () => {
  world = await World.create();
  const bob = await world.register("bob");
  const bob1 = bob.devices[0];
  if (!bob1) throw new Error("Expected Bob's first device");
  const bob2 = await world.newDevice(bob);

  const socket = await connectRealtime(bob1);
  try {
    expect(await socket.declare([bob1.rootContainerId])).toEqual([
      bob1.rootContainerId,
    ]);
    const sessions = await bob2.sdk.session.listSessions();
    const target = sessions.find((session) => !session.isCurrent);
    if (!target) throw new Error("Expected bob1's session in listSessions");
    expect(await bob2.sdk.session.destroySession(target.id)).toBe(true);

    await until(socket.isClosed, "revoked session WebSocket to close");
    expect(socket.closedEvent()).toEqual({
      code: 1008,
      reason: "Session revoked",
    });
  } finally {
    socket.close();
  }
  expectNoSecurityIncidents(world);
}, 120_000);
