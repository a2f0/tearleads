import { afterEach, expect, test } from "bun:test";
import {
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import { readDocument } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// A writer signs an update whose declared span claims operations its payload
// does not carry. No version can hold them, so before the processed cursor
// the API refused every later attachment bind and detach on the document. A
// reader that voided the update attaches a file, the bind lands, and removing
// it detaches the binding.
test("a reader binds and detaches an attachment past a false-span update it voided", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");

  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  const liarStore = await readDocument(offline, world.documentRef(document));
  if (!liarStore) throw offline.failure("cannot open the document");
  offline.setOnline(false);
  await liarStore.setText("seed\nalice\n");
  const liar = await world.restartDevice(alice, offline, false);
  expect(
    await liar.forgeQueuedUpdateSpans(({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ "4242": 7 }),
      ]),
      start,
    })),
  ).toBe(1);
  liar.setOnline(true);
  await readDocument(liar, world.documentRef(document));
  await liar.idle();

  // Bob voids the update as he reads the document, then attaches a file.
  const store = await readDocument(reader, world.documentRef(document));
  if (!store) throw reader.failure("cannot open the document");
  await reader.idle();
  store.attachFiles([
    {
      bytes: new TextEncoder().encode("attached past the liar"),
      mimeType: "text/plain",
      name: "note.txt",
    },
  ]);
  await until(
    () => store.getSnapshot().attachments.length === 1,
    "the attachment slot",
  );
  const [slot] = store.getSnapshot().attachments;
  if (!slot) throw reader.failure("no attachment slot");
  const documentId = world.documentRef(document).documentId;
  const bound = async () => {
    const bindings = await reader.sdk.documents
      .workflowRuntime()
      .apiClient.listDocumentAttachments(documentId, { refresh: true });
    return (bindings ?? []).some(({ slotId }) => slotId === slot.slotId);
  };
  await until(bound, "the attachment binding");
  await reader.idle();
  expect(store.getSnapshot().attachmentStatusBySlotId[slot.slotId]).toBe(
    undefined,
  );

  store.removeAttachment(slot.slotId);
  await until(async () => !(await bound()), "the attachment detach");
  await reader.idle();
  expect(store.getSnapshot().attachments).toEqual([]);
  expectNoSecurityIncidents(world);
}, 180_000);
