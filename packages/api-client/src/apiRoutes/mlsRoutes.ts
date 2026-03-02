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
import { request } from '../apiCore';

type UpdateMlsGroupResponse = CreateMlsGroupResponse;

interface AckMlsWelcomeResponse {
  acknowledged: boolean;
}

interface ConnectJsonEnvelopeResponse {
  json: string;
}

type RequestEventName = Parameters<typeof request>[1]['eventName'];

const MLS_CONNECT_BASE_PATH = '/connect/tearleads.v1.MlsService';

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function parseConnectJson<T>(json: unknown): T {
  if (typeof json !== 'string') {
    return JSON.parse('{}');
  }
  const trimmed = json.trim();
  if (trimmed.length === 0) {
    return JSON.parse('{}');
  }
  return JSON.parse(trimmed);
}

function requestMlsJson<TResponse>(
  methodName: string,
  requestBody: Record<string, unknown>,
  eventName: RequestEventName
): Promise<TResponse> {
  return request<ConnectJsonEnvelopeResponse>(
    `${MLS_CONNECT_BASE_PATH}/${methodName}`,
    {
      fetchOptions: jsonPost(requestBody),
      eventName
    }
  ).then((response) => parseConnectJson<TResponse>(response?.json));
}

export const mlsRoutes = {
  listGroups: () =>
    requestMlsJson<MlsGroupsResponse>('ListGroups', {}, 'api_get_mls_groups'),
  getGroup: (groupId: string) =>
    requestMlsJson<MlsGroupResponse>(
      'GetGroup',
      { groupId },
      'api_get_mls_group'
    ),
  createGroup: (data: CreateMlsGroupRequest) =>
    requestMlsJson<CreateMlsGroupResponse>(
      'CreateGroup',
      { json: JSON.stringify(data) },
      'api_post_mls_group'
    ),
  updateGroup: (groupId: string, data: UpdateMlsGroupRequest) =>
    requestMlsJson<UpdateMlsGroupResponse>(
      'UpdateGroup',
      { groupId, json: JSON.stringify(data) },
      'api_patch_mls_group'
    ),
  leaveGroup: (groupId: string) =>
    requestMlsJson<unknown>(
      'DeleteGroup',
      { groupId },
      'api_delete_mls_group'
    ).then(() => undefined),
  getGroupMembers: (groupId: string) =>
    requestMlsJson<MlsGroupMembersResponse>(
      'GetGroupMembers',
      { groupId },
      'api_get_mls_group_members'
    ),
  addGroupMember: (groupId: string, data: AddMlsMemberRequest) =>
    requestMlsJson<AddMlsMemberResponse>(
      'AddGroupMember',
      { groupId, json: JSON.stringify(data) },
      'api_post_mls_group_member'
    ),
  removeGroupMember: (
    groupId: string,
    userId: string,
    data: RemoveMlsMemberRequest
  ) =>
    requestMlsJson<unknown>(
      'RemoveGroupMember',
      { groupId, userId, json: JSON.stringify(data) },
      'api_delete_mls_group_member'
    ).then(() => undefined),
  getGroupMessages: (
    groupId: string,
    options?: { cursor?: string; limit?: number }
  ) => {
    const requestBody: Record<string, unknown> = { groupId };
    if (options?.cursor) {
      requestBody['cursor'] = options.cursor;
    }
    if (options?.limit) {
      requestBody['limit'] = options.limit;
    }

    return requestMlsJson<MlsMessagesResponse>(
      'GetGroupMessages',
      requestBody,
      'api_get_mls_group_messages'
    );
  },
  sendGroupMessage: (groupId: string, data: SendMlsMessageRequest) =>
    requestMlsJson<SendMlsMessageResponse>(
      'SendGroupMessage',
      { groupId, json: JSON.stringify(data) },
      'api_post_mls_group_message'
    ),
  getGroupState: (groupId: string) =>
    requestMlsJson<MlsGroupStateResponse>(
      'GetGroupState',
      { groupId },
      'api_get_mls_group_state'
    ),
  uploadGroupState: (groupId: string, data: UploadMlsStateRequest) =>
    requestMlsJson<UploadMlsStateResponse>(
      'UploadGroupState',
      { groupId, json: JSON.stringify(data) },
      'api_post_mls_group_state'
    ),
  getMyKeyPackages: () =>
    requestMlsJson<MlsKeyPackagesResponse>(
      'GetMyKeyPackages',
      {},
      'api_get_mls_key_packages_me'
    ),
  getUserKeyPackages: (userId: string) =>
    requestMlsJson<MlsKeyPackagesResponse>(
      'GetUserKeyPackages',
      { userId },
      'api_get_mls_key_packages_user'
    ),
  uploadKeyPackages: (data: UploadMlsKeyPackagesRequest) =>
    requestMlsJson<UploadMlsKeyPackagesResponse>(
      'UploadKeyPackages',
      { json: JSON.stringify(data) },
      'api_post_mls_key_packages'
    ),
  deleteKeyPackage: (id: string) =>
    requestMlsJson<unknown>(
      'DeleteKeyPackage',
      { id },
      'api_delete_mls_key_package'
    ).then(() => undefined),
  getWelcomeMessages: () =>
    requestMlsJson<MlsWelcomeMessagesResponse>(
      'GetWelcomeMessages',
      {},
      'api_get_mls_welcome_messages'
    ),
  acknowledgeWelcome: (id: string, data: AckMlsWelcomeRequest) =>
    requestMlsJson<AckMlsWelcomeResponse>(
      'AcknowledgeWelcome',
      { id, json: JSON.stringify(data) },
      'api_post_mls_welcome_ack'
    )
};
