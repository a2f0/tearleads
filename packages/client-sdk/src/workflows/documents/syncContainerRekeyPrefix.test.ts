import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
  MAX_INLINE_CONTAINER_REKEYS,
} from "@tearleads/validators/util";
import { createDeepRotatedAncestorFixture } from "../../../test/helpers/ancestorRotationRecovery";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import { writerKeyResolver } from "../../../test/helpers/documentFixtures";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
} from "../../../test/helpers/documentResponseFixtures";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
import { syncRemoteDocument } from "./sync";
import { prepareAutomaticContainerRekeys } from "./syncContainerRekeyPreparation";

test("a cold device can acknowledge repairs it commits through the prefix", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("deep-prefix-document");
  const cold = await createTestExecSql("cold-prefix-acknowledgement");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const committed: string[] = [];
    // Each container on the chain is repaired exactly once, so its pre-repair
    // KEK is the one the stale projection already carries.
    const previousKeks = new Map(
      fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
    );
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        rekeyContainer: async (containerId, request) => {
          committed.push(containerId);
          const previousKek = previousKeks.get(containerId);
          if (!previousKek) {
            throw new Error(`No pre-repair KEK for ${containerId}`);
          }
          return await createMutationResponseFromRequest(request, previousKek);
        },
      }),
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    // The mock serves no refreshed projection, so preparation stops after the
    // first prefix. What matters is how far it got: a full inline batch was
    // committed and every acknowledgement was accepted on a database holding no
    // prior pin for any of these ancestors. Without pinning the verified heads
    // first, the first acknowledgement rejects its own repair with
    // `stale_predecessor` after the server already committed it.
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toThrow(/abandoned: unrefreshable/);
    expect(committed).toHaveLength(MAX_INLINE_CONTAINER_REKEYS);
  } finally {
    staging.close();
    cold.close();
  }
}, 180_000);

// The planner signs repairs as the syncing identity. Adopting the path's own
// organization would leave resolveRotationContext comparing a server-supplied
// value against itself, so a path outside the author's organization is refused
// rather than absorbed.

test("a refused standalone repair abandons the pass", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("refused-prefix-document");
  const cold = await createTestExecSql("refused-prefix-repair");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const abandoned: string[] = [];
    const terminal: string[] = [];
    const traced: string[] = [];
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({ rekeyContainer: async () => null }),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      onSyncAbandoned: (reason: string) => abandoned.push(reason),
      onSyncTrace: (line: string) => traced.push(line),
      onTerminalSubmitFailure: (failure: { message: string }) => {
        terminal.push(failure.message);
      },
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    const result = await syncRemoteDocument({
      ...sync,
      pendingUpdates: [createPendingUpdateRecord()],
      writerProjection: projection,
    });
    expect(result).toBeNull();
    expect(abandoned).toEqual(["refused"]);
    expect(terminal).toEqual([]);
    // Production wires onSyncTrace, not onSyncAbandoned, so the trace is the
    // only way an abandoned repair is visible at all.
    expect(
      traced.filter((line) => line.includes("ancestor repair abandoned")),
    ).toHaveLength(1);
  } finally {
    staging.close();
    cold.close();
  }
}, 180_000);

// A document linked into two containers authorizes through both paths, which
// share one stale intermediate. Repairing that intermediate must replace it in
// every path: `replaceRekeyedPathNode` throws a hard predecessor mismatch if a
// path carries a different node, and the projection is the only place the two
// paths are reconciled. Exercised directly, since building a genuinely
// two-linked document needs a full link round-trip.

test("a refetched projection for another document is refused", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("swap-prefix-document");
  const cold = await createTestExecSql("swap-prefix-repair");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const previousKeks = new Map(
      fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
    );
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        getDocumentWriterProjectionResult: async () => ({
          data: { ...projection, documentId: "a-different-document" },
          ok: true as const,
        }),
        rekeyContainer: async (containerId, request) => {
          const previousKek = previousKeks.get(containerId);
          if (!previousKek) throw new Error(`No KEK for ${containerId}`);
          return await createMutationResponseFromRequest(request, previousKek);
        },
      }),
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    staging.close();
    cold.close();
  }
}, 180_000);

// A server that keeps answering with the same stale chain cannot drive endless
// signed rekeys. Pinning the verified heads before each prefix commit means the
// replay is refused as a rollback — an older manifest than the local checkpoint
// — which stops it well before the depth budget backstop is reached.

test("a server replaying a stale chain cannot drive endless rekeys", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("replayed-prefix-document");
  const cold = await createTestExecSql("replayed-prefix-repair");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const previousKeks = new Map(
      fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
    );
    let rekeys = 0;
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        // Always answers with the original stale chain, never the repairs.
        getDocumentWriterProjectionResult: async () => ({
          data: projection,
          ok: true as const,
        }),
        rekeyContainer: async (containerId, request) => {
          rekeys += 1;
          const previousKek = previousKeks.get(containerId);
          if (!previousKek) throw new Error(`No KEK for ${containerId}`);
          return await createMutationResponseFromRequest(request, previousKek);
        },
      }),
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toThrow(/older than the local checkpoint/);
    // Bounded well under the depth backstop: one prefix, then the replay is
    // refused rather than repaired again.
    expect(rekeys).toBeLessThanOrEqual(MAX_INLINE_CONTAINER_REKEYS);
    expect(rekeys).toBeLessThan(MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH);
  } finally {
    staging.close();
    cold.close();
  }
}, 300_000);

// A permanent refusal must leave a durable record so the queued writes show as
// blocked; a transient one must not, or an offline blip would report the
// document as permanently stuck. The status-bearing rekey is what separates
// them — plain rekeyContainer collapses both to null.

test.each([
  [403, 1],
  [503, 0],
])(
  "a %i refusal records %i terminal failures",
  async (status, expected) => {
    const fixture = await createDeepRotatedAncestorFixture(17);
    const staging = await createTestExecSql(`refusal-${status}-document`);
    const cold = await createTestExecSql(`refusal-${status}-repair`);
    try {
      const created = await buildMaterializedDocumentCreatePlan({
        ...fixture.input,
        execSql: staging.execSql,
        containerProjection: fixture.leaf,
      });
      const original = documentWriterProjectionFromCreateResponse({
        containerProjection: fixture.leaf,
        response: await createResponseFromRequest(created.plan.request),
      });
      const projection = {
        ...original,
        authorizingContainerPaths: [fixture.projection],
      };
      const terminal: (number | null)[] = [];
      const sync = {
        ...fixture.input,
        apiClient: createMockApiClient({
          rekeyContainerResult: async () => ({
            kind: "http" as const,
            message: `refused ${status}`,
            method: "POST" as const,
            ok: false as const,
            path: "/containers/x/rekey",
            report: () => undefined,
            status,
            statusText: "refused",
          }),
        }),
        buildRotationSnapshot: createFullHistoryRotationSnapshot,
        documentId: projection.documentId,
        execSql: cold.execSql,
        localVersionVector: null,
        onTerminalSubmitFailure: (failure: { status: number | null }) => {
          terminal.push(failure.status);
        },
        resolveWriterPublicKey: writerKeyResolver(fixture.root),
        validateIncomingUpdates: () => undefined,
      };
      await expect(
        prepareAutomaticContainerRekeys(sync, projection),
      ).rejects.toThrow(/abandoned: refused/);
      expect(terminal).toHaveLength(expected);
    } finally {
      staging.close();
      cold.close();
    }
  },
  180_000,
);
