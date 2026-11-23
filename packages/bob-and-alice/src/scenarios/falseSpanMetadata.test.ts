import { afterEach, expect, test } from "bun:test";
import {
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { Device } from "../harness/device";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

const VOIDED = "Documents: sync update voided";

function voidReports(device: Device) {
  return device.errors.filter(({ message }) => message === VOIDED).length;
}

async function folderName(device: Device, folderId: string) {
  const tree = await device.tree();
  await tree.refresh();
  await device.idle();
  return tree.getSnapshot().nodes.find((node) => node.id === folderId)?.name;
}

/** Each update id a device's sync responses serve it, once per serving. */
function observeServedUpdates(device: Device): string[] {
  const served: string[] = [];
  device.transport.rewriteResponses(
    (request) => request.method === "POST" && request.path.endsWith("/sync"),
    (body) => {
      const updates =
        typeof body === "object" && body !== null && "updates" in body
          ? body.updates
          : [];
      for (const update of Array.isArray(updates) ? updates : []) {
        if (typeof update?.id === "string") served.push(update.id);
      }
      return body;
    },
  );
  return served;
}

/** The ids of the updates one request sent, in order. */
function requestUpdateIds({ body }: { readonly body: unknown }): string[] {
  return typeof body === "object" &&
    body !== null &&
    "outgoingUpdates" in body &&
    Array.isArray(body.outgoingUpdates)
    ? body.outgoingUpdates.map((update: { id: string }) => update.id)
    : [];
}

/** The ids of the updates a device sent after `from` exchanges, in order. */
function sentUpdateIds(device: Device, from: number): string[] {
  return device.transport.history.slice(from).flatMap(requestUpdateIds);
}

/** Each metadata update count a device's listings report for `folderId`. */
function observeListedUpdateCounts(device: Device, folderId: string) {
  const counts: number[] = [];
  device.transport.rewriteResponses(
    (request) =>
      request.method === "POST" && request.path.endsWith("/parent-lanes/query"),
    (body) => {
      const { results } = body as {
        results?: {
          page?: { items?: { id: string; metadataUpdateCount: number }[] };
        }[];
      };
      for (const result of results ?? []) {
        for (const item of result.page?.items ?? []) {
          if (item.id === folderId) counts.push(item.metadataUpdateCount);
        }
      }
      return body;
    },
  );
  return counts;
}

/**
 * Alice shares a folder with Bob, then renames it offline as a modified
 * client that overclaims the rename's span. Bob's device voids the rename.
 */
async function voidedForgedRename() {
  const created = await World.create();
  world = created;
  const alice = await created.register("alice");
  const bob = await created.register("bob");
  await created.addToOrganization(alice, bob);
  const folder = await created.createFolder(
    alice,
    created.root(alice),
    "Shared",
  );
  await created.shareWithUser(alice, folder, bob);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");
  const served = observeServedUpdates(reader);
  await reader.holdFolder(folder.id);
  expect(await folderName(reader, folder.id)).toBe("Shared");

  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  offline.setOnline(false);
  expect(
    await (await offline.tree()).renameContainer(folder.id, "Forged"),
  ).not.toBeNull();
  const liar = await created.restartDevice(alice, offline, false);
  const forged = await liar.forgeQueuedUpdateSpans(
    ({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ "4242": 7 }),
      ]),
      start,
    }),
    "container-metadata",
  );
  expect(forged).toBe(1);
  const sentBefore = liar.transport.history.length;
  liar.setOnline(true);
  await (await liar.tree()).refresh();
  await liar.idle();
  const [forgedId] = sentUpdateIds(liar, sentBefore);
  if (!forgedId) throw new Error("Expected the forged rename to be sent");
  const metadataSyncPath = liar.transport.history
    .slice(sentBefore)
    .find((exchange) => requestUpdateIds(exchange).includes(forgedId))?.path;
  if (!metadataSyncPath) throw new Error("Expected the rename's sync path");

  for (let pass = 0; pass < 3; pass += 1) {
    expect(await folderName(reader, folder.id)).toBe("Shared");
  }
  expect(voidReports(reader)).toBe(1);
  return {
    alice,
    created,
    folder,
    forgedId,
    liar,
    metadataSyncPath,
    reader,
    served,
  };
}

// Folder metadata documents void a false-span update as document content
// does: the reader keeps the folder's earlier name, reports the update once,
// and its own renames still settle and reach the writer. Metadata keeps a
// processed cursor too, so the update is served to the reader only once.
test("a reader voids a false-span folder rename and keeps syncing the folder", async () => {
  const { created, folder, forgedId, liar, reader, served } =
    await voidedForgedRename();
  // Bob never holds the forged rename, so his first rename can tie it on
  // Alice's device; his second is later than both.
  const readerTree = await reader.tree();
  for (const name of ["Bob's draft", "Bob's name"]) {
    expect(await readerTree.renameContainer(folder.id, name)).not.toBeNull();
    await reader.idle();
  }
  expect(await folderName(liar, folder.id)).toBe("Bob's name");
  expect(await folderName(reader, folder.id)).toBe("Bob's name");
  expect(voidReports(reader)).toBe(1);
  expect(served.filter((id) => id === forgedId)).toHaveLength(1);
  expectNoSecurityIncidents(created);
}, 180_000);

// A container listing counts every update of the folder's metadata, the void
// rename included. The reader's processed cursor counted it too, so a later
// listing that returns the folder owes no read of its metadata.
test("a listing after a voided folder rename owes no further metadata read", async () => {
  const { alice, created, folder, metadataSyncPath, reader } =
    await voidedForgedRename();
  const listed = observeListedUpdateCounts(reader, folder.id);
  const from = reader.transport.history.length;
  // A write into the folder touches its row without editing its metadata.
  await created.createDocument(alice, folder, "Touch");
  for (let pass = 0; pass < 3; pass += 1) {
    expect(await folderName(reader, folder.id)).toBe("Shared");
  }
  expect(listed.length).toBeGreaterThan(0);
  expect(
    reader.transport.history
      .slice(from)
      .filter(({ path }) => path === metadataSyncPath),
  ).toEqual([]);
  expect(voidReports(reader)).toBe(1);
  expectNoSecurityIncidents(created);
}, 180_000);
