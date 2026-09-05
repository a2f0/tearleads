import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { Tearleads } from "../Tearleads";
import { createRuntime } from "../workflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";

test("organization mutations cannot outlive their session, identity, or database scope", () => {
  const original = createWorkflowInputFixture({
    apiClient: createMockApiClient(),
    auth: { organizationId: "org", userId: "owner" },
    execSql: createExecSql({ exec: async () => ({ rows: [] }) }),
  });
  let current = original;
  const captured = currentOrganizationMutation({
    sessionGeneration: 0,
    workflowInput: () => current,
  });
  expect(captured.runtime).toBe(original);
  expect(captured.stillCurrent()).toBe(true);
  for (const replacement of [
    { ...original, auth: { ...original.auth, isAuthenticated: false } },
    { ...original, auth: { ...original.auth, userId: "other" } },
    { ...original, auth: { ...original.auth, organizationId: "other" } },
    {
      ...original,
      crypto: { ...original.crypto, signingFingerprint: "new-key" },
    },
    {
      ...original,
      state: { ...original.state, domainScope: createDomainScope() },
    },
    {
      ...original,
      infra: { ...original.infra, dbStatus: "terminated" as const },
    },
    {
      ...original,
      infra: {
        ...original.infra,
        execSql: createExecSql({ exec: async () => ({ rows: [] }) }),
      },
    },
  ]) {
    current = replacement;
    expect(captured.stillCurrent()).toBe(false);
  }
});

test("reauthentication expires pending work even when no guard observes the logout", async () => {
  const sdk = new Tearleads({ online: true });
  const api = createMockApiClient();
  const domainScope = createDomainScope();
  const runtime = createRuntime({
    api,
    blobs: sdk.blobs,
    database: sdk.database,
    documentProjectors: defaultDocumentProjectorRegistry,
    events: sdk.events,
    getDomainScope: () => domainScope,
    identity: sdk.identity,
    identityTrustDomain: null,
    log: () => {},
    logError: () => {},
    network: sdk.network,
    reportSecurityIncident: async () => {},
    session: sdk.session,
  });
  const context = {
    authToken: "same-restored-token",
    isAuthenticated: true,
    organizationId: "org",
    userId: "owner",
  };
  sdk.session.setContext(context);
  const input = createWorkflowInputFixture({
    apiClient: api,
    auth: context,
    domainScope,
    execSql: createExecSql({ exec: async () => ({ rows: [] }) }),
  });
  const service = {
    get sessionGeneration() {
      return runtime.sessionGeneration;
    },
    workflowInput: () => input,
  };
  const captured = currentOrganizationMutation(service);
  expect(captured.stillCurrent()).toBe(true);
  const response = Promise.withResolvers<void>();
  const pendingAcknowledgement = response.promise.then(captured.stillCurrent);
  sdk.session.logout();
  sdk.session.setContext(context);
  response.resolve();
  expect(await pendingAcknowledgement).toBe(false);
  expect(currentOrganizationMutation(service).stillCurrent()).toBe(true);
  const next = currentOrganizationMutation(service);
  sdk.session.setContainerId("another-view");
  sdk.session.setSyncEnabled(false);
  expect(next.stillCurrent()).toBe(true);
});
