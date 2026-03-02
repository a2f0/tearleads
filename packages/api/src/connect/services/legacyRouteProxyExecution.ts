import {
  authenticate,
  resolveAdminAccess,
  resolveOrganizationMembership
} from './legacyRouteProxyAuth.js';
import {
  buildRequestQuery,
  findRoute,
  parseJsonBody
} from './legacyRouteProxyRouting.js';
import type {
  AdapterRequest,
  AdapterResponse,
  LegacyCallOptions,
  RouteExecutionResult
} from './legacyRouteProxyTypes.js';

function createAdapterResponse(
  responseHeaders: Map<string, string>
): AdapterResponse {
  let statusCode = 200;
  let body: unknown = undefined;
  let headersSent = false;

  const setHeaderValue = (name: string, value: unknown) => {
    responseHeaders.set(name.toLowerCase(), String(value));
  };

  const response: AdapterResponse = {
    statusCode,
    body,
    headersSent,
    status: (nextStatus: number) => {
      statusCode = nextStatus;
      response.statusCode = statusCode;
      return response;
    },
    json: (payload: unknown) => {
      body = payload;
      headersSent = true;
      response.body = body;
      response.headersSent = headersSent;
      if (!responseHeaders.has('content-type')) {
        setHeaderValue('content-type', 'application/json; charset=utf-8');
      }
      return response;
    },
    send: (payload?: unknown) => {
      body = payload;
      headersSent = true;
      response.body = body;
      response.headersSent = headersSent;
      return response;
    },
    setHeader: (name: string, value: unknown) => {
      setHeaderValue(name, value);
    },
    set: (name: string, value: unknown) => {
      setHeaderValue(name, value);
      return response;
    },
    type: (value: string) => {
      setHeaderValue('content-type', value);
      return response;
    },
    end: (payload?: unknown) => {
      if (payload !== undefined) {
        body = payload;
        response.body = body;
      }
      headersSent = true;
      response.headersSent = headersSent;
      return response;
    }
  };

  return response;
}

export async function executeRoute(
  options: LegacyCallOptions
): Promise<RouteExecutionResult> {
  const { context, method, path, query, jsonBody } = options;

  const match = findRoute(method, path);
  if (!match) {
    return {
      status: 404,
      body: {
        error: 'Not found'
      }
    };
  }

  const authResult = await authenticate(context.requestHeader);
  if (!authResult.ok) {
    return {
      status: authResult.status,
      body: {
        error: authResult.error
      }
    };
  }

  const organizationResult = await resolveOrganizationMembership(
    path,
    context.requestHeader,
    authResult.claims.sub
  );
  if (!organizationResult.ok) {
    return {
      status: organizationResult.status,
      body: {
        error: organizationResult.error
      }
    };
  }

  const adminAccessResult = await resolveAdminAccess(path, authResult.session);
  if (!adminAccessResult.ok) {
    return {
      status: adminAccessResult.status,
      body: {
        error: adminAccessResult.error
      }
    };
  }

  const parsedJsonBody = parseJsonBody(jsonBody);
  if (!parsedJsonBody.ok) {
    return {
      status: 400,
      body: {
        error: parsedJsonBody.error
      }
    };
  }

  const requestHeaders = new Headers(context.requestHeader);
  const request: AdapterRequest = {
    method,
    path,
    params: match.params,
    query: buildRequestQuery(query),
    body: parsedJsonBody.value,
    authClaims: authResult.claims,
    session: authResult.session,
    ...(organizationResult.organizationId
      ? { organizationId: organizationResult.organizationId }
      : {}),
    ...(adminAccessResult.adminAccess
      ? { adminAccess: adminAccessResult.adminAccess }
      : {}),
    get: (name: string) => {
      const value = requestHeaders.get(name);
      return value === null ? undefined : value;
    },
    header: (name: string) => {
      const value = requestHeaders.get(name);
      return value === null ? undefined : value;
    }
  };

  const responseHeaders = new Map<string, string>();
  const response = createAdapterResponse(responseHeaders);

  try {
    await match.definition.handler(request, response);
  } catch (error) {
    console.error('Direct route handler failed', error);
    return {
      status: 500,
      body: {
        error: 'Internal server error'
      }
    };
  }

  const contentType = responseHeaders.get('content-type');

  return {
    status: response.statusCode,
    body: response.body,
    ...(contentType ? { contentType } : {})
  };
}
