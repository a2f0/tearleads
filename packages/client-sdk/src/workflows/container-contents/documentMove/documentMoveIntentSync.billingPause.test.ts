import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../../test/helpers/workflows/queuedDocumentMoveFixture";

// Sync-edge-cases row 19. The billing gate learns of a block only from a 402,
// so the preflight passes and the refused move is itself the first signal: the
// gate answers "not blocked" before the request and "blocked" after it.
test("a document move refused by the organization's first 402 stays pending with no error", async () => {
  let gateChecks = 0;
  const fixture = await runQueuedDocumentMoveFixture({
    isRemoteSyncBlocked: () => {
      gateChecks += 1;
      return gateChecks > 1;
    },
    linkFailure: { message: "Organization sync is not active", status: 402 },
    testDbName: "containerContents-document-move-billing-pause",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(gateChecks).toBe(2);
  expect(fixture.intentRows).toEqual([
    { lastError: null, syncStatus: "pending" },
  ]);
});

test("a document move refused with a 402 the gate did not attribute records the refusal", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: { message: "Organization sync is not active", status: 402 },
    testDbName: "containerContents-document-move-unattributed-402",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move was rejected or unavailable: Organization sync is not active (402)",
      syncStatus: "pending",
    },
  ]);
});
