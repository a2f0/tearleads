import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { accessManifestHeads } from "@symcrypt/api-shared/schema";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "../../../access/read/accessManifestStore";
import { planAttachmentAuthorizationContainerIds } from "./authorization";

test("attachment authorization locks path and linked target containers", () => {
  expect(
    planAttachmentAuthorizationContainerIds({
      authorizingContainerIds: ["ancestor", "linked-a"],
      linkedContainerIds: ["linked-b", "linked-a"],
    }),
  ).toEqual(["ancestor", "linked-a", "linked-b"]);
});

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment locks block rekey on a non-authorizing linked target",
  async () => {
    const authorizingContainerId = crypto.randomUUID();
    const linkedTargetId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    await db.insert(accessManifestHeads).values([
      {
        epoch: 1,
        manifestHash: `manifest:${authorizingContainerId}`,
        objectId: authorizingContainerId,
        objectKind: "container",
        organizationId,
      },
      {
        epoch: 1,
        manifestHash: `manifest:${linkedTargetId}`,
        objectId: linkedTargetId,
        objectKind: "container",
        organizationId,
      },
    ]);
    const lockIds = planAttachmentAuthorizationContainerIds({
      authorizingContainerIds: [authorizingContainerId],
      linkedContainerIds: [authorizingContainerId, linkedTargetId],
    });

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await lockAccessManifestHeadsForShare("container", lockIds, tx);
      markHeld();
      await hold;
    });

    await held;
    let rekeySettled = false;
    const rekey = db
      .transaction((tx) =>
        lockAccessManifestHeadsForUpdate("container", [linkedTargetId], tx),
      )
      .then(() => {
        rekeySettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = rekeySettled;
    releaseHold();
    await Promise.all([holder, rekey]);

    expect(settledWhileHeld).toBe(false);
    expect(rekeySettled).toBe(true);
  },
  30_000,
);
