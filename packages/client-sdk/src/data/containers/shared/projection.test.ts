import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql, type TestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createUserContainerWrap,
} from "../../../../test/helpers/containerFixtures";
import {
  createChildContainerProjection,
  moveContainerProjection,
} from "../../../../test/helpers/projectionHierarchy";
import { unwrapContainerKekPath } from "../../documents/shared/containerKek/containerKekPath";

async function withProjectionDatabase<T>(
  name: string,
  run: (execSql: TestExecSql) => Promise<T>,
): Promise<T> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    return await run(execSql);
  } finally {
    close();
  }
}

test("unwrapContainerKekPath verifies signed projection events before unwrap", async () => {
  const parent = await createParentProjection();
  const tamperedProjection = structuredClone(parent.projection);
  const event = Reflect.get(tamperedProjection.path[0]?.event ?? {}, "event");
  if (!event || typeof event !== "object") {
    throw new Error("Expected projection event");
  }
  Reflect.set(event, "signature", bytesToBase64(new Uint8Array(64)));

  await withProjectionDatabase(
    "projection-tampered-event",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: tamperedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("signature"),
  );
});

test("unwrapContainerKekPath rejects projection wraps not justified by the manifest", async () => {
  const parent = await createParentProjection();
  const attackerUserId = "attacker-user";
  const attackerKeyPair = generateKemSeedAndKeyPair();
  const attackerFingerprint = await toFingerprint(attackerKeyPair.publicKey);
  const attackerWrap = await createUserContainerWrap({
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    containerKek: parent.parentContainerKek,
    publicKey: attackerKeyPair.publicKey,
    recipientKeyEpochId: `user:${attackerUserId}:encapsulation:${attackerFingerprint}`,
    userId: attackerUserId,
    wrapManifestHash: parent.parentKekState.accessManifestHash,
  });
  const tamperedProjection = structuredClone(parent.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK");
  }
  kek.wraps = [...kek.wraps, attackerWrap];

  await withProjectionDatabase(
    "projection-unjustified-wrap",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: tamperedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("KEK verification failed"),
  );
});

test("unwrapContainerKekPath rejects substituted material for committed KEK ids", async () => {
  const parent = await createParentProjection();
  const target = parent.parentKekState.recipientTargets.find(
    (candidate) =>
      candidate.recipientKind === "user" &&
      candidate.recipientId === parent.userId,
  );
  if (!target) {
    throw new Error("Expected parent user recipient target");
  }

  const substituteKek = crypto.getRandomValues(new Uint8Array(32));
  const substituteWrap = await createUserContainerWrap({
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    containerKek: substituteKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: target.recipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: parent.parentKekState.accessManifestHash,
  });
  const tamperedProjection = structuredClone(parent.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK");
  }
  kek.wraps = [substituteWrap];

  await withProjectionDatabase(
    "projection-substituted-kek",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: tamperedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("KEK material does not match committed epoch id"),
  );
});

test("unwrapContainerKekPath verifies move-back-to-root projections with historical parent proofs", async () => {
  const parent = await createParentProjection();
  const parentA = await createChildContainerProjection({
    containerId: "projection-parent-a",
    parent,
    parentProjection: parent.projection,
  });
  const movedChild = await createChildContainerProjection({
    containerId: "projection-moved-child",
    parent,
    parentProjection: parent.projection,
  });
  const movedUnderParentA = await moveContainerProjection({
    containerId: movedChild.projection.containerId,
    destinationParentProjection: parentA.projection,
    eventId: "projection-moved-child-under-parent-a",
    manifestHistory: [movedChild.bundle],
    parent,
    sourceProjection: movedChild.projection,
  });
  const movedBackToRoot = await moveContainerProjection({
    containerId: movedChild.projection.containerId,
    destinationParentProjection: parent.projection,
    eventId: "projection-moved-child-back-to-root",
    manifestHistory: [
      movedUnderParentA.bundle,
      movedChild.bundle,
      parentA.bundle,
    ],
    parent,
    sourceProjection: movedUnderParentA.projection,
  });

  const missingHistoricalParentProjection = structuredClone(
    movedBackToRoot.projection,
  );
  const movedBackKek = missingHistoricalParentProjection.containerKeks.at(-1);
  if (!movedBackKek) {
    throw new Error("Expected moved-back KEK");
  }
  movedBackKek.containerManifestHistory = [
    movedUnderParentA.bundle,
    movedChild.bundle,
  ];
  const unwrappedKeks = await withProjectionDatabase(
    "projection-move-back-to-root",
    async (execSql) => {
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: missingHistoricalParentProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow(
        // The previous manifest was moved under parent A and cites A's head;
        // with A's proof withheld that head cannot be resolved.
        "Container writer projection path[1] previous manifest does not cite a served head of its parent container projection-parent-a",
      );
      return unwrapContainerKekPath({
        execSql,
        projection: movedBackToRoot.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        secretKey: parent.secretKey,
      });
    },
  );
  const movedBackKekId =
    movedBackToRoot.projection.containerKeks.at(-1)?.containerKeyEpochId;
  if (!movedBackKekId) {
    throw new Error("Expected moved-back container KEK id");
  }

  expect(movedUnderParentA.containerKey).not.toEqual(movedChild.containerKey);
  expect(movedBackToRoot.containerKey).not.toEqual(
    movedUnderParentA.containerKey,
  );
  expect(Array.from(unwrappedKeks.get(movedBackKekId) ?? [])).toEqual(
    Array.from(movedBackToRoot.containerKey),
  );
  const originalKekId =
    movedChild.projection.containerKeks.at(-1)?.containerKeyEpochId;
  if (!originalKekId) {
    throw new Error("Expected original moved container KEK id");
  }
  expect(Array.from(unwrappedKeks.get(originalKekId) ?? [])).toEqual(
    Array.from(movedChild.containerKey),
  );
});
