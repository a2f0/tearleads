import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createOwnedTree } from "../../test/helpers/ownedContainerTree";
import { clearProcessVerificationMarkers } from "../workflows/containers/writerProjection/verificationMarkers";
import { authorizeContainerAccessWithWorkflow } from "./containerInterestAccess";

test("admits roots within the path-container budget in order and flushes verification markers", async () => {
  const tree = await createOwnedTree(0);
  try {
    const child = await tree.createChild(tree.rootId);
    const grandchild = await tree.createChild(child);

    // Clear stored and process verification markers so authorization must run
    // full verification and write markers back after its transaction commits.
    await db
      .update(accessManifests)
      .set({ verificationMac: null })
      .where(eq(accessManifests.objectId, tree.rootId));
    clearProcessVerificationMarkers();

    // Budget = 3 admits root (depth 0 -> 1) and child (depth 1 -> 2, total 3),
    // refusing grandchild (depth 2 -> 3, would exceed 3).
    const proofs = await authorizeContainerAccessWithWorkflow(
      tree.owner.userId,
      [tree.rootId, child, grandchild],
      { db, maxPathContainers: 3 },
    );
    expect(proofs.map((proof) => proof.containerId)).toEqual([
      tree.rootId,
      child,
    ]);

    const rows = await db
      .select({ verificationMac: accessManifests.verificationMac })
      .from(accessManifests)
      .where(eq(accessManifests.objectId, tree.rootId));
    expect(
      rows.some(
        (row) =>
          typeof row.verificationMac === "string" &&
          row.verificationMac.length > 0,
      ),
    ).toBe(true);
  } finally {
    tree.close();
  }
}, 30_000);
