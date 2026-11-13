import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { toFingerprint } from "@tearleads/crypto";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { createEncryptedColdDocument } from "../../../test/helpers/coldSdkRematerialization";
import { readContainerDocumentLaneResults } from "../../../test/helpers/containerDocumentLaneQuery";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../../test/helpers/containerParentLaneQuery";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { linkEncryptedColdDocument } from "../../../test/helpers/linkEncryptedColdDocument";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { routeApp } from "../../routeApp";
import { resolveContainerAccessProjectionBatch } from "../../workflows/containers/writerProjection";
import { resolveReadableDocumentAccess } from "../../workflows/keyingReadAccess";

async function counted<T>(work: () => Promise<T>) {
  const counter = { statements: 0 };
  const result = await withDatabaseStatementCounter(counter, work);
  return { result, statements: counter.statements };
}

/** root -> a -> b -> c and root -> d -> e: six containers, depth up to 3. */
async function createContainerForest() {
  const tree = await createOwnedTree(0);
  const a = await tree.createChild(tree.rootId);
  const b = await tree.createChild(a);
  const c = await tree.createChild(b);
  const d = await tree.createChild(tree.rootId);
  const e = await tree.createChild(d);
  return { a, b, c, d, e, tree };
}

test("the batch container access walk stays within its statement budget", async () => {
  const { a, b, c, d, e, tree } = await createContainerForest();
  try {
    const unknownId = crypto.randomUUID();
    const containerIds = [tree.rootId, a, b, c, d, e];
    const resolve = () =>
      counted(() =>
        resolveContainerAccessProjectionBatch({
          containerIds: [...containerIds, unknownId],
          executor: db,
          minimumAccessLevel: "read",
          userId: tree.owner.userId,
        }),
      );
    // Warm the process-wide verification markers the first walk records.
    await resolve();
    const batch = await resolve();
    for (const containerId of containerIds) {
      expect(batch.result.get(containerId)?.status).toBe("fulfilled");
    }
    const missing = batch.result.get(unknownId);
    expect(missing?.status === "rejected" && missing.reason.status).toBe(404);

    // Measured with PGlite / SQLite: 26 / 26 while each path container read
    // its row, head, and bundle serially; 11 / 11 once the walk set-loads them
    // per path level (the unknown id still costs one re-read for its 404).
    console.info("batch-access", batch.statements);
    expect(batch.statements).toBeLessThanOrEqual(9);
  } finally {
    tree.close();
  }
}, 180_000);

test("POST /containers/documents/query stays within its statement budget", async () => {
  const { a, b, d, e, tree } = await createContainerForest();
  try {
    const createdByFingerprint = await toFingerprint(
      tree.owner.signing.signingPublicKey,
    );
    const linkSets = [[a, d], [b, e], [a], [d, e], [b]];
    for (const containerIds of linkSets) {
      await createCurrentDocumentProjection({
        containerIds,
        createdByFingerprint,
        organizationId: tree.organizationId,
      });
    }
    const query = (containerIds: readonly string[]) =>
      counted(async () =>
        readContainerDocumentLaneResults(
          await routeApp.request("/containers/documents/query", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tree.owner.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              lanes: containerIds.map((containerId, index) => ({
                containerId,
                laneId: `lane-${index}`,
                watermark: null,
              })),
            }),
          }),
        ),
      );
    // Warm the process-wide verification markers the first listing records.
    await query([a, b, d, e]);

    const oneLane = await query([a]);
    const fourLanes = await query([a, b, d, e]);
    for (const result of [...oneLane.result, ...fourLanes.result]) {
      expect("page" in result).toBe(true);
    }
    expect(
      fourLanes.result.map((result) =>
        "page" in result ? result.page.items.length : -1,
      ),
    ).toEqual([2, 2, 2, 2]);

    console.info("document-lanes", {
      one: oneLane.statements,
      four: fourLanes.statements,
    });
    expect(oneLane.statements).toBeLessThanOrEqual(10);
    expect(fourLanes.statements).toBeLessThanOrEqual(18);
  } finally {
    tree.close();
  }
}, 180_000);

test("parent listing lanes share verified policies within one request", async () => {
  const { a, b, tree } = await createContainerForest();
  try {
    const lanes = [tree.rootId, a, b].map((parentId) => ({
      laneId: parentId,
      parentId,
    }));
    const query = (selected: typeof lanes) =>
      counted(async () => {
        const response = await requestContainerParentLanes(
          tree.owner.token,
          selected,
        );
        expect(response.status).toBe(200);
        return Promise.all(
          selected.map((lane) =>
            readContainerParentLanePage(response.clone(), lane.laneId),
          ),
        );
      });
    await query(lanes);
    const singles = [];
    for (const lane of lanes) singles.push(await query([lane]));
    const batch = await query(lanes);
    expect(batch.result).toEqual(singles.flatMap((single) => single.result));
    expect(batch.result.map((page) => page.items.length)).toEqual([2, 1, 1]);
    const singleStatements = singles.reduce(
      (sum, single) => sum + single.statements,
      0,
    );
    console.info("parent-lanes", {
      singles: singleStatements,
      batch: batch.statements,
    });
    // Current PostgreSQL baseline: 33 separate / 31 batched statements.
    // Bound the whole request, not savings from now-cheaper singular paths.
    expect(singleStatements).toBeLessThanOrEqual(27);
    expect(batch.statements).toBeLessThanOrEqual(19);
  } finally {
    tree.close();
  }
}, 180_000);

test("readable document access over linked containers stays within its statement budget", async () => {
  const { a, d, e, tree } = await createContainerForest();
  const context = await createAncestorSdkContext(
    tree.owner,
    tree.organizationId,
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => routeApp.fetch(request),
  });
  try {
    const apiClient = new ApiClient(server.url.origin);
    apiClient.setAuthToken(tree.owner.token);
    const created = await createEncryptedColdDocument({
      containerId: a,
      organizationId: tree.organizationId,
      owner: tree.owner,
    });
    for (const targetContainerId of [d, e]) {
      await linkEncryptedColdDocument({
        apiClient,
        context,
        documentId: created.documentId,
        owner: tree.owner,
        targetContainerId,
      });
    }
    const resolve = () =>
      counted(() =>
        resolveReadableDocumentAccess({
          documentId: created.documentId,
          executor: db,
          userId: tree.owner.userId,
        }),
      );
    await resolve();
    const access = await resolve();
    expect(access.result.linkedContainerIds).toEqual([a, d, e].sort());

    // Measured with PGlite / SQLite: 33 / 33 while each linked container was
    // resolved alone with its own policy load; 13 / 13 as one batch.
    console.info("document-access", access.statements);
    expect(access.statements).toBeLessThanOrEqual(11);
  } finally {
    await server.stop(true);
    context.close();
    tree.close();
  }
}, 180_000);
