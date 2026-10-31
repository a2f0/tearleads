import { expect, spyOn, test } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { createEncryptedColdDocument } from "../../../test/helpers/coldSdkRematerialization";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { routeApp } from "../../routeApp";

async function counted<T>(work: () => Promise<T>) {
  const counter = { statements: 0 };
  const result = await withDatabaseStatementCounter(counter, work);
  return { result, statements: counter.statements };
}

test("container create and writer projections stay within their statement budgets", async () => {
  const tree = await createOwnedTree(0);
  try {
    const child = await tree.createChild(tree.rootId);
    // Count only the create request, not the SDK reads that prepare it.
    const create = { statements: 0 };
    const request = routeApp.request.bind(routeApp);
    const spy = spyOn(routeApp, "request").mockImplementation(
      (input, init, ...rest) =>
        input === "/containers" && init?.method === "POST"
          ? withDatabaseStatementCounter(create, () =>
              request(input, init, ...rest),
            )
          : request(input, init, ...rest),
    );
    let grandchild: string;
    try {
      grandchild = await tree.createChild(child);
    } finally {
      spy.mockRestore();
    }
    const document = await createEncryptedColdDocument({
      containerId: grandchild,
      organizationId: tree.organizationId,
      owner: tree.owner,
    });
    const project = (path: string) =>
      counted(async () => {
        const response = await routeApp.request(path, {
          headers: { Authorization: `Bearer ${tree.owner.token}` },
        });
        return { body: await response.text(), status: response.status };
      });
    const paths = {
      document: `/documents/${document.documentId}/writer-projection`,
      grandchild: `/containers/${grandchild}/writer-projection`,
      root: `/containers/${tree.rootId}/writer-projection`,
    };
    // Warm the process-wide verification markers the first projections record.
    for (const path of Object.values(paths)) await project(path);

    const root = await project(paths.root);
    const nested = await project(paths.grandchild);
    const documentProjection = await project(paths.document);
    for (const projection of [root, nested, documentProjection]) {
      expect(projection.result.status).toBe(200);
    }
    // Measured with PGlite / SQLite / Postgres. Create: 52 / 53 / 54 while the
    // metadata reservation ran four reads and each access event was read
    // back; 47 / 48 / 49 after. Root, grandchild, and document projections:
    // 22 / 24 / 24, 40 / 42 / 42, and 51 / 53 / 53 while each epoch row was
    // read twice, manifest history took two reads, and policy evidence
    // re-read the organization state; 19 / 21 / 21, 33 / 35 / 35, and
    // 44 / 46 / 46 after.
    expect(create.statements).toBeLessThanOrEqual(49);
    expect(root.statements).toBeLessThanOrEqual(21);
    expect(nested.statements).toBeLessThanOrEqual(35);
    expect(documentProjection.statements).toBeLessThanOrEqual(46);
  } finally {
    tree.close();
  }
}, 180_000);
