import { ApiClient } from "@tearleads/api-client";
import type { ListContainersResponse } from "@tearleads/validators/response";
import { createMockRequestFailure as mockRequestFailure } from "./createMockRequestFailure";

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
    commitOrganizationGroupPolicy: async () => null,
    putPrincipalPolicy: async () => null,
    registerUser: async () => null,
    rekeyContainer: async () => null,
    reciteContainer: async () => null,
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

  if (!overrides.getDocumentWriterProjectionResult) {
    apiClient.getDocumentWriterProjectionResult = async (documentId) => {
      const data = await apiClient.getDocumentWriterProjection(documentId);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock document writer projection unavailable",
            method: "GET",
            path: `/documents/${documentId}/writer-projection`,
          });
    };
  }

  if (!overrides.getContainerWriterProjectionResult) {
    apiClient.getContainerWriterProjectionResult = async (containerId) => {
      const data = await apiClient.getContainerWriterProjection(containerId);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock container writer projection unavailable",
            method: "GET",
            path: `/containers/${containerId}/writer-projection`,
          });
    };
  }

  // The SDK prefers a rotation's status-bearing variant whenever one exists,
  // so each is derived from its mocked plain method. Left as the real client's,
  // a test that mocks only `moveContainer` would have that mock skipped and a
  // real request sent instead.
  if (!overrides.rekeyContainerResult) {
    apiClient.rekeyContainerResult = async (containerId, input, options) => {
      const data = await apiClient.rekeyContainer(containerId, input, options);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock container rekey unavailable",
            method: "POST",
            path: `/containers/${containerId}/rekey`,
          });
    };
  }
  if (!overrides.revokeContainerResult) {
    apiClient.revokeContainerResult = async (containerId, input, options) => {
      const data = await apiClient.revokeContainer(containerId, input, options);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock container revoke unavailable",
            method: "POST",
            path: `/containers/${containerId}/revoke`,
          });
    };
  }
  // Group policy commits prefer the status-bearing variant for the same reason.
  if (!overrides.commitOrganizationGroupPolicyResult) {
    apiClient.commitOrganizationGroupPolicyResult = async (
      organizationId,
      groupId,
      input,
    ) => {
      const data = await apiClient.commitOrganizationGroupPolicy(
        organizationId,
        groupId,
        input,
      );
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock group policy commit unavailable",
            method: "POST",
            path: `/organizations/${organizationId}/groups/${groupId}/policy`,
          });
    };
  }
  if (!overrides.moveContainerResult) {
    apiClient.moveContainerResult = async (containerId, input, options) => {
      const data = await apiClient.moveContainer(containerId, input, options);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock container move unavailable",
            method: "POST",
            path: `/containers/${containerId}/move`,
          });
    };
  }
  if (!overrides.linkDocumentResult) {
    apiClient.linkDocumentResult = async (documentId, input, options) => {
      const data = await apiClient.linkDocument(documentId, input, options);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock document link unavailable",
            method: "POST",
            path: `/documents/${documentId}/links`,
          });
    };
  }
  if (!overrides.unlinkDocumentResult) {
    apiClient.unlinkDocumentResult = async (documentId, input, options) => {
      const data = await apiClient.unlinkDocument(documentId, input, options);
      return data
        ? { data, ok: true }
        : mockRequestFailure({
            message: "Mock document unlink unavailable",
            method: "POST",
            path: `/documents/${documentId}/unlink`,
          });
    };
  }
  return apiClient;
}
