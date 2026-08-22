import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { accessManifestHeads } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import { gateTransactionExecuteAfterExecution } from "../../../../test/helpers/gateDatabaseExecute";
import { createChildContainer } from "../../../../test/helpers/keyingWriterProjectionChild";
import { bootstrapRoot } from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "../../../access/read/accessManifestStore";
import { listCurrentContainerKekTargetClosureIdsMapped } from "../../../access/read/containerKekTargets";
import { createAttachmentAuthorizationLockPlan } from "./authorization";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment closure rejects an ancestor recreated after a missing-head read",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const child = await createChildContainer({ parent: root, signer: owner });
    const rootContainerId = root.kekState.containerId;
    const [rootHead] = await db
      .select()
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "container"),
          eq(accessManifestHeads.objectId, rootContainerId),
        ),
      )
      .limit(1);
    if (!rootHead) {
      throw new Error("Expected root container manifest head");
    }
    await db
      .delete(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "container"),
          eq(accessManifestHeads.objectId, rootContainerId),
        ),
      );

    const closureReadReturned = deferred();
    const releaseClosureRead = deferred();
    const gatedDatabase = gateTransactionExecuteAfterExecution({
      database: db,
      occurrence: 1,
      reached: closureReadReturned.resolve,
      release: releaseClosureRead.promise,
    });
    const closure = gatedDatabase.transaction((tx) =>
      listCurrentContainerKekTargetClosureIdsMapped(
        [child.containerId],
        tx,
        (message) => new Error(message),
      ),
    );

    try {
      await closureReadReturned.promise;
      await db.insert(accessManifestHeads).values(rootHead);
      releaseClosureRead.resolve();

      await expect(closure).rejects.toThrow(
        "Container KEK parent target is missing",
      );
    } finally {
      releaseClosureRead.resolve();
      await closure.catch(() => undefined);
    }
  },
  30_000,
);
