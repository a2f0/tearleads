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

export const mlsRoutes = {
  listGroups: () =>
    request<MlsGroupsResponse>('/mls/groups', {
      eventName: 'api_get_mls_groups'
    }),
  getGroup: (groupId: string) =>
    request<MlsGroupResponse>(`/mls/groups/${encodeURIComponent(groupId)}`, {
      eventName: 'api_get_mls_group'
    }),
  createGroup: (data: CreateMlsGroupRequest) =>
    request<CreateMlsGroupResponse>('/mls/groups', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      eventName: 'api_post_mls_group'
    }),
  updateGroup: (groupId: string, data: UpdateMlsGroupRequest) =>
    request<UpdateMlsGroupResponse>(
      `/mls/groups/${encodeURIComponent(groupId)}`,
      {
        fetchOptions: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_patch_mls_group'
      }
    ),
  leaveGroup: (groupId: string) =>
    request<void>(`/mls/groups/${encodeURIComponent(groupId)}`, {
      fetchOptions: { method: 'DELETE' },
      eventName: 'api_delete_mls_group'
    }),
  getGroupMembers: (groupId: string) =>
    request<MlsGroupMembersResponse>(
      `/mls/groups/${encodeURIComponent(groupId)}/members`,
      {
        eventName: 'api_get_mls_group_members'
      }
    ),
  addGroupMember: (groupId: string, data: AddMlsMemberRequest) =>
    request<AddMlsMemberResponse>(
      `/mls/groups/${encodeURIComponent(groupId)}/members`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_mls_group_member'
      }
    ),
  removeGroupMember: (
    groupId: string,
    userId: string,
    data: RemoveMlsMemberRequest
  ) =>
    request<void>(
      `/mls/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      {
        fetchOptions: {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_delete_mls_group_member'
      }
    ),
  getGroupMessages: (
    groupId: string,
    options?: { cursor?: string; limit?: number }
  ) => {
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<MlsMessagesResponse>(
      `/vfs/mls/groups/${encodeURIComponent(groupId)}/messages${query ? `?${query}` : ''}`,
      {
        eventName: 'api_get_mls_group_messages'
      }
    );
  },
  sendGroupMessage: (groupId: string, data: SendMlsMessageRequest) =>
    request<SendMlsMessageResponse>(
      `/vfs/mls/groups/${encodeURIComponent(groupId)}/messages`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_mls_group_message'
      }
    ),
  getGroupState: (groupId: string) =>
    request<MlsGroupStateResponse>(
      `/mls/groups/${encodeURIComponent(groupId)}/state`,
      {
        eventName: 'api_get_mls_group_state'
      }
    ),
  uploadGroupState: (groupId: string, data: UploadMlsStateRequest) =>
    request<UploadMlsStateResponse>(
      `/mls/groups/${encodeURIComponent(groupId)}/state`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_mls_group_state'
      }
    ),
  getMyKeyPackages: () =>
    request<MlsKeyPackagesResponse>('/mls/key-packages/me', {
      eventName: 'api_get_mls_key_packages_me'
    }),
  getUserKeyPackages: (userId: string) =>
    request<MlsKeyPackagesResponse>(
      `/mls/key-packages/${encodeURIComponent(userId)}`,
      {
        eventName: 'api_get_mls_key_packages_user'
      }
    ),
  uploadKeyPackages: (data: UploadMlsKeyPackagesRequest) =>
    request<UploadMlsKeyPackagesResponse>('/mls/key-packages', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      eventName: 'api_post_mls_key_packages'
    }),
  deleteKeyPackage: (id: string) =>
    request<void>(`/mls/key-packages/${encodeURIComponent(id)}`, {
      fetchOptions: { method: 'DELETE' },
      eventName: 'api_delete_mls_key_package'
    }),
  getWelcomeMessages: () =>
    request<MlsWelcomeMessagesResponse>('/mls/welcome-messages', {
      eventName: 'api_get_mls_welcome_messages'
    }),
  acknowledgeWelcome: (id: string, data: AckMlsWelcomeRequest) =>
    request<AckMlsWelcomeResponse>(
      `/mls/welcome-messages/${encodeURIComponent(id)}/ack`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_mls_welcome_ack'
      }
    )
};
