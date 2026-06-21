import { ApiClient, type RequestFailure } from "@tearleads/api-client";
import type { ListContainersResponse } from "@tearleads/validators/response";

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
    getBlob: async () => null,
    getBlobBytes: async () => null,
    getContainerWriterProjection: async () => null,
    getCurrentPrincipalPolicy: async () => null,
    getDocumentWriterProjection: async () => null,
    getEncapsulationKey: async () => null,
    getHealth: async () => null,
    getMultipartBlobStage: async () => null,
    linkDocument: async () => null,
    listContainerDocuments: async () => null,
    listContainers: async () => EMPTY_LIST_CONTAINERS_RESPONSE,
    listDocumentAttachments: async () => null,
    listOrganizationDirectory: async () => null,
    listOrganizationGroupMembers: async () => null,
    listOrganizationGroups: async () => null,
    moveContainer: async () => null,
    createOrganizationGroup: async () => null,
    putPrincipalMemberEnvelopes: async () => null,
    putPrincipalState: async () => null,
    registerUser: async () => null,
    rekeyContainer: async () => null,
    revokeContainer: async () => null,
    shareContainer: async () => null,
    stageBlob: async () => null,
    initiateMultipartBlobStage: async () => null,
    uploadMultipartBlobPart: async () => null,
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

  return apiClient;
}
