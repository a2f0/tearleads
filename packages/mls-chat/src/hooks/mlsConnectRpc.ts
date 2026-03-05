import {
  createConnectJsonPostInit,
  isPlainRecord,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString
} from '@tearleads/shared';

const MLS_CONNECT_SERVICE_PATH = '/connect/tearleads.v2.MlsService';

type MlsRpcMethod =
  | 'UploadKeyPackages'
  | 'GetMyKeyPackages'
  | 'GetUserKeyPackages'
  | 'DeleteKeyPackage'
  | 'CreateGroup'
  | 'ListGroups'
  | 'GetGroup'
  | 'UpdateGroup'
  | 'DeleteGroup'
  | 'AddGroupMember'
  | 'GetGroupMembers'
  | 'RemoveGroupMember'
  | 'SendGroupMessage'
  | 'GetGroupMessages'
  | 'GetGroupState'
  | 'UploadGroupState'
  | 'GetWelcomeMessages'
  | 'AcknowledgeWelcome';

interface MlsRpcContext {
  apiBaseUrl: string;
  getAuthHeader: (() => string | null) | undefined;
}

const MLS_PAYLOAD_METHODS = new Set<MlsRpcMethod>([
  'UploadKeyPackages',
  'CreateGroup',
  'UpdateGroup',
  'AddGroupMember',
  'RemoveGroupMember',
  'SendGroupMessage',
  'UploadGroupState',
  'AcknowledgeWelcome'
]);

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildHeaders(context: MlsRpcContext): Headers {
  const headers = new Headers(createConnectJsonPostInit({}).headers);
  const authValue = context.getAuthHeader?.();
  if (authValue) {
    headers.set('Authorization', authValue);
  }
  return headers;
}

function buildRpcUrl(context: MlsRpcContext, method: MlsRpcMethod): string {
  return `${trimTrailingSlash(context.apiBaseUrl)}${MLS_CONNECT_SERVICE_PATH}/${method}`;
}

function normalizePayloadRequestBody(
  method: MlsRpcMethod,
  requestBody: Record<string, unknown>
): Record<string, unknown> {
  if (!MLS_PAYLOAD_METHODS.has(method)) {
    return requestBody;
  }

  const rawJson = requestBody['json'];
  if (typeof rawJson !== 'string') {
    return requestBody;
  }

  const { json: _ignored, ...rest } = requestBody;
  return {
    ...rest,
    payload: parseConnectJsonString<Record<string, unknown>>(rawJson)
  };
}

export function parseEnvelope<T>(body: unknown): T {
  const envelopeOrBody = parseConnectJsonEnvelopeBody(body);
  const payloadOrBody =
    isPlainRecord(envelopeOrBody) && 'payload' in envelopeOrBody
      ? envelopeOrBody['payload']
      : envelopeOrBody;

  return parseConnectJsonString<T>(JSON.stringify(payloadOrBody ?? {}));
}

async function toResponseErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const responseBody = await response.json();
    if (
      typeof responseBody === 'object' &&
      responseBody !== null &&
      typeof responseBody['message'] === 'string' &&
      responseBody['message'].length > 0
    ) {
      return responseBody['message'];
    }
  } catch {
    // ignore parse errors and fall back to the provided message
  }

  return fallbackMessage;
}

export async function postMlsRpc(
  context: MlsRpcContext,
  method: MlsRpcMethod,
  requestBody: Record<string, unknown>
): Promise<Response> {
  const normalizedBody = normalizePayloadRequestBody(method, requestBody);

  return fetch(buildRpcUrl(context, method), {
    ...createConnectJsonPostInit(normalizedBody),
    headers: buildHeaders(context)
  });
}

export async function requestMlsRpc<T>(input: {
  context: MlsRpcContext;
  method: MlsRpcMethod;
  requestBody: Record<string, unknown>;
  errorMessage: string;
}): Promise<T> {
  const response = await postMlsRpc(
    input.context,
    input.method,
    input.requestBody
  );

  if (!response.ok) {
    throw new Error(await toResponseErrorMessage(response, input.errorMessage));
  }

  return parseEnvelope<T>(await response.json());
}
