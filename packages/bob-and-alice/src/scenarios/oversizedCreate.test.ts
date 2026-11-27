import { afterEach, expect, test } from "bun:test";
import { World } from "../harness/world";
import { largeText } from "./baselineGroup.testUtils";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// One update travels in one sync request of at most 16 MiB, so a single
// write of more than about 12 MiB of text is never sent: it stays queued,
// and a document whose first write it is exists on the API with no text. A
// scenario that created such a document and went on would be testing an
// empty one, so the harness refuses the create as it refuses an edit that
// did not reach the API.
test("a first write too large for one request is not taken for a created document", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const root = world.root(alice);

  // A create of text that fits is the document a scenario asked for.
  const small = await world.createDocument(alice, root, largeText(1));
  expect(small.documentId).toBeString();

  const failure = await world
    .createDocument(alice, root, largeText(13))
    .catch((error: unknown) => error);

  expect(String(failure)).toContain("create did not reach the API");
  // The document was created, and its one write is queued with the reason.
  const [device] = alice.devices;
  const pending = await device?.sdk.containerContents
    .documentQueries()
    .listPendingWrites();
  expect(pending).toMatchObject([
    {
      objectKind: "document",
      operations: [
        {
          kind: "update",
          lastError: "Document sync update exceeds its data limit",
        },
      ],
      remoteId: expect.any(String),
      status: "error",
    },
  ]);
}, 120_000);
