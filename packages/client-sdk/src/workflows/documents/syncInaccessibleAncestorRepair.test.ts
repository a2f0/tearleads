import { expect, test } from "bun:test";
import { unwrapContainerKekParentWrap } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { writerKeyResolver } from "../../../test/helpers/documentFixtures";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
} from "../../../test/helpers/documentResponseFixtures";
import { createInaccessibleStaleIntermediateFixture } from "../../../test/helpers/inaccessibleStaleIntermediate";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import { ContainerKekRepairInaccessibleError } from "../../data/documents/shared/containerKekCurrency";
import { unwrapContainerKekPath } from "../../data/documents/shared/containerKekPath";
import { normalizeContainerKeyWrap } from "../../data/documents/shared/readers";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
import { syncRemoteDocument } from "./sync";
import { buildAutomaticContainerRekeys } from "./syncAutomaticContainerRekeys";
import { applyContainerRekeyPlan } from "./syncContainerRekeyProjection";
import { buildRemoteDocumentSyncPlan } from "./syncContainerRekeys";
import { DOCUMENT_SYNC_TRACE_PATTERN } from "./syncTrace";

type Fixture = Awaited<
  ReturnType<typeof createInaccessibleStaleIntermediateFixture>
>;

async function createLeafDocumentProjection(fixture: Fixture) {
  const staging = await createTestExecSql("inaccessible-intermediate-document");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.ownerInput,
      execSql: staging.execSql,
      containerProjection: fixture.currentLeaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.currentLeaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    return { ...original, authorizingContainerPaths: [fixture.staleLeaf] };
  } finally {
    staging.close();
  }
}

function leafWriterInput(
  fixture: Fixture,
  execSql: Fixture["ownerInput"]["execSql"],
) {
  return {
    author: fixture.peer.author,
    execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.peerSecretKey,
  };
}

// #2340 finding 1. The writer's only grant is on the leaf, and the stale
// container is the intermediate above it. Before this was typed, the planner's
// untyped unwrap failure escaped every classifier and crashed the sync lane,
// which re-armed once a second forever and recorded nothing.

test("a writer below an inaccessible stale intermediate parks its writes", async () => {
  const fixture = await createInaccessibleStaleIntermediateFixture();
  const projection = await createLeafDocumentProjection(fixture);
  const database = await createTestExecSql("inaccessible-intermediate-writer");
  try {
    const abandoned: string[] = [];
    const evicted: string[] = [];
    const rekeyed: string[] = [];
    const submitted: string[] = [];
    const terminal: Array<{
      code?: string | undefined;
      status: number | null;
    }> = [];
    const traced: string[] = [];
    let refetches = 0;
    const result = await syncRemoteDocument({
      ...leafWriterInput(fixture, database.execSql),
      apiClient: createMockApiClient({
        evictDocumentWriterProjection: (documentId) => {
          evicted.push(documentId);
        },
        // Nobody has repaired the intermediate yet: the refetch is as stale.
        getDocumentWriterProjection: async () => {
          refetches += 1;
          return projection;
        },
        rekeyContainer: async (containerId) => {
          rekeyed.push(containerId);
          return null;
        },
        syncDocument: async (documentId) => {
          submitted.push(documentId);
          return null;
        },
      }),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      localVersionVector: null,
      onSyncAbandoned: (reason: string) => abandoned.push(reason),
      onSyncTrace: (line: string) => traced.push(line),
      onTerminalSubmitFailure: (failure) => {
        terminal.push({ code: failure.code, status: failure.status });
      },
      pendingUpdates: [createPendingUpdateRecord()],
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
      writerProjection: projection,
    });
    expect(result).toBeNull();
    // One refetch, in case a capable member already repaired the chain.
    expect(evicted).toEqual([projection.documentId]);
    expect(refetches).toBe(1);
    expect(abandoned).toEqual(["inaccessible"]);
    expect(terminal).toEqual([
      { code: "document_ancestor_repair_inaccessible", status: null },
    ]);
    const abandonLines = traced.filter((line) =>
      line.includes("ancestor repair abandoned"),
    );
    expect(abandonLines).toHaveLength(1);
    expect(abandonLines[0]).toMatch(DOCUMENT_SYNC_TRACE_PATTERN);
    expect(abandonLines[0]).toContain("reason=inaccessible");
    // Fail closed: no repair is attempted on the writer's behalf and nothing is
    // encrypted or submitted under the stale chain.
    expect(rekeyed).toEqual([]);
    expect(submitted).toEqual([]);
  } finally {
    database.close();
  }
}, 120_000);

