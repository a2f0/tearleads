import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { routeApp } from "../../routeApp";

for (const corruption of [
  "missing-epoch",
  "wrong-wrap-recipient",
  "malformed-parent-binding",
] as const) {
  test(`writer keying prefetch preserves ${corruption} refusal and sibling isolation`, async () => {
    const tree = await createOwnedTree(0);
    try {
      const child = await tree.createChild(tree.rootId);
      const headers = { Authorization: `Bearer ${tree.owner.token}` };
      const project = (id: string) =>
        routeApp.request(`/containers/${id}/writer-projection`, { headers });
      expect((await project(child)).status).toBe(200);
      const [epoch] = await db
        .select()
        .from(containerKeyEpochs)
        .where(eq(containerKeyEpochs.containerId, child));
      if (!epoch) throw new Error("Expected the signed child's key epoch");
      if (corruption === "missing-epoch") {
        await db
          .delete(containerKeyEpochs)
          .where(eq(containerKeyEpochs.id, epoch.id));
      } else if (corruption === "wrong-wrap-recipient") {
        await db
          .update(containerKeyWraps)
          .set({ recipientId: crypto.randomUUID() })
          .where(eq(containerKeyWraps.containerKeyEpochId, epoch.id));
      } else {
        await db
          .update(containerKeyEpochs)
          .set({ parentContainerKeyEpochId: epoch.id })
          .where(eq(containerKeyEpochs.id, epoch.id));
      }
      const refused = await project(child);
      const body = await refused.json();
      expect(refused.status).toBe(409);
      expect(body.code).toBe("container_projection_state_invalid");
      if (corruption === "missing-epoch")
        expect(body.error).toBe("Container KEK epoch missing");
      else if (corruption === "malformed-parent-binding")
        expect(body.error).toMatch(/parent|epoch/i);
      else expect(body.error).toMatch(/wrap|recipient/i);
      expect((await project(tree.rootId)).status).toBe(200);
    } finally {
      tree.close();
    }
  });
}

test("document lane contexts do not retain a previous request's current head", async () => {
  const tree = await createOwnedTree(0);
  try {
    const child = await tree.createChild(tree.rootId);
    const list = () =>
      routeApp.request("/containers/documents/query", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tree.owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lanes: [
            { laneId: "healthy", containerId: tree.rootId, watermark: null },
            { laneId: "changed", containerId: child, watermark: null },
          ],
        }),
      });
    const warm = await list();
    expect(warm.status).toBe(200);
    const warmBody = await warm.json();
    expect(
      warmBody.results.map((row: { laneId: string }) => row.laneId),
    ).toEqual(["healthy", "changed"]);
    expect(warmBody.results.every((row: object) => "page" in row)).toBe(true);
    await db
      .update(accessManifestHeads)
      .set({ manifestHash: "missing-current-bundle" })
      .where(
        and(
          eq(accessManifestHeads.objectKind, "container"),
          eq(accessManifestHeads.objectId, child),
        ),
      );
    const fresh = await list();
    expect(fresh.status).toBe(200);
    const freshBody = await fresh.json();
    expect(freshBody.results[0]).toHaveProperty("page");
    expect(freshBody.results[1]).toEqual({
      laneId: "changed",
      failure: { error: "Container manifest bundle missing", status: 409 },
    });
  } finally {
    tree.close();
  }
});
