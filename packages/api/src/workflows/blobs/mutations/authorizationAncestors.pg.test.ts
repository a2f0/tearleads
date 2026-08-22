import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { authenticate } from "../../../../test/helpers/authenticate";
import { createChildContainer } from "../../../../test/helpers/keyingWriterProjectionChild";
import { bootstrapRoot } from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "../../../access/read/accessManifestStore";
import { listCurrentContainerKekTargetClosureIdsMapped } from "../../../access/read/containerKekTargets";
import { createAttachmentAuthorizationLockPlan } from "./authorization";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment locks block rekey on a key-target ancestor",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const child = await createChildContainer({ parent: root, signer: owner });
    const closureIds = await listCurrentContainerKekTargetClosureIdsMapped(
      [child.containerId],
      db,
      (message) => new Error(message),
    );
    const rootContainerId = root.kekState.containerId;
    expect(closureIds).toEqual([rootContainerId, child.containerId].sort());
    const lockPlan = createAttachmentAuthorizationLockPlan({
      authorizingContainerIds: [child.containerId],
      containerKekTargetClosureIds: closureIds,
      documentId: crypto.randomUUID(),
      existingBlobTargets: [],
      linkedContainerIds: [child.containerId],
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
      await lockAccessManifestHeadsForShare(
        "container",
        lockPlan.containerIds,
        tx,
      );
      markHeld();
      await hold;
    });

    await held;
    let rekeySettled = false;
    const rekey = db
      .transaction((tx) =>
        lockAccessManifestHeadsForUpdate("container", [rootContainerId], tx),
      )
      .then(() => {
        rekeySettled = true;
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = rekeySettled;
    releaseHold();
    await Promise.all([holder, rekey]);

    expect(settledWhileHeld).toBe(false);
    expect(rekeySettled).toBe(true);
  },
  30_000,
);
