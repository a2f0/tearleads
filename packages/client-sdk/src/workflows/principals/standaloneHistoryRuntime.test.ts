import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { createPublicProjectionHistoryFixture } from "../../../test/helpers/publicProjectionHistory";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import {
  createContainerContentsDocumentsRuntime,
  createContainerContentsStoreWorkflowRuntime,
  createContainerContentsWorkflowRuntime,
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  type PrincipalHistoryProtectionLease,
} from "../../index";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

test("standalone runtime inputs carry private history custody through every public adapter", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await createPublicProjectionHistoryFixture(history);
  let current = true;
  let leases = 0;
  let fullReads = 0;
  const lease: PrincipalHistoryProtectionLease = (operation) => {
    leases += 1;
    return operation({
      protection: f.options.protection,
      stillCurrent: () => current,
    });
  };
  const api = new ApiClient("https://standalone.example.test");
  api.getProjectionPolicyHistoryPages =
    f.options.apiClient.getProjectionPolicyHistoryPages.bind(
      f.options.apiClient,
    );
  api.getCurrentPrincipalPolicy = async () => {
    fullReads += 1;
    return null;
  };
  const host: DocumentsWorkflowRuntimeInput = {
    apiClient: api,
    auth: {
      isAuthenticated: true,
      userId: history.directory.currentState.signerUserId,
      organizationId: history.organizationId,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: f.options.execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: { log() {}, logError() {}, reportSecurityIncident: async () => {} },
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
  };
  try {
    const documents = createDocumentsWorkflowRuntime({
      ...host,
      withPrincipalHistoryProtection: lease,
    });
    const contents = createContainerContentsWorkflowRuntime({
      ...host,
      withPrincipalHistoryProtection: lease,
    });
    const store = createContainerContentsStoreWorkflowRuntime(
      { ...host, withPrincipalHistoryProtection: lease },
      () => false,
    );
    const runtimes = [
      documents,
      contents,
      store,
      createContainerContentsDocumentsRuntime(contents, "document"),
      createContainerContentsDocumentsRuntime(store, "document"),
    ];
    for (const runtime of runtimes) {
      expect(
        Reflect.get(runtime, "withPrincipalHistoryProtection"),
      ).toBeUndefined();
      const resolve =
        createRuntimePrincipalPolicyWarmer(runtime).resolveProjectionHistory;
      if (!resolve)
        throw new Error("Standalone runtime lost its history resolver");
      const result = await resolve(f.options);
      expect(result.policies).toHaveLength(3);
      expect(result.stillCurrent()).toBe(true);
      current = false;
      expect(result.stillCurrent()).toBe(false);
      const expired = await resolve(f.options).catch((error: unknown) => error);
      expect(isProjectionVerificationCancelledError(expired)).toBe(true);
      current = true;
    }
    expect(leases).toBe(10);
    expect(fullReads).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);
