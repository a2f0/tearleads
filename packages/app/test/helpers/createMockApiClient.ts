import { ApiClient } from "@tearleads/api-client";

type PublicApiClient = Pick<ApiClient, keyof ApiClient>;

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
    detachBlobAttachment: async () => null,
    getBlob: async () => null,
    getContainerWriterProjection: async () => null,
    getCurrentPrincipalPolicy: async () => null,
    getDocumentWriterProjection: async () => null,
    getEncapsulationKey: async () => null,
    getHealth: async () => null,
    linkDocument: async () => null,
    listContainerDocuments: async () => null,
    listContainers: async () => [],
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

  return apiClient;
}
