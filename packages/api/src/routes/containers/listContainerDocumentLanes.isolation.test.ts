import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  readContainerDocumentLaneResults,
  requestContainerDocumentLanes,
} from "../../../test/helpers/containerDocumentLaneQuery";
import { createReciteScenario } from "../../../test/helpers/containerRecite";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { ContainerWriterProjectionError } from "../../workflows/containers/writerProjection/types";
import * as keyingReadAccess from "../../workflows/keyingReadAccess";
import { KeyingReadAccessError } from "../../workflows/keyingReadAccess";

async function organizationIdOf(containerId: string): Promise<string> {
  const [row] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  invariant(row, "expected container row");
  return row.organizationId;
}

/**
 * A document listed in `child` is also linked into `root`. Resolving that
 * secondary link fails with `failure` only while listing the `child` lane;
 * the `root` lane resolves its own secondary link (`child`) normally.
 */
async function listWithSecondaryLinkFailure(failure: Error) {
  const { owner, root, child } = await createReciteScenario();
  const rootId = root.kekState.containerId;
  const document = await createCurrentDocumentProjection({
    containerIds: [child.containerId, rootId],
    createdByFingerprint: `test-fingerprint:${crypto.randomUUID()}`,
    organizationId: await organizationIdOf(rootId),
  });
  const resolveBatch = keyingReadAccess.resolveReadableContainerAccessBatch;
  const spy = spyOn(
    keyingReadAccess,
    "resolveReadableContainerAccessBatch",
  ).mockImplementation(async (input) => {
    if (!input.containerIds.includes(rootId)) return resolveBatch(input);
    if (!(failure instanceof KeyingReadAccessError)) throw failure;
    return new Map(
      input.containerIds.map((containerId) => [
        containerId,
        { reason: failure, status: "rejected" as const },
      ]),
    );
  });
  try {
    const response = await requestContainerDocumentLanes(owner.token, [
      { containerId: rootId, laneId: "healthy" },
      { containerId: child.containerId, laneId: "conflicted" },
    ]);
    return { document, response };
  } finally {
    spy.mockRestore();
  }
}

test("a secondary link conflict fails only its own lane", async () => {
  const { document, response } = await listWithSecondaryLinkFailure(
    new KeyingReadAccessError("Container KEK missing", 409),
  );

  const [healthy, conflicted] =
    await readContainerDocumentLaneResults(response);
  invariant(healthy && "page" in healthy, "expected the healthy lane to list");
  expect(healthy.page.items.map((item) => item.id)).toEqual([document.id]);
  // No absence code: the lane's own container exists; a link it cites conflicts.
  expect(conflicted).toEqual({
    failure: { error: "Container KEK missing", status: 409 },
    laneId: "conflicted",
  });
}, 120_000);

test("an unconverted projection conflict fails only its own lane", async () => {
  const { response } = await listWithSecondaryLinkFailure(
    new ContainerWriterProjectionError("Container KEK missing", 409),
  );

  const [healthy, conflicted] =
    await readContainerDocumentLaneResults(response);
  expect(healthy && "page" in healthy).toBe(true);
  expect(conflicted).toEqual({
    failure: { error: "Container KEK missing", status: 409 },
    laneId: "conflicted",
  });
}, 120_000);

test("an unexpected lane error still fails the request", async () => {
  const { response } = await listWithSecondaryLinkFailure(
    new Error("unexpected"),
  );

  expect(response.status).toBe(500);
}, 120_000);
