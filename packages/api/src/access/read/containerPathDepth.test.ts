import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
} from "@tearleads/api-shared/schema";
import { listCurrentContainerKekTargetClosureIdsMapped } from "./containerKekTargets";

const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
beforeAll(async () => {
  const organizationId = crypto.randomUUID();
  // Storage-shape fixtures for the SQL ancestor closure after signature
  // verification. Route tests separately construct genuine signed paths.
  const rows = ids.map((id, depth) => ({
    version: 1,
    objectKind: "container" as const,
    objectId: id,
    organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: `depth-event:${id}`,
    structuralHash: "structure",
    grantRoot: "grants",
    referencedPrincipalHeads: [],
    keyTargetHash: "keys",
    manifestHash: `depth-manifest:${id}`,
    state: {
      version: 1,
      containerId: id,
      containerKeyEpochId: `key:${id}`,
      parentContainerId: ids[depth - 1] ?? null,
    },
  }));
  await db.insert(accessManifests).values(rows);
  await db.insert(accessManifestHeads).values(
    rows.map((row) => ({
      objectKind: row.objectKind,
      objectId: row.objectId,
      organizationId,
      epoch: row.epoch,
      manifestHash: row.manifestHash,
    })),
  );
});

function closure(containerIds: readonly string[]) {
  return listCurrentContainerKekTargetClosureIdsMapped(
    containerIds,
    db,
    (message) => new Error(message),
  );
}

test("ancestor closure accepts exactly 100 containers including the root", async () => {
  const leaf = ids[99];
  if (!leaf) throw new Error("Missing boundary leaf");
  expect(await closure([leaf])).toEqual(ids.slice(0, 100).sort());
});

test.each([false, true])(
  "ancestor closure refuses 101 containers with duplicate seed paths: %s",
  async (allSeeds) => {
    const leaf = ids[100];
    if (!leaf) throw new Error("Missing overflow leaf");
    await expect(closure(allSeeds ? ids : [leaf])).rejects.toThrow(
      "Container path exceeds maximum depth",
    );
  },
);
