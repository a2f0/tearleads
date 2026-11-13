import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { documentManifestObservations } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createEncryptedColdDocument } from "../../../test/helpers/coldSdkRematerialization";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { routeApp } from "../../routeApp";

test("document projections insert only a new served observation for this user and head", async () => {
  const tree = await createOwnedTree(0);
  try {
    const { documentId } = await createEncryptedColdDocument({
      containerId: tree.rootId,
      organizationId: tree.organizationId,
      owner: tree.owner,
    });
    const project = async () => {
      const counter = { statements: 0 };
      const response = await withDatabaseStatementCounter(counter, () =>
        Promise.resolve(
          routeApp.request(`/documents/${documentId}/writer-projection`, {
            headers: { Authorization: `Bearer ${tree.owner.token}` },
          }),
        ),
      );
      expect(response.status).toBe(200);
      return { body: await response.text(), statements: counter.statements };
    };
    await project();
    const [observed] = await db
      .select()
      .from(documentManifestObservations)
      .where(eq(documentManifestObservations.documentId, documentId));
    if (!observed)
      throw new Error(
        "Expected the authorized projection to record its observation",
      );
    await db
      .delete(documentManifestObservations)
      .where(eq(documentManifestObservations.documentId, documentId));
    await db.insert(documentManifestObservations).values([
      {
        userId: crypto.randomUUID(),
        documentId,
        manifestHash: observed.manifestHash,
      },
      { userId: tree.owner.userId, documentId, manifestHash: "another-head" },
    ]);
    const first = await project();
    const repeated = await project();
    expect(repeated.body).toBe(first.body);
    console.info("observations", {
      first: first.statements,
      repeated: repeated.statements,
    });
    expect(first.statements - repeated.statements).toBe(1);
    const rows = await db
      .select()
      .from(documentManifestObservations)
      .where(eq(documentManifestObservations.documentId, documentId));
    expect(rows).toHaveLength(3);
    expect(
      rows.filter(
        (row) =>
          row.userId === tree.owner.userId &&
          row.manifestHash === observed.manifestHash,
      ),
    ).toHaveLength(1);
  } finally {
    tree.close();
  }
}, 180_000);

for (const foreignKey of ["user", "head"] as const) {
  test(`a ${foreignKey}-mismatched observation cannot mark the served head observed`, async () => {
    const tree = await createOwnedTree(0);
    try {
      const { documentId } = await createEncryptedColdDocument({
        containerId: tree.rootId,
        organizationId: tree.organizationId,
        owner: tree.owner,
      });
      const project = () =>
        routeApp.request(`/documents/${documentId}/writer-projection`, {
          headers: { Authorization: `Bearer ${tree.owner.token}` },
        });
      expect((await project()).status).toBe(200);
      const [served] = await db
        .select()
        .from(documentManifestObservations)
        .where(eq(documentManifestObservations.documentId, documentId));
      if (!served) throw new Error("Expected a served observation");
      await db
        .delete(documentManifestObservations)
        .where(eq(documentManifestObservations.documentId, documentId));
      await db.insert(documentManifestObservations).values({
        documentId,
        userId: foreignKey === "user" ? crypto.randomUUID() : served.userId,
        manifestHash:
          foreignKey === "head" ? "a-different-head" : served.manifestHash,
      });
      expect((await project()).status).toBe(200);
      const rows = await db
        .select()
        .from(documentManifestObservations)
        .where(eq(documentManifestObservations.documentId, documentId));
      expect(
        rows.filter(
          (row) =>
            row.userId === served.userId &&
            row.manifestHash === served.manifestHash,
        ),
      ).toHaveLength(1);
      expect(rows).toHaveLength(2);
    } finally {
      tree.close();
    }
  }, 180_000);
}
