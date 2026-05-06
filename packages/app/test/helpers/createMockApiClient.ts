import { ApiClient } from "@tearleads/api-client";
import type { ListContainersResponse } from "@tearleads/validators/response";

type PublicApiClient = Pick<ApiClient, keyof ApiClient>;

const EMPTY_LIST_CONTAINERS_RESPONSE: ListContainersResponse = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

export function createMockApiClient(
  overrides: Partial<PublicApiClient> = {},
): ApiClient {
  const apiClient = new ApiClient("http://api.test");

  Object.assign(apiClient, {
    authenticate: async () => null,
    authenticateWithChallenge: async () => null,
    bindBlobAttachment: async () => null,
    createContainer: async () => null,
    createDocument: async () => null,
    deleteContainer: async () => null,
    deleteContainerResult: async () => ({
      kind: "network",
      message: "mock deleteContainerResult returned null",
      method: "DELETE",
      ok: false,
      path: "/containers/mock",
      report: () => {},
      status: null,
      statusText: "",
    }),
    detachBlobAttachment: async () => null,
    getBlob: async () => null,
    getContainerWriterProjection: async () => null,
    getCurrentPrincipalPolicy: async () => null,
    getDocumentWriterProjection: async () => null,
    getEncapsulationKey: async () => null,
    getHealth: async () => null,
    linkDocument: async () => null,
    listContainerDocuments: async () => null,
    listContainers: async () => EMPTY_LIST_CONTAINERS_RESPONSE,
    listDocumentAttachments: async () => null,
    moveContainer: async () => null,
    postPublicKey: async () => null,
    rekeyContainer: async () => null,
    revokeContainer: async () => null,
    shareContainer: async () => null,
    stageBlob: async () => null,
    syncDocument: async () => null,
    unlinkDocument: async () => null,
    ...overrides,
  } satisfies Partial<PublicApiClient>);

  if (!overrides.deleteContainerResult) {
    apiClient.deleteContainerResult = async (containerId) => {
      const data = await apiClient.deleteContainer(containerId);
      if (data) {
        return { data, ok: true };
      }

      const path = `/containers/${containerId}`;
      const message = `DELETE ${path}: mock deleteContainer returned null`;
      return {
        kind: "network",
        message,
        method: "DELETE",
        ok: false,
        path,
        report: () => {},
        status: null,
        statusText: "",
      };
    };
  }

  if (!overrides.syncDocumentResult) {
    apiClient.syncDocumentResult = async (documentId, input) => {
      const data = await apiClient.syncDocument(documentId, input);
      if (data) {
        return { data, ok: true };
      }

      const path = `/documents/${documentId}/sync`;
      const message = `POST ${path}: mock syncDocument returned null`;
      return {
        kind: "network",
        message,
        method: "POST",
        ok: false,
        path,
        report: () => {},
        status: null,
        statusText: "",
      };
    };
  }

  return apiClient;
}
