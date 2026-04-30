import { ApiClient } from "@tearleads/api-client";

type PublicApiClient = Pick<ApiClient, keyof ApiClient>;

export function createMockApiClient(
  overrides: Partial<PublicApiClient> = {},
): ApiClient {
  const apiClient = new ApiClient("http://api.test");

  Object.assign(apiClient, {
    authenticate: async () => null,
    authenticateWithChallenge: async () => null,
    bindBlobAttachmentV2: async () => null,
    createContainerV2: async () => null,
    createDocumentV2: async () => null,
    detachBlobAttachmentV2: async () => null,
    getBlob: async () => null,
    getContainerV2WriterProjection: async () => null,
    getCurrentPrincipalPolicy: async () => null,
    getDocumentV2WriterProjection: async () => null,
    getEncapsulationKey: async () => null,
    getHealth: async () => null,
    linkDocumentV2: async () => null,
    listContainerDocuments: async () => null,
    listContainers: async () => [],
    listDocumentAttachments: async () => null,
    moveContainerV2: async () => null,
    postPublicKey: async () => null,
    rekeyContainerV2: async () => null,
    revokeContainerV2: async () => null,
    shareContainerV2: async () => null,
    stageBlob: async () => null,
    syncDocumentV2: async () => null,
    unlinkDocumentV2: async () => null,
    ...overrides,
  } satisfies Partial<PublicApiClient>);

  return apiClient;
}
