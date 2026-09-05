import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { containerAccessManifestStateRecord } from "../../keyingProjectionRecords";
import {
  MAX_SAME_EPOCH_MANIFEST_HISTORY,
  resolveCurrentContainerKekTargets,
} from "../shared/internal/containerKekTargets";

test.each([
  "recite",
  "grant",
] as const)("same-epoch %s history accepts the bound, refuses overflow, and resumes after rekey", async (eventType) => {
  const owner = createTestUser();
  await registerUser(owner);
  const root = await bootstrapRoot(owner);
  const state = asVerifiedContainerManifest(root.bundle).state;
  const [initial] = await db
    .select()
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));
  const [keyEpoch] = await db
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, root.kekState.containerKeyEpochId));
  if (!initial || !keyEpoch)
    throw new Error("Expected registered root key material");
  // Storage-shape fixtures exercise the read-side bound after the signed-event
  // boundary. They are never submitted to the cryptographic verifier.
  const rows = Array.from(
    { length: MAX_SAME_EPOCH_MANIFEST_HISTORY },
    (_, index) => {
      const epoch = initial.epoch + index + 1;
      const manifestHash = `${initial.manifestHash}:${epoch}`;
      const previousManifestHash =
        index === 0
          ? initial.manifestHash
          : `${initial.manifestHash}:${epoch - 1}`;
      const eventHash = `${initial.eventHash}:${epoch}`;
      return {
        ...initial,
        id: crypto.randomUUID(),
        epoch,
        eventHash,
        manifestHash,
        previousManifestHash,
        state: containerAccessManifestStateRecord({
          ...state,
          directGrants:
            eventType === "grant"
              ? [
                  ...state.directGrants,
                  ...Array.from({ length: index + 1 }, (_, grantIndex) => ({
                    accessLevel: "read" as const,
                    subjectId: `reader-${grantIndex}`,
                    subjectType: "user" as const,
                  })),
                ]
              : state.directGrants,
          epoch,
          eventHash,
          previousManifestHash,
        }),
      };
    },
  );
  for (let offset = 0; offset < rows.length; offset += 128) {
    await db.insert(accessManifests).values(rows.slice(offset, offset + 128));
  }
  const atBound = rows.at(-2);
  const overflow = rows.at(-1);
  if (!atBound || !overflow)
    throw new Error("Expected history boundary fixtures");
  const setHead = (row: typeof overflow) =>
    db
      .update(accessManifestHeads)
      .set({ epoch: row.epoch, manifestHash: row.manifestHash })
      .where(eq(accessManifestHeads.objectId, state.containerId));
  await setHead(atBound);
  expect(
    (await resolveCurrentContainerKekTargets([state.containerId], db)).get(
      state.containerId,
    )?.containerKeyEpochId,
  ).toBe(keyEpoch.id);
  await setHead(overflow);
  await expect(
    resolveCurrentContainerKekTargets([state.containerId], db),
  ).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining("exceeds maximum depth"),
  });

  const nextKeyEpochId = crypto.randomUUID();
  await db
    .update(accessManifests)
    .set({ state: { ...overflow.state, containerKeyEpochId: nextKeyEpochId } })
    .where(eq(accessManifests.manifestHash, overflow.manifestHash));
  await db.insert(containerKeyEpochs).values({
    ...keyEpoch,
    id: nextKeyEpochId,
    keyEpoch: keyEpoch.keyEpoch + 1,
    accessManifestHash: overflow.manifestHash,
    createdByManifestHash: overflow.manifestHash,
    createdByEventHash: overflow.eventHash,
  });
  expect(
    (await resolveCurrentContainerKekTargets([state.containerId], db)).get(
      state.containerId,
    )?.containerKeyEpochId,
  ).toBe(nextKeyEpochId);
});

test("same-epoch history cycles still fail closed without growing SQL path strings", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  const root = await bootstrapRoot(owner);
  const state = asVerifiedContainerManifest(root.bundle).state;
  await db
    .update(accessManifests)
    .set({
      previousManifestHash: root.bundle.manifestHash,
      state: containerAccessManifestStateRecord({
        ...state,
        previousManifestHash: root.bundle.manifestHash,
      }),
    })
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));
  await expect(
    resolveCurrentContainerKekTargets([state.containerId], db),
  ).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining("cycle detected"),
  });
});
