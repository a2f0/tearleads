import { create, type JsonObject } from '@bufbuild/protobuf';
import {
  type CallOptions,
  type Client,
  createClient
} from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import type {
  AckMlsWelcomeRequest,
  AddMlsMemberRequest,
  AddMlsMemberResponse,
  CreateMlsGroupRequest,
  CreateMlsGroupResponse,
  MlsGroupMembersResponse,
  MlsGroupResponse,
  MlsGroupStateResponse,
  MlsGroupsResponse,
  MlsKeyPackagesResponse,
  MlsMessagesResponse,
  MlsWelcomeMessagesResponse,
  RemoveMlsMemberRequest,
  SendMlsMessageRequest,
  SendMlsMessageResponse,
  UpdateMlsGroupRequest,
  UploadMlsKeyPackagesRequest,
  UploadMlsKeyPackagesResponse,
  UploadMlsStateRequest,
  UploadMlsStateResponse
} from '@tearleads/shared';
import { parseConnectJsonString } from '@tearleads/shared';
import {
  MlsAcknowledgeWelcomeRequestSchema,
  MlsAddGroupMemberRequestSchema,
  MlsCreateGroupRequestSchema,
  MlsDeleteGroupRequestSchema,
  MlsDeleteKeyPackageRequestSchema,
  MlsGetGroupMembersRequestSchema,
  MlsGetGroupMessagesRequestSchema,
  MlsGetGroupRequestSchema,
  MlsGetGroupStateRequestSchema,
  MlsGetMyKeyPackagesRequestSchema,
  MlsGetUserKeyPackagesRequestSchema,
  MlsGetWelcomeMessagesRequestSchema,
  MlsListGroupsRequestSchema,
  MlsRemoveGroupMemberRequestSchema,
  MlsSendGroupMessageRequestSchema,
  MlsService,
  MlsUpdateGroupRequestSchema,
  MlsUploadGroupStateRequestSchema,
  MlsUploadKeyPackagesRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import { API_BASE_URL } from '../apiCore';
import { type ApiEventSlug, logApiEvent } from '../apiLogger';
import {
  type ApiV2RequestHeaderOptions,
  buildApiV2RequestHeaders,
  normalizeApiV2ConnectBaseUrl
} from '../apiV2ClientWasm';
import { getAuthHeaderValue } from '../authStorage';

type MlsV2CallOptions = Pick<CallOptions, 'headers'>;

export type MlsV2Client = Client<typeof MlsService>;

interface MlsV2RoutesDependencies {
  resolveApiBaseUrl: () => string;
  normalizeConnectBaseUrl: (apiBaseUrl: string) => Promise<string>;
  buildHeaders: (
    options: ApiV2RequestHeaderOptions
  ) => Promise<Record<string, string>>;
  getAuthHeaderValue: () => string | null;
  createClient: (connectBaseUrl: string) => MlsV2Client;
  logEvent: (
    eventName: ApiEventSlug,
    durationMs: number,
    success: boolean
  ) => Promise<void>;
}

function createDefaultDependencies(): MlsV2RoutesDependencies {
  return {
    resolveApiBaseUrl: () => {
      if (!API_BASE_URL) {
        throw new Error('VITE_API_URL environment variable is not set');
      }
      return API_BASE_URL;
    },
    normalizeConnectBaseUrl: normalizeApiV2ConnectBaseUrl,
    buildHeaders: buildApiV2RequestHeaders,
    getAuthHeaderValue,
    createClient: createDefaultMlsV2Client,
    logEvent: logApiEvent
  };
}

function toCallOptions(headers: Record<string, string>): MlsV2CallOptions {
  if (Object.keys(headers).length === 0) {
    return {};
  }

  return { headers };
}

function encodePayload(payload: object): JsonObject {
  return parseConnectJsonString<JsonObject>(JSON.stringify(payload));
}

function decodePayload<T>(payload: JsonObject | undefined): T {
  return parseConnectJsonString<T>(JSON.stringify(payload ?? {}));
}

function createClientResolver(
  dependencies: MlsV2RoutesDependencies
): () => Promise<MlsV2Client> {
  let pendingClient: Promise<MlsV2Client> | null = null;

  return async () => {
    if (pendingClient) {
      return pendingClient;
    }

    const unresolvedClient = (async () => {
      const connectBaseUrl = await dependencies.normalizeConnectBaseUrl(
        dependencies.resolveApiBaseUrl()
      );
      return dependencies.createClient(connectBaseUrl);
    })();

    pendingClient = unresolvedClient.catch((error: unknown) => {
      pendingClient = null;
      throw error;
    });

    return pendingClient;
  };
}

async function buildCallContext(
  dependencies: MlsV2RoutesDependencies,
  getClient: () => Promise<MlsV2Client>
): Promise<{ client: MlsV2Client; callOptions: MlsV2CallOptions }> {
  const client = await getClient();
  const headers = await dependencies.buildHeaders({
    bearerToken: dependencies.getAuthHeaderValue()
  });

  return {
    client,
    callOptions: toCallOptions(headers)
  };
}

async function runWithEvent<T>(
  dependencies: MlsV2RoutesDependencies,
  eventName: ApiEventSlug,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  let success = false;

  try {
    const response = await operation();
    success = true;
    return response;
  } finally {
    await dependencies.logEvent(eventName, performance.now() - start, success);
  }
}

export function createDefaultMlsV2Client(connectBaseUrl: string): MlsV2Client {
  const transport = createGrpcWebTransport({
    baseUrl: connectBaseUrl,
    useBinaryFormat: true
  });

  return createClient(MlsService, transport);
}

export function createMlsV2Routes(
  overrides: Partial<MlsV2RoutesDependencies> = {}
) {
  const dependencies = {
    ...createDefaultDependencies(),
    ...overrides
  };
  const getClient = createClientResolver(dependencies);

  return {
    listGroups: () =>
      runWithEvent(dependencies, 'api_get_mls_groups', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.listGroups(
          create(MlsListGroupsRequestSchema),
          callOptions
        );
        return decodePayload<MlsGroupsResponse>(response.payload);
      }),
    getGroup: (groupId: string) =>
      runWithEvent(dependencies, 'api_get_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroup(
          create(MlsGetGroupRequestSchema, { groupId }),
          callOptions
        );
        return decodePayload<MlsGroupResponse>(response.payload);
      }),
    createGroup: (data: CreateMlsGroupRequest) =>
      runWithEvent(dependencies, 'api_post_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.createGroup(
          create(MlsCreateGroupRequestSchema, {
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<CreateMlsGroupResponse>(response.payload);
      }),
    updateGroup: (groupId: string, data: UpdateMlsGroupRequest) =>
      runWithEvent(dependencies, 'api_patch_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.updateGroup(
          create(MlsUpdateGroupRequestSchema, {
            groupId,
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<CreateMlsGroupResponse>(response.payload);
      }),
    leaveGroup: (groupId: string) =>
      runWithEvent(dependencies, 'api_delete_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.deleteGroup(
          create(MlsDeleteGroupRequestSchema, { groupId }),
          callOptions
        );
      }),
    getGroupMembers: (groupId: string) =>
      runWithEvent(dependencies, 'api_get_mls_group_members', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroupMembers(
          create(MlsGetGroupMembersRequestSchema, { groupId }),
          callOptions
        );
        return decodePayload<MlsGroupMembersResponse>(response.payload);
      }),
    addGroupMember: (groupId: string, data: AddMlsMemberRequest) =>
      runWithEvent(dependencies, 'api_post_mls_group_member', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.addGroupMember(
          create(MlsAddGroupMemberRequestSchema, {
            groupId,
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<AddMlsMemberResponse>(response.payload);
      }),
    removeGroupMember: (
      groupId: string,
      userId: string,
      data: RemoveMlsMemberRequest
    ) =>
      runWithEvent(dependencies, 'api_delete_mls_group_member', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.removeGroupMember(
          create(MlsRemoveGroupMemberRequestSchema, {
            groupId,
            userId,
            payload: encodePayload(data)
          }),
          callOptions
        );
      }),
    getGroupMessages: (
      groupId: string,
      options?: { cursor?: string; limit?: number }
    ) =>
      runWithEvent(dependencies, 'api_get_mls_group_messages', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroupMessages(
          create(MlsGetGroupMessagesRequestSchema, {
            groupId,
            cursor: options?.cursor ?? '',
            limit: options?.limit ?? 0
          }),
          callOptions
        );
        return decodePayload<MlsMessagesResponse>(response.payload);
      }),
    sendGroupMessage: (groupId: string, data: SendMlsMessageRequest) =>
      runWithEvent(dependencies, 'api_post_mls_group_message', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.sendGroupMessage(
          create(MlsSendGroupMessageRequestSchema, {
            groupId,
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<SendMlsMessageResponse>(response.payload);
      }),
    getGroupState: (groupId: string) =>
      runWithEvent(dependencies, 'api_get_mls_group_state', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroupState(
          create(MlsGetGroupStateRequestSchema, { groupId }),
          callOptions
        );
        return decodePayload<MlsGroupStateResponse>(response.payload);
      }),
    uploadGroupState: (groupId: string, data: UploadMlsStateRequest) =>
      runWithEvent(dependencies, 'api_post_mls_group_state', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.uploadGroupState(
          create(MlsUploadGroupStateRequestSchema, {
            groupId,
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<UploadMlsStateResponse>(response.payload);
      }),
    getMyKeyPackages: () =>
      runWithEvent(dependencies, 'api_get_mls_key_packages_me', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getMyKeyPackages(
          create(MlsGetMyKeyPackagesRequestSchema),
          callOptions
        );
        return decodePayload<MlsKeyPackagesResponse>(response.payload);
      }),
    getUserKeyPackages: (userId: string) =>
      runWithEvent(dependencies, 'api_get_mls_key_packages_user', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getUserKeyPackages(
          create(MlsGetUserKeyPackagesRequestSchema, { userId }),
          callOptions
        );
        return decodePayload<MlsKeyPackagesResponse>(response.payload);
      }),
    uploadKeyPackages: (data: UploadMlsKeyPackagesRequest) =>
      runWithEvent(dependencies, 'api_post_mls_key_packages', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.uploadKeyPackages(
          create(MlsUploadKeyPackagesRequestSchema, {
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<UploadMlsKeyPackagesResponse>(response.payload);
      }),
    deleteKeyPackage: (id: string) =>
      runWithEvent(dependencies, 'api_delete_mls_key_package', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.deleteKeyPackage(
          create(MlsDeleteKeyPackageRequestSchema, { id }),
          callOptions
        );
      }),
    getWelcomeMessages: () =>
      runWithEvent(dependencies, 'api_get_mls_welcome_messages', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getWelcomeMessages(
          create(MlsGetWelcomeMessagesRequestSchema),
          callOptions
        );
        return decodePayload<MlsWelcomeMessagesResponse>(response.payload);
      }),
    acknowledgeWelcome: (id: string, data: AckMlsWelcomeRequest) =>
      runWithEvent(dependencies, 'api_post_mls_welcome_ack', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.acknowledgeWelcome(
          create(MlsAcknowledgeWelcomeRequestSchema, {
            id,
            payload: encodePayload(data)
          }),
          callOptions
        );
        return decodePayload<{ acknowledged: boolean }>(response.payload);
      })
  };
}

export const mlsV2Routes = createMlsV2Routes();
