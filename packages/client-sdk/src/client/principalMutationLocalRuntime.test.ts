import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { didContainerWriteRuntimeChange } from "../stores/container-contents/writeGeneration";
import { createContainerContentsStoreWorkflowRuntime } from "../workflows/container-contents/runtime";
import { Tearleads } from "./Tearleads";
import { createRuntime } from "./workflowRuntime";

test("signed-out runtime reads and network notifications preserve local write custody", async () => {
  const sqlite = await createTestExecSql("journal-local-runtime");
  const api = new ApiClient("https://local.example.test");
  const sdk = new Tearleads({
    apiBaseUrl: "https://local.example.test",
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  try {
    sdk.database.configure({ execSql: sqlite.execSql, id: "local" });
    const runtime = createRuntime({
      api,
      blobs: sdk.blobs,
      database: sdk.database,
      documentProjectors: defaultDocumentProjectorRegistry,
      events: sdk.events,
      getDomainScope: () => sdk.domainScope,
      identity: sdk.identity,
      identityTrustDomain: "https://local.example.test",
      log: quietLogger.log,
      logError: quietLogger.logError,
      network: sdk.network,
      reportSecurityIncident: async () => {},
      session: sdk.session,
    });
    const read = () =>
      createContainerContentsStoreWorkflowRuntime(
        runtime.workflowInput(),
        runtime.adoptRootContainer,
      );
    const initial = read();
    expect(didContainerWriteRuntimeChange(initial, read())).toBe(false);
    sdk.network.setOnline(false);
    const offline = read();
    expect(offline.state.online).toBe(false);
    expect(didContainerWriteRuntimeChange(initial, offline)).toBe(false);
    sdk.network.setOnline(true);
    expect(didContainerWriteRuntimeChange(initial, read())).toBe(false);
    expect(
      await runtime
        .workflowInput()
        .apiClient.readPendingPrincipalMutation("local-organization"),
    ).toBeNull();
    runtime.retirePrincipalHistoryProtection();
  } finally {
    sdk.dispose();
    sqlite.close();
  }
});
