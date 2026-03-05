import type { JsonObject, JsonValue } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  addGroupMemberDirect,
  getGroupMembersDirect,
  removeGroupMemberDirect
} from './mlsDirectGroupMembers.js';
import {
  createGroupDirect,
  deleteGroupDirect,
  getGroupDirect,
  listGroupsDirect,
  updateGroupDirect
} from './mlsDirectGroups.js';
import {
  deleteKeyPackageDirect,
  getMyKeyPackagesDirect,
  getUserKeyPackagesDirect,
  uploadKeyPackagesDirect
} from './mlsDirectKeyPackages.js';
import {
  getGroupMessagesDirect,
  sendGroupMessageDirect
} from './mlsDirectMessages.js';
import {
  getGroupStateDirect,
  uploadGroupStateDirect
} from './mlsDirectState.js';
import {
  acknowledgeWelcomeDirect,
  getWelcomeMessagesDirect
} from './mlsDirectWelcomeMessages.js';

type UserIdRequest = { userId: string };
type MlsIdRequest = { id: string };
type GroupIdRequest = { groupId: string };
type GetGroupMessagesRequest = {
  groupId: string;
  cursor: string;
  limit: number;
};
type GroupIdPayloadRequest = { groupId: string; payload?: JsonObject };
type RemoveGroupMemberPayloadRequest = {
  groupId: string;
  userId: string;
  payload?: JsonObject;
};
type AcknowledgeWelcomePayloadRequest = { id: string; payload?: JsonObject };
type PayloadRequest = { payload?: JsonObject };
type HeaderContext = { requestHeader: Headers };

function jsonStringifyPayload(payload: JsonObject | undefined): string {
  return JSON.stringify(payload ?? {});
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (typeof value !== 'object') {
    return false;
  }

  return Object.values(value).every((item) => isJsonValue(item));
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => isJsonValue(item));
}

function parsePayload(json: string): JsonObject {
  const normalized = json.trim().length > 0 ? json : '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new ConnectError(
      'direct service returned invalid payload JSON',
      Code.Internal
    );
  }

  if (!isJsonObject(parsed)) {
    throw new ConnectError(
      'direct service payload must decode to a JSON object',
      Code.Internal
    );
  }

  return parsed;
}

function payloadResponse(response: { json: string }): { payload?: JsonObject } {
  return { payload: parsePayload(response.json) };
}

export const mlsConnectServiceV2 = {
  uploadKeyPackages: async (request: PayloadRequest, context: HeaderContext) =>
    payloadResponse(
      await uploadKeyPackagesDirect(
        { json: jsonStringifyPayload(request.payload) },
        context
      )
    ),
  getMyKeyPackages: async (_request: object, context: HeaderContext) =>
    payloadResponse(await getMyKeyPackagesDirect({}, context)),
  getUserKeyPackages: async (request: UserIdRequest, context: HeaderContext) =>
    payloadResponse(await getUserKeyPackagesDirect(request, context)),
  deleteKeyPackage: async (request: MlsIdRequest, context: HeaderContext) =>
    payloadResponse(await deleteKeyPackageDirect(request, context)),
  createGroup: async (request: PayloadRequest, context: HeaderContext) =>
    payloadResponse(
      await createGroupDirect(
        { json: jsonStringifyPayload(request.payload) },
        context
      )
    ),
  listGroups: async (_request: object, context: HeaderContext) =>
    payloadResponse(await listGroupsDirect({}, context)),
  getGroup: async (request: GroupIdRequest, context: HeaderContext) =>
    payloadResponse(await getGroupDirect(request, context)),
  updateGroup: async (request: GroupIdPayloadRequest, context: HeaderContext) =>
    payloadResponse(
      await updateGroupDirect(
        {
          groupId: request.groupId,
          json: jsonStringifyPayload(request.payload)
        },
        context
      )
    ),
  deleteGroup: async (request: GroupIdRequest, context: HeaderContext) =>
    payloadResponse(await deleteGroupDirect(request, context)),
  addGroupMember: async (
    request: GroupIdPayloadRequest,
    context: HeaderContext
  ) =>
    payloadResponse(
      await addGroupMemberDirect(
        {
          groupId: request.groupId,
          json: jsonStringifyPayload(request.payload)
        },
        context
      )
    ),
  getGroupMembers: async (request: GroupIdRequest, context: HeaderContext) =>
    payloadResponse(await getGroupMembersDirect(request, context)),
  removeGroupMember: async (
    request: RemoveGroupMemberPayloadRequest,
    context: HeaderContext
  ) =>
    payloadResponse(
      await removeGroupMemberDirect(
        {
          groupId: request.groupId,
          userId: request.userId,
          json: jsonStringifyPayload(request.payload)
        },
        context
      )
    ),
  sendGroupMessage: async (
    request: GroupIdPayloadRequest,
    context: HeaderContext
  ) =>
    payloadResponse(
      await sendGroupMessageDirect(
        {
          groupId: request.groupId,
          json: jsonStringifyPayload(request.payload)
        },
        context
      )
    ),
  getGroupMessages: async (
    request: GetGroupMessagesRequest,
    context: HeaderContext
  ) => payloadResponse(await getGroupMessagesDirect(request, context)),
  getGroupState: async (request: GroupIdRequest, context: HeaderContext) =>
    payloadResponse(await getGroupStateDirect(request, context)),
  uploadGroupState: async (
    request: GroupIdPayloadRequest,
    context: HeaderContext
  ) =>
    payloadResponse(
      await uploadGroupStateDirect(
        {
          groupId: request.groupId,
          json: jsonStringifyPayload(request.payload)
        },
        context
      )
    ),
  getWelcomeMessages: async (_request: object, context: HeaderContext) =>
    payloadResponse(await getWelcomeMessagesDirect({}, context)),
  acknowledgeWelcome: async (
    request: AcknowledgeWelcomePayloadRequest,
    context: HeaderContext
  ) =>
    payloadResponse(
      await acknowledgeWelcomeDirect(
        {
          id: request.id,
          json: jsonStringifyPayload(request.payload)
        },
        context
      )
    )
};
