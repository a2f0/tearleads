import { adminContextRouter } from '../../routes/admin/context.js';
import { groupsRouter } from '../../routes/admin/groups.js';
import { organizationsRouter } from '../../routes/admin/organizations.js';
import { postgresRouter } from '../../routes/admin/postgres.js';
import { redisRouter } from '../../routes/admin/redis.js';
import { usersRouter } from '../../routes/admin/users.js';
import { vfsRouter } from '../../routes/vfs/router.js';
import { vfsSharesRouter } from '../../routes/vfs-shares/router.js';
import type {
  RequestQuery,
  RouteDefinition,
  RouteHandler,
  RouteMethod,
  UnknownRecord
} from './legacyRouteProxyTypes.js';

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPropertyBag(value: unknown): value is UnknownRecord {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  if (!isRecord(value)) {
    return false;
  }

  for (const entryValue of Object.values(value)) {
    if (typeof entryValue !== 'boolean') {
      return false;
    }
  }

  return true;
}

function isUnknownFunction(
  value: unknown
): value is (arg0: unknown, arg1: unknown) => unknown {
  return typeof value === 'function';
}

function toRouteMethod(methodName: string): RouteMethod | null {
  if (methodName === 'get') {
    return 'GET';
  }
  if (methodName === 'post') {
    return 'POST';
  }
  if (methodName === 'put') {
    return 'PUT';
  }
  if (methodName === 'patch') {
    return 'PATCH';
  }
  if (methodName === 'delete') {
    return 'DELETE';
  }
  return null;
}

function normalizeRoutePrefix(prefix: string): string {
  if (prefix === '/') {
    return '';
  }

  if (prefix.endsWith('/')) {
    return prefix.slice(0, -1);
  }

  return prefix;
}

function joinRoutePath(prefix: string, routePath: string): string {
  const normalizedPrefix = normalizeRoutePrefix(prefix);
  if (routePath === '/') {
    return normalizedPrefix.length > 0 ? normalizedPrefix : '/';
  }

  if (routePath.startsWith('/')) {
    return `${normalizedPrefix}${routePath}`;
  }

  return `${normalizedPrefix}/${routePath}`;
}

function getRouteHandler(routeStack: unknown): RouteHandler | null {
  if (!Array.isArray(routeStack)) {
    return null;
  }

  let selectedHandler: RouteHandler | null = null;

  for (const entry of routeStack) {
    if (!isRecord(entry)) {
      continue;
    }

    const handle = entry['handle'];
    if (!isUnknownFunction(handle)) {
      continue;
    }

    selectedHandler = (request: unknown, response: unknown) =>
      handle(request, response);
  }

  return selectedHandler;
}

function collectRoutes(prefix: string, router: unknown): RouteDefinition[] {
  if (!isPropertyBag(router)) {
    return [];
  }

  const stack = router['stack'];
  if (!Array.isArray(stack)) {
    return [];
  }

  const routes: RouteDefinition[] = [];

  for (const layer of stack) {
    if (!isRecord(layer)) {
      continue;
    }

    const route = layer['route'];
    if (!isRecord(route)) {
      continue;
    }

    const routePath = route['path'];
    const methods = route['methods'];
    const routeStack = route['stack'];

    if (typeof routePath !== 'string' || !isBooleanRecord(methods)) {
      continue;
    }

    const handler = getRouteHandler(routeStack);
    if (!handler) {
      continue;
    }

    for (const [methodName, enabled] of Object.entries(methods)) {
      if (!enabled) {
        continue;
      }

      const method = toRouteMethod(methodName);
      if (!method) {
        continue;
      }

      routes.push({
        method,
        pattern: joinRoutePath(prefix, routePath),
        handler
      });
    }
  }

  return routes;
}

const routeDefinitions: RouteDefinition[] = [
  ...collectRoutes('/admin/context', adminContextRouter),
  ...collectRoutes('/admin/groups', groupsRouter),
  ...collectRoutes('/admin/organizations', organizationsRouter),
  ...collectRoutes('/admin/users', usersRouter),
  ...collectRoutes('/admin/postgres', postgresRouter),
  ...collectRoutes('/admin/redis', redisRouter),
  ...collectRoutes('/vfs', vfsRouter),
  ...collectRoutes('/vfs', vfsSharesRouter)
];

function splitPath(path: string): string[] {
  const normalized = path.replace(/^\/+|\/+$/gu, '');
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split('/');
}

function matchRoutePattern(
  pattern: string,
  actualPath: string
): Record<string, string> | null {
  const patternSegments = splitPath(pattern);
  const actualSegments = splitPath(actualPath);

  if (patternSegments.length !== actualSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const actualSegment = actualSegments[index];

    if (!patternSegment || !actualSegment) {
      return null;
    }

    if (patternSegment.startsWith(':')) {
      const paramName = patternSegment.slice(1);
      if (paramName.length === 0) {
        return null;
      }

      try {
        params[paramName] = decodeURIComponent(actualSegment);
      } catch {
        return null;
      }
      continue;
    }

    if (patternSegment !== actualSegment) {
      return null;
    }
  }

  return params;
}

export function findRoute(
  method: RouteMethod,
  path: string
): { definition: RouteDefinition; params: Record<string, string> } | null {
  for (const definition of routeDefinitions) {
    if (definition.method !== method) {
      continue;
    }

    const params = matchRoutePattern(definition.pattern, path);
    if (!params) {
      continue;
    }

    return {
      definition,
      params
    };
  }

  return null;
}

export function buildRequestQuery(
  searchParams: URLSearchParams | undefined
): RequestQuery {
  const query: RequestQuery = {};
  if (!searchParams) {
    return query;
  }

  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
      continue;
    }

    if (typeof existing === 'string') {
      query[key] = [existing, value];
      continue;
    }

    query[key] = [...existing, value];
  }

  return query;
}

export function parseJsonBody(
  jsonBody: string | undefined
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (jsonBody === undefined) {
    return {
      ok: true,
      value: {}
    };
  }

  const normalized = jsonBody.trim().length > 0 ? jsonBody : '{}';
  try {
    return {
      ok: true,
      value: JSON.parse(normalized)
    };
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON payload'
    };
  }
}

export function isRouteErrorBodyRecord(value: unknown): value is UnknownRecord {
  return isRecord(value);
}
