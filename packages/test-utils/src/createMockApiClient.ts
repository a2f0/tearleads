import { ApiClient, type RequestFailure } from "@symcrypt/api-client";
import type { ListContainersResponse } from "@symcrypt/validators/response";

type PublicApiClient = Pick<ApiClient, keyof ApiClient>;

const EMPTY_LIST_CONTAINERS_RESPONSE: ListContainersResponse = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

function mockRequestFailure(input: {
  readonly message: string;
  readonly method: RequestFailure["method"];
  readonly path: string;
}): RequestFailure {
  return {
    kind: "network",
    message: input.message,
    method: input.method,
    ok: false,
    path: input.path,
    report: () => {},
    status: null,
    statusText: "",
  };
}

export function createMockApiClient(
  overrides: Partial<PublicApiClient> = {},
): ApiClient {
  const apiClient = new ApiClient("http://api.test");

  Object.assign(apiClient, {
    authenticate: async () => null,
    authenticateWithChallenge: async () => null,
    bindBlobAttachment: async () => null,
    createContainer: async () => null,
    createContainerWithMetadataDocument: async () => null,
    createDocument: async () => null,
    deleteContainer: async () => null,
    detachBlobAttachment: async () => null,
    getBlobBytes: async () => null,
    getContainerWriterProjection: async () => null,
    getCurrentPrincipalPolicy: async () => null,
    getDocumentWriterProjection: async () => null,
    getUserIdentity: async () => null,
    getHealth: async () => null,
    getMultipartBlobStage: async () => null,
    getOrganizationDataUsageResult: async (organizationId: string) => {
      const path = `/organizations/${encodeURIComponent(organizationId)}/data-usage`;
      return mockRequestFailure({
        message: `GET ${path}: mock data usage is not configured`,
        method: "GET",
        path,
      });
    },
    linkDocument: async () => null,
    listContainerDocuments: async () => null,
    listContainerParentLanes: async (input) => ({
      results: input.lanes.map(({ laneId }) => ({
        laneId,
        page: EMPTY_LIST_CONTAINERS_RESPONSE,
      })),
    }),
    listDocumentAttachments: async () => null,
    listOrganizationGroupMembers: async () => null,
    moveContainer: async () => null,
    createOrganizationGroup: async () => null,
    putPrincipalPolicy: async () => null,
    registerUser: async () => null,
    rekeyContainer: async () => null,
    revokeContainer: async () => null,
    shareContainer: async () => null,
    initiateMultipartBlobStage: async () => null,
    uploadMultipartBlobPartBytes: async () => null,
    completeMultipartBlobStage: async () => null,
    syncDocument: async () => null,
    unlinkDocument: async () => null,
    ...overrides,
  } satisfies Partial<PublicApiClient>);

  // Container create retries use the RequestResult APIs so stale-policy
  // failures can carry verified repair bundles instead of being reported early.
  if (!overrides.createContainerResult) {
    apiClient.createContainerResult = async (input) => {
      const data = await apiClient.createContainer(input);
      if (data) {
        return { data, ok: true };
      }

      const path = "/containers";
      return mockRequestFailure({
        message: `POST ${path}: mock createContainer returned null`,
        method: "POST",
        path,
      });
    };
  }

  if (!overrides.createContainerWithMetadataDocumentResult) {
    apiClient.createContainerWithMetadataDocumentResult = async (input) => {
      const data = await apiClient.createContainerWithMetadataDocument(input);
      if (data) {
        return { data, ok: true };
      }

      const path = "/containers/with-metadata-document";
      return mockRequestFailure({
        message: `POST ${path}: mock createContainerWithMetadataDocument returned null`,
        method: "POST",
        path,
      });
    };
  }

  if (!overrides.deleteContainerResult) {
    apiClient.deleteContainerResult = async (containerId) => {
      const data = await apiClient.deleteContainer(containerId);
      if (data) {
        return { data, ok: true };
      }

      const path = `/containers/${containerId}`;
      return mockRequestFailure({
        message: `DELETE ${path}: mock deleteContainer returned null`,
        method: "DELETE",
        path,
      });
    };
  }

  // The idempotent-create adopt path submits via createDocumentResult so an
  // expected conflict can be inspected without being reported. Mirror the
  // (possibly overridden) createDocument stub so doubles need only set the
  // plain method.
  if (!overrides.createDocumentResult) {
    apiClient.createDocumentResult = async (input) => {
      const data = await apiClient.createDocument(input);
      if (data) {
        return { data, ok: true };
      }

      const path = "/documents";
      return mockRequestFailure({
        message: `POST ${path}: mock createDocument returned null`,
        method: "POST",
        path,
      });
    };
  }

  if (!overrides.syncDocumentResult) {
    apiClient.syncDocumentResult = async (documentId, input) => {
      const data = await apiClient.syncDocument(documentId, input);
      if (data) {
        return { data, ok: true };
      }

      const path = `/documents/${documentId}/sync`;
      return mockRequestFailure({
        message: `POST ${path}: mock syncDocument returned null`,
        method: "POST",
        path,
      });
    };
  }

  if (!Object.hasOwn(overrides, "getDocumentWriterProjectionResult")) {
    Object.defineProperty(apiClient, "getDocumentWriterProjectionResult", {
      configurable: true,
      value: undefined,
      writable: true,
    });
  }

  if (!Object.hasOwn(overrides, "getContainerWriterProjectionResult")) {
    Object.defineProperty(apiClient, "getContainerWriterProjectionResult", {
      configurable: true,
      value: undefined,
      writable: true,
    });
  }

  return apiClient;
}
