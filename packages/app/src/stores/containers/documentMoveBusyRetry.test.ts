import { afterEach, expect, test } from "bun:test";
import {
  getOrCreateDomainSyncCoordinator,
  type SyncLaneConfig,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "@testing-library/react";
import { createHeadlessApiClient } from "../../../test/helpers/headlessApiClient";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../test/helpers/mswServer";

afterEach(resetMockServer);

test.each([
  false,
  true,
])("a queued move recovers beside a held autosave (same context: %s)", async (sameContext) => {
  useTestApiAppHandlers();
  const db = await createTestExecSql("document-move-busy-retry");
  let replayPaused = sameContext;
  const delayedDiscovery = new Proxy(db.execSql, {
    apply: async (target, _receiver, args: Parameters<ExecSql>) => {
      const rows = await target(...args);
      // Keep the durable move undiscovered while its destination-scoped edit
      // starts. The retry must then wake itself after that held edit settles.
      return replayPaused &&
        args[0].startsWith("select") &&
        args[0].includes('from "document_move_intents"')
        ? []
        : rows;
    },
  });
  const sdk = await createHeadlessApiClient(
    delayedDiscovery,
    "move-busy-retry",
  );
  const coordinator = getOrCreateDomainSyncCoordinator(
    sdk.runtime.input().state.domainScope,
  );
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const previousFetch = globalThis.fetch;
  const registerLane = coordinator.registerLane;
  const captured: { config: SyncLaneConfig | null } = { config: null };
  const localId = crypto.randomUUID();
  const laneKey = `documents:${localId}`;
  let held = false;
  try {
    const tree = sdk.containerContents.openTree();
    tree.updateRuntime(sdk.containerContents.workflowRuntime());
    await waitFor(() => expect(tree.getSnapshot().ready).toBe(true));
    const rootId = sdk.session.containerId;
    if (!rootId) throw new Error("Missing registered root");
    const target = await tree.createChild(rootId, "Destination");
    if (!target) throw new Error("Target creation failed");
    coordinator.registerLane = (key, config) => {
      if (key === laneKey) captured.config = config;
      return registerLane(key, config);
    };
    const note = sdk.documents.open({ containerId: rootId, localId });
    await note.setText("Before move");
    coordinator.registerLane = registerLane;
    expect(await coordinator.waitForIdle({ timeoutMs: 10_000 })).toBe(true);
    const documentId = note.getSnapshot().documentId;
    if (!documentId || !captured.config) {
      throw new Error("Document did not establish its sync lane");
    }
    const queueMove = async () => {
      const summary = (await sdk.documents.list())?.rows.find(
        (row) => row.id === localId,
      );
      if (!summary) throw new Error("Saved note is missing");
      const moved = await sdk.containerContents
        .documentLinks()
        .moveDocumentToContainer({
          expandNode: () => undefined,
          mergeDocumentSummary: () => undefined,
          note: summary,
          setLinkedContainerIdsForDocument: () => undefined,
          sourceContainerId: rootId,
          targetContainerId: target.id,
        });
      expect(moved.note?.containerId).toBe(target.id);
    };
    if (sameContext) {
      await queueMove();
      expect(await coordinator.waitForIdle({ timeoutMs: 10_000 })).toBe(true);
    }
    registerLane(laneKey, { ...captured.config, watchdogMs: 20 });
    globalThis.fetch = (async (input, init) => {
      const response = await previousFetch(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (!held && new URL(url).pathname === `/documents/${documentId}/sync`) {
        held = true;
        started.resolve();
        await release.promise;
      }
      return response;
    }) as typeof fetch;
    await note.setText("Edited during move");
    await started.promise;
    await waitFor(() =>
      expect(
        coordinator.getSnapshot().lanes.find((lane) => lane.key === laneKey)
          ?.runAbandoned,
      ).toBe(true),
    );
    registerLane(laneKey, captured.config);
    if (sameContext) {
      replayPaused = false;
      tree.requestSync();
    } else {
      await queueMove();
    }
    if (sameContext) {
      await waitFor(async () => {
        const rows = await db.execSql(
          'select "last_error" from "document_move_intents" where "document_id" = ?',
          [documentId],
        );
        expect(rows).toEqual([
          {
            last_error:
              "Failed to sync document move: Document remote work is still running; retry the operation",
          },
        ]);
      });
    }
    const waitForMove = () =>
      waitFor(
        async () =>
          expect(
            await db.execSql(
              'select "id" from "document_move_intents" where "document_id" = ?',
              [documentId],
            ),
          ).toEqual([]),
        { timeout: 15_000 },
      );
    if (!sameContext) await waitForMove();
    release.resolve();
    await waitForMove();
    expect(await coordinator.waitForIdle({ timeoutMs: 10_000 })).toBe(true);
    expect(note.getSnapshot().text).toBe("Edited during move");
    const mutations = listProxiedApiRequests()
      .filter(
        (request) =>
          request.method === "POST" &&
          request.status === 200 &&
          new URL(request.url).pathname.startsWith(`/documents/${documentId}/`),
      )
      .map((request) => new URL(request.url).pathname);
    expect(mutations).toContain(`/documents/${documentId}/link`);
    expect(mutations).toContain(`/documents/${documentId}/unlink`);
    expect(
      (await sdk.documents.list())?.rows.find((row) => row.id === localId)
        ?.containerId,
    ).toBe(target.id);
  } finally {
    replayPaused = false;
    release.resolve();
    globalThis.fetch = previousFetch;
    coordinator.registerLane = registerLane;
    await coordinator.waitForIdle({ timeoutMs: 2_000 });
    sdk.dispose();
    db.close();
  }
}, 30_000);
