import { afterEach, expect, test } from "bun:test";
import {
  createContainerContentsStoreState,
  createContainerContentsStoreSyncAgent,
  createContainerContentsStoreWorkflowRuntime,
  defaultContainerContentsPersistence,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHeadlessApiClient } from "../../../test/helpers/headlessApiClient";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../test/helpers/mswServer";

afterEach(resetMockServer);

test("Explorer retries signed hydration after private and public policy pages recover", async () => {
  useTestApiAppHandlers();
  const ownerDb = await createTestExecSql("explorer-policy-owner");
  const coldDb = await createTestExecSql("explorer-policy-cold");
  const sdk = await createHeadlessApiClient(ownerDb.execSql, "policy-owner");
  const base = sdk.containerContents.workflowRuntime();
  let unavailable = true;
  let privateAttempts = 0;
  let publicAttempts = 0;
  let fullReads = 0;
  let snapshots = 0;
  const incidents: unknown[] = [];
  const keys: Uint8Array[] = [];
  const readPrivate = async function* (
    ...args: Parameters<typeof base.apiClient.getPrincipalPolicyPages>
  ) {
    privateAttempts += 1;
    if (unavailable) throw new Error("temporary private policy page failure");
    yield* base.apiClient.getPrincipalPolicyPages(...args);
  };
  const readPublic = async function* (
    ...args: Parameters<typeof base.apiClient.getProjectionPolicyHistoryPages>
  ) {
    publicAttempts += 1;
    if (unavailable) throw new Error("temporary public policy page failure");
    yield* base.apiClient.getProjectionPolicyHistoryPages(...args);
  };
  const apiClient = new Proxy(base.apiClient, {
    get(target, property) {
      if (property === "getPrincipalPolicyPages") return readPrivate;
      if (property === "getProjectionPolicyHistoryPages") return readPublic;
      if (property === "getCurrentPrincipalPolicy")
        return async () => {
          fullReads += 1;
          throw new Error("Full principal history is forbidden");
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const listing = await base.apiClient.listContainerParentLanes({
      lanes: [{ laneId: "roots", parentId: null, watermark: null }],
    });
    const root = listing?.results[0]?.page.items.find(
      (item) => item.id === sdk.session.containerId,
    );
    if (!root) throw new Error("Registered root was not listed");
    expect(root.metadataReferencedPrincipals.length).toBeGreaterThan(0);
    const runtime = createContainerContentsStoreWorkflowRuntime(
      {
        ...base,
        apiClient,
        infra: { ...base.infra, execSql: coldDb.execSql },
        util: {
          ...base.util,
          reportSecurityIncident: async (incident) => {
            incidents.push(incident);
          },
        },
        withPrincipalHistoryProtection: async (work) => {
          const localKey = new Uint8Array(32).fill(29);
          keys.push(localKey);
          try {
            return await work({
              protection: { localKey, context: "explorer-paged-recovery" },
              stillCurrent: () => true,
            });
          } finally {
            localKey.fill(0);
          }
        },
      },
      () => false,
    );
    const persistence = defaultContainerContentsPersistence;
    await persistence.ensureSchema(coldDb.execSql);
    const state = createContainerContentsStoreState(runtime, persistence);
    state.documentStoresNeedPriming = false;
    state.snapshot = { ...state.snapshot, ready: true };
    const agent = createContainerContentsStoreSyncAgent({
      state,
      host: {
        persistContainerState: async (container, _patch, _update, options) => {
          await persistence.saveContainer(
            coldDb.execSql,
            container.container,
            container.record,
            options,
          );
          return { record: container.record, status: "persisted" };
        },
        updateSnapshot: () => {
          snapshots += 1;
        },
      },
    });
    await expect(agent.ingestRemoteContainer(root)).rejects.toThrow(
      "temporary public policy page failure",
    );
    expect(privateAttempts).toBeGreaterThan(0);
    expect(publicAttempts).toBeGreaterThan(0);
    expect(state.containersById.size).toBe(0);
    expect(snapshots).toBe(0);
    const failedPrivate = privateAttempts;
    const failedPublic = publicAttempts;
    unavailable = false;
    await agent.ingestRemoteContainer(root);
    expect(privateAttempts).toBeGreaterThan(failedPrivate);
    expect(publicAttempts).toBeGreaterThan(failedPublic);
    expect(state.containersById.has(root.id)).toBe(true);
    expect(snapshots).toBe(1);
    expect(fullReads).toBe(0);
    expect(incidents).toEqual([]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
  } finally {
    sdk.dispose();
    coldDb.close();
    ownerDb.close();
  }
}, 30_000);
