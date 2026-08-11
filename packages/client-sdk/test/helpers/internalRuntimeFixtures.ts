import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../../src/client/workflowRuntime";
import type { BlobStore } from "../../src/data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { createDomainScope } from "../../src/data/domainScope";

interface WorkflowInputFixtureOptions {
  readonly apiClient: InternalWorkflowRuntimeInput["apiClient"];
  readonly auth?: Partial<InternalWorkflowRuntimeInput["auth"]> | undefined;
  readonly blobStore?:
    | InternalWorkflowRuntimeInput["infra"]["blobStore"]
    | undefined;
  readonly containerId?: string | null | undefined;
  readonly dbStatus?:
    | InternalWorkflowRuntimeInput["infra"]["dbStatus"]
    | undefined;
  readonly domainScope?:
    | InternalWorkflowRuntimeInput["state"]["domainScope"]
    | undefined;
  readonly execSql: InternalWorkflowRuntimeInput["infra"]["execSql"];
  readonly logError?: InternalWorkflowRuntimeInput["util"]["logError"];
  readonly online?: boolean | undefined;
  readonly resolveTrustedUserIdentity?: InternalWorkflowRuntimeInput["resolveTrustedUserIdentity"];
}

/**
 * Builds the workflow-runtime input tests hand to client coordinators. Only
 * apiClient and execSql are required; everything else defaults to a quiet,
 * authenticated, online, ready-database runtime.
 */
export function createWorkflowInputFixture(
  options: WorkflowInputFixtureOptions,
): InternalWorkflowRuntimeInput {
  return {
    apiClient: options.apiClient,
    resolveTrustedUserIdentity:
      options.resolveTrustedUserIdentity ?? (async () => null),
    auth: {
      isAuthenticated: true,
      organizationId: null,
      userId: null,
      ...options.auth,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: options.blobStore ?? ({} as BlobStore),
      dbStatus: options.dbStatus ?? "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: options.execSql,
    },
    state: {
      containerId: options.containerId ?? null,
      domainScope: options.domainScope ?? createDomainScope(),
      events: [],
      online: options.online ?? true,
    },
    util: {
      log: () => {},
      logError: options.logError ?? (() => {}),
      reportSecurityIncident: async () => undefined,
    },
  };
}

/** Wraps a workflow-input source into the InternalRuntime stub tests inject. */
export function createInternalRuntimeFixture(
  workflowInput: () => InternalWorkflowRuntimeInput,
  overrides: {
    readonly adoptRootContainer?: InternalRuntime["adoptRootContainer"];
  } = {},
): InternalRuntime {
  return {
    adoptRootContainer: overrides.adoptRootContainer ?? (() => false),
    pinLocalUserIdentity: async () => {},
    publicRuntime: {
      version: 0,
      input: workflowInput,
      subscribe: () => () => {},
    },
    workflowInput,
  };
}
