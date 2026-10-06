import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { isProjectionVerificationCancelledError } from "../data/keyingProjectionVerification/types";
import { readPrincipalHistoryProtection } from "../data/principals/principalHistoryRuntime";
import {
  createContainerContentsDocumentsRuntime,
  createContainerContentsStoreWorkflowRuntime,
} from "../workflows/container-contents/runtime";
import { createDocumentsWorkflowRuntime } from "../workflows/documents/runtime";
import { Tearleads } from "./Tearleads";
import {
  createRuntime,
  type InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

type Adapter = "direct" | "containers" | "documents" | "container-documents";
function adaptedLease(input: InternalWorkflowRuntimeInput, adapter: Adapter) {
  const containers = () =>
    createContainerContentsStoreWorkflowRuntime(input, () => false);
  const runtime =
    adapter === "direct"
      ? input
      : adapter === "documents"
        ? createDocumentsWorkflowRuntime(input)
        : adapter === "containers"
          ? containers()
          : createContainerContentsDocumentsRuntime(containers(), null);
  if (adapter !== "direct")
    expect(runtime).not.toHaveProperty("withPrincipalHistoryProtection");
  return readPrincipalHistoryProtection(runtime);
}

test.each([
  "direct",
  "containers",
  "documents",
  "container-documents",
] as const)(
  "%s token refresh expires recovery while retaining the headless key",
  async (adapter) => {
    const sqlite = await createTestExecSql("principal-runtime-refresh");
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    try {
      sdk.database.configure({ execSql: sqlite.execSql, id: "test" });
      await setGeneratedIdentity(sdk.identity);
      sdk.session.setAuthToken("first-token");
      const runtime = createRuntime({
        api: new ApiClient("https://api.example.test"),
        blobs: sdk.blobs,
        database: sdk.database,
        documentProjectors: defaultDocumentProjectorRegistry,
        events: sdk.events,
        getDomainScope: () => sdk.domainScope,
        identity: sdk.identity,
        identityTrustDomain: "https://api.example.test",
        log: quietLogger.log,
        logError: quietLogger.logError,
        network: sdk.network,
        reportSecurityIncident: async () => {},
        session: sdk.session,
      });
      const first = adaptedLease(runtime.workflowInput(), adapter);
      if (!first) throw new Error("Missing initial lease");
      const key = await first(
        async ({ protection }) => new Uint8Array(protection.localKey),
      );
      sdk.session.setAuthToken("refreshed-token");
      const error = await first(async () => "stale").catch(
        (error: unknown) => error,
      );
      expect(isProjectionVerificationCancelledError(error)).toBe(true);
      const second = adaptedLease(runtime.workflowInput(), adapter);
      if (!second) throw new Error("Missing refreshed lease");
      expect(
        await second(
          async ({ protection }) => new Uint8Array(protection.localKey),
        ),
      ).toEqual(key);
      runtime.retirePrincipalHistoryProtection();
    } finally {
      sdk.dispose();
      sqlite.close();
    }
  },
);

test.each(["database", "identity", "session", "retirement"] as const)(
  "runtime protection observes %s changes while a host key is pending",
  async (change) => {
    const sqlite = await createTestExecSql("principal-runtime-key");
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    try {
      sdk.database.configure({ execSql: sqlite.execSql, id: "test" });
      await setGeneratedIdentity(sdk.identity);
      const pending = Promise.withResolvers<Uint8Array>();
      const runtime = createRuntime({
        api: new ApiClient("https://api.example.test"),
        blobs: sdk.blobs,
        database: sdk.database,
        documentProjectors: defaultDocumentProjectorRegistry,
        events: sdk.events,
        getDomainScope: () => sdk.domainScope,
        identity: sdk.identity,
        identityTrustDomain: "https://api.example.test",
        log: quietLogger.log,
        logError: quietLogger.logError,
        network: sdk.network,
        principalHistoryKeyProvider: () => pending.promise,
        reportSecurityIncident: async () => {},
        session: sdk.session,
      });
      const lease = runtime.workflowInput().withPrincipalHistoryProtection;
      if (!lease) throw new Error("Missing runtime protection");
      expect(runtime.publicRuntime.input()).not.toHaveProperty(
        "withPrincipalHistoryProtection",
      );
      let called = false;
      const result = lease(async () => {
        called = true;
      });
      if (change === "database") {
        // Returning to the same database must not revive the old operation.
        sdk.database.clear();
        sdk.database.configure({ execSql: sqlite.execSql, id: "test" });
      }
      if (change === "identity") await setGeneratedIdentity(sdk.identity);
      if (change === "session") sdk.session.setOrganizationId("another-org");
      if (change === "retirement") runtime.retirePrincipalHistoryProtection();
      const key = new Uint8Array(32).fill(9);
      pending.resolve(key);
      const error = await result.then(
        () => null,
        (error: unknown) => error,
      );
      expect(isProjectionVerificationCancelledError(error)).toBe(true);
      expect(called).toBe(false);
      expect(key).toEqual(new Uint8Array(32));
    } finally {
      sdk.dispose();
      sqlite.close();
    }
  },
);
