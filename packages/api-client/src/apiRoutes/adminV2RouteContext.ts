import {
  type CallOptions,
  type Client,
  Code,
  ConnectError,
  createClient
} from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import { AdminService } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { API_BASE_URL, tryRefreshToken } from '../apiCore';
import { type ApiEventSlug, logApiEvent } from '../apiLogger';
import {
  type ApiV2RequestHeaderOptions,
  buildApiV2RequestHeaders,
  normalizeApiV2ConnectBaseUrl
} from '../apiV2ClientWasm';
import { getAuthHeaderValue } from '../authStorage';

type AdminV2CallOptions = Pick<CallOptions, 'headers'>;

export type AdminV2Client = Client<typeof AdminService>;

export interface AdminV2RoutesDependencies {
  resolveApiBaseUrl: () => string;
  normalizeConnectBaseUrl: (apiBaseUrl: string) => Promise<string>;
  buildHeaders: (
    options: ApiV2RequestHeaderOptions
  ) => Promise<Record<string, string>>;
  getAuthHeaderValue: () => string | null;
  createClient: (connectBaseUrl: string) => AdminV2Client;
  refreshOnUnauthenticated: () => Promise<boolean>;
  logEvent: (
    eventName: ApiEventSlug,
    durationMs: number,
    success: boolean
  ) => Promise<void>;
}

function createDefaultDependencies(): AdminV2RoutesDependencies {
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
    createClient: createDefaultAdminV2Client,
    refreshOnUnauthenticated: tryRefreshToken,
    logEvent: logApiEvent
  };
}

function toCallOptions(headers: Record<string, string>): AdminV2CallOptions {
  if (Object.keys(headers).length === 0) {
    return {};
  }
  return { headers };
}

export function createDefaultAdminV2Client(
  connectBaseUrl: string
): AdminV2Client {
  const transport = createGrpcWebTransport({
    baseUrl: connectBaseUrl,
    useBinaryFormat: true
  });
  return createClient(AdminService, transport);
}

export function createAdminV2RoutesDependencies(
  overrides: Partial<AdminV2RoutesDependencies> = {}
): AdminV2RoutesDependencies {
  return {
    ...createDefaultDependencies(),
    ...overrides
  };
}

function isUnauthenticatedError(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.Unauthenticated;
}

export async function buildCallContext(
  dependencies: AdminV2RoutesDependencies
): Promise<{ client: AdminV2Client; callOptions: AdminV2CallOptions }> {
  const connectBaseUrl = await dependencies.normalizeConnectBaseUrl(
    dependencies.resolveApiBaseUrl()
  );
  const client = dependencies.createClient(connectBaseUrl);
  const headers = await dependencies.buildHeaders({
    bearerToken: dependencies.getAuthHeaderValue()
  });

  return {
    client,
    callOptions: toCallOptions(headers)
  };
}

export async function runWithEvent<T>(
  dependencies: AdminV2RoutesDependencies,
  eventName: ApiEventSlug,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  let success = false;

  try {
    const response = await operation();
    success = true;
    return response;
  } catch (error) {
    if (!isUnauthenticatedError(error)) {
      throw error;
    }

    const refreshed = await dependencies.refreshOnUnauthenticated();
    if (!refreshed) {
      throw error;
    }

    const retriedResponse = await operation();
    success = true;
    return retriedResponse;
  } finally {
    await dependencies.logEvent(eventName, performance.now() - start, success);
  }
}
