import {
  createConnectJsonPostInit,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString
} from '@tearleads/shared';

const MLS_CONNECT_SERVICE_PATH = '/connect/tearleads.v1.MlsService';

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

function parseEnvelope<T>(body: unknown): T {
  const payload = parseConnectJsonEnvelopeBody(body);
  return parseConnectJsonString<T>(JSON.stringify(payload));
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
  return fetch(buildRpcUrl(context, method), {
    ...createConnectJsonPostInit(requestBody),
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
    throw new Error(
      await toResponseErrorMessage(response, input.errorMessage)
    );
  }

  return parseEnvelope<T>(await response.json());
}
