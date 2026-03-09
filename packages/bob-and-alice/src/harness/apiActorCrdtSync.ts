import {
  VfsBackgroundSyncClient,
  type VfsBackgroundSyncClientOptions,
  type VfsCrdtSyncTransport,
  VfsHttpCrdtSyncTransport,
  type VfsHttpCrdtSyncTransportOptions
} from '@tearleads/vfs-sync/vfs';
import {
  type ApiActor,
  fetchWithRetryableWriteValidationError
} from './apiScenarioHarness.js';

export interface ApiActorFetchInterceptorContext {
  actor: ApiActor;
  path: string;
  init: RequestInit | undefined;
  proceed: () => Promise<Response>;
}

export type ApiActorFetchInterceptor = (
  input: ApiActorFetchInterceptorContext
) => Promise<Response>;

function parseJson<T>(text: string): T {
  return JSON.parse(text);
}

function toActorPath(input: Request | URL | string): string {
  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const parsed = new URL(rawUrl, 'http://bob-and-alice.local');
  return `${parsed.pathname}${parsed.search}`;
}

export function withApiActorFetchInterceptor(input: {
  actor: ApiActor;
  intercept: ApiActorFetchInterceptor;
}): ApiActor {
  const wrappedFetch = async (
    path: string,
    init?: RequestInit
  ): Promise<Response> =>
    input.intercept({
      actor: input.actor,
      path,
      init,
      proceed: () => input.actor.fetch(path, init)
    });

  const wrappedFetchJson: ApiActor['fetchJson'] = async <T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<T> => {
    const response = await fetchWithRetryableWriteValidationError(
      wrappedFetch,
      path,
      init
    );
    const text = await response.text();
    if (text.trim().length === 0) {
      return parseJson<T>('{}');
    }
    return parseJson<T>(text);
  };

  return {
    ...input.actor,
    fetch: wrappedFetch,
    fetchJson: wrappedFetchJson
  };
}

export function createApiActorCrdtTransport(input: {
  actor: ApiActor;
  intercept?: ApiActorFetchInterceptor;
  transportOptions?: Omit<
    VfsHttpCrdtSyncTransportOptions,
    'fetchImpl' | 'getAuthToken'
  >;
}): VfsHttpCrdtSyncTransport {
  const actor = input.intercept
    ? withApiActorFetchInterceptor({
        actor: input.actor,
        intercept: input.intercept
      })
    : input.actor;
  const organizationId =
    input.transportOptions?.organizationId ?? input.actor.user.organizationId;

  return new VfsHttpCrdtSyncTransport({
    ...input.transportOptions,
    organizationId,
    fetchImpl: async (requestInfo, init) =>
      actor.fetch(toActorPath(requestInfo), init)
  });
}

export function createApiActorSyncClient(input: {
  actor: ApiActor;
  clientId: string;
  intercept?: ApiActorFetchInterceptor;
  includeReconcileState?: boolean;
  transportOptions?: Omit<
    VfsHttpCrdtSyncTransportOptions,
    'fetchImpl' | 'getAuthToken'
  >;
  clientOptions?: VfsBackgroundSyncClientOptions;
}): VfsBackgroundSyncClient {
  const transportInput = {
    actor: input.actor,
    ...(input.intercept ? { intercept: input.intercept } : {}),
    ...(input.transportOptions
      ? { transportOptions: input.transportOptions }
      : {})
  };
  const baseTransport = createApiActorCrdtTransport(transportInput);
  const transport: VfsCrdtSyncTransport =
    input.includeReconcileState === false
      ? {
          pushOperations: (request) => baseTransport.pushOperations(request),
          pullOperations: (request) => baseTransport.pullOperations(request)
        }
      : baseTransport;

  return new VfsBackgroundSyncClient(
    input.actor.user.userId,
    input.clientId,
    transport,
    input.clientOptions ?? {}
  );
}
