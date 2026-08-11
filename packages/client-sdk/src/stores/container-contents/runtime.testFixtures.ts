import type { ListContainersResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  type ContainerContentsWorkflowRuntimeInput,
  createContainerContentsStoreWorkflowRuntime,
} from "../../workflows/container-contents/runtime";

type ExecSql = Parameters<
  typeof defaultContainerContentsPersistence.ensureSchema
>[0];

export function createContainerContentsStoreTestRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
) {
  return createContainerContentsStoreWorkflowRuntime(input, () => false);
}

/**
 * Defaults-based builder over createContainerContentsStoreTestRuntime for the
 * common store-test posture: authenticated as user-1/org-1, ready database,
 * online, no key material, silent log. Omitted organizationId/userId derive
 * from isAuthenticated so an unauthenticated runtime carries no identity.
 */
export function createContainerContentsTestRuntime(input: {
  apiClient?: ContainerContentsWorkflowRuntimeInput["apiClient"] | undefined;
  containerId?: string | null | undefined;
  dbStatus?:
    | ContainerContentsWorkflowRuntimeInput["infra"]["dbStatus"]
    | undefined;
  domainScope: ContainerContentsWorkflowRuntimeInput["state"]["domainScope"];
  encapsulationKeyPair?:
    | ContainerContentsWorkflowRuntimeInput["crypto"]["encapsulationKeyPair"]
    | undefined;
  execSql: ExecSql;
  isAuthenticated?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
  online?: boolean | undefined;
  organizationId?: string | null | undefined;
  resolveTrustedUserIdentity?:
    | ContainerContentsWorkflowRuntimeInput["resolveTrustedUserIdentity"]
    | undefined;
  signingFingerprint?:
    | ContainerContentsWorkflowRuntimeInput["crypto"]["signingFingerprint"]
    | undefined;
  userId?: string | null | undefined;
}) {
  const isAuthenticated = input.isAuthenticated ?? true;
  return createContainerContentsStoreTestRuntime({
    apiClient:
      input.apiClient ??
      ({} as ContainerContentsWorkflowRuntimeInput["apiClient"]),
    auth: {
      isAuthenticated,
      organizationId:
        "organizationId" in input
          ? (input.organizationId ?? null)
          : isAuthenticated
            ? "org-1"
            : null,
      userId:
        "userId" in input
          ? (input.userId ?? null)
          : isAuthenticated
            ? "user-1"
            : null,
    },
    crypto: {
      encapsulationKeyPair: input.encapsulationKeyPair ?? null,
      signingFingerprint: input.signingFingerprint ?? null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: input.dbStatus ?? "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity:
      input.resolveTrustedUserIdentity ?? (async () => null),
    state: {
      containerId: input.containerId ?? null,
      domainScope: input.domainScope,
      events: [],
      online: input.online ?? true,
    },
    util: {
      log: input.log ?? (() => {}),
      reportSecurityIncident: async () => undefined,
    },
  });
}

/**
 * Ensure the container schema and persist a local root container row
 * (`parentId: null`, name "/") with the conventional
 * `<id>-metadata-document` metadata id.
 */
export async function seedLocalRootContainer(
  execSql: ExecSql,
  input: {
    organizationId?: string | undefined;
    rootContainerId: string;
  },
): Promise<void> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      icon: null,
      id: input.rootContainerId,
      effectiveAccessLevel: "admin",
      metadataDocumentId: `${input.rootContainerId}-metadata-document`,
      name: "/",
      organizationId: input.organizationId ?? "org-1",
      parentId: null,
    },
    null,
  );
}

export function emptyListContainersResponse(): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}