test("the planner names the container the writer cannot repair", async () => {
  const fixture = await createInaccessibleStaleIntermediateFixture();
  const projection = await createLeafDocumentProjection(fixture);
  const database = await createTestExecSql("inaccessible-intermediate-planner");
  try {
    const sync = {
      ...leafWriterInput(fixture, database.execSql),
      apiClient: createMockApiClient(),
      documentId: projection.documentId,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    const failure = await buildAutomaticContainerRekeys(sync, projection).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ContainerKekRepairInaccessibleError);
    expect(Reflect.get(failure ?? {}, "containerId")).toBe("intermediate");
  } finally {
    database.close();
  }
}, 120_000);

// Once a member with access repairs the intermediate, the leaf is stale
// directly below a *current* parent, which is the case public parent wrapping
// (#2334) already lets a leaf-only writer repair on its own.

test("the writer repairs its own leaf once the intermediate is repaired", async () => {
  const fixture = await createInaccessibleStaleIntermediateFixture();
  const projection = await createLeafDocumentProjection(fixture);
  const owner = await createTestExecSql("inaccessible-intermediate-repairer");
  const database = await createTestExecSql("inaccessible-intermediate-resumed");
  try {
    const ownerRepair = await buildMaterializedContainerRekeyPlan({
      ...fixture.ownerInput,
      execSql: owner.execSql,
      previousProjection: {
        ...fixture.intermediate.projection,
        path: fixture.staleLeaf.path.slice(0, 2),
        containerKeks: fixture.staleLeaf.containerKeks.slice(0, 2),
      },
    });
    const repaired = await applyContainerRekeyPlan(projection, ownerRepair);
    const writer = leafWriterInput(fixture, database.execSql);
    const write = await buildRemoteDocumentSyncPlan({
      pendingUpdates: [createPendingUpdateRecord()],
      projection: repaired,
      regenerateQueuedCheckpoints: false,
      sync: {
        ...writer,
        apiClient: createMockApiClient(),
        buildRotationSnapshot: createFullHistoryRotationSnapshot,
        documentId: projection.documentId,
        localVersionVector: null,
        resolveWriterPublicKey: writerKeyResolver(fixture.root),
        validateIncomingUpdates: () => undefined,
      },
    });
    const repairs = write.plan.request.containerRekeys ?? [];
    expect(repairs).toHaveLength(1);
    const [leafRepair] = repairs;
    if (!leafRepair?.keyEpoch)
      throw new Error("Expected the leaf repair epoch");
    expect(Reflect.get(leafRepair.event, "objectId")).toBe("leaf");
    expect(Reflect.get(leafRepair.keyEpoch, "parentContainerKeyEpochId")).toBe(
      ownerRepair.plan.containerKeyEpochId,
    );
    expect(
      write.plan.request.contentKeyBundle?.targets[0]?.containerKeyEpochId,
    ).toBe(String(Reflect.get(leafRepair.keyEpoch, "id")));

    // The writer got there without either ancestor's secret...
    const writerKeys = await unwrapContainerKekPath({
      ...writer,
      projection: repaired.authorizingContainerPaths[0] ?? fixture.staleLeaf,
      secretKey: fixture.peerSecretKey,
    });
    expect(writerKeys.has(fixture.intermediate.epochId)).toBe(false);
    expect(writerKeys.has(ownerRepair.plan.containerKeyEpochId)).toBe(false);
    expect(writerKeys.has(fixture.rotatedRoot.plan.containerKeyEpochId)).toBe(
      false,
    );
    // ...and the retired intermediate key, which a revoked root member could
    // still reach, does not open the repaired leaf.
    const parentWrap = (leafRepair.wraps ?? [])
      .map(normalizeContainerKeyWrap)
      .find((wrap) => wrap.recipientKind === "container");
    if (!parentWrap) throw new Error("Expected a parent recipient wrap");
    await expect(
      unwrapContainerKekParentWrap({
        ...parentWrap,
        parentContainerId: "intermediate",
        parentKeyMaterial: fixture.intermediate.key,
      }),
    ).rejects.toThrow();
  } finally {
    owner.close();
    database.close();
  }
}, 120_000);
