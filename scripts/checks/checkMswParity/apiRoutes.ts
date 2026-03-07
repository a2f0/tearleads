import fs from 'node:fs/promises';
import path from 'node:path';
import {
  API_ROUTE_REGEX,
  API_ROUTES_DIR,
  type ApiRoute,
  type HttpMethod,
  ROOT_DIR
} from './types.ts';

const CONNECT_ROUTER_FILE = path.join(
  ROOT_DIR,
  'packages',
  'api',
  'src',
  'connect',
  'router.ts'
);
const CONNECT_ROUTE_PREFIX = '/v1/connect';

const toMethod = (value: string): HttpMethod => {
  const upper = value.toUpperCase();
  if (
    upper === 'GET' ||
    upper === 'POST' ||
    upper === 'PUT' ||
    upper === 'PATCH' ||
    upper === 'DELETE'
  ) {
    return upper;
  }

  throw new Error(`Unsupported HTTP method: ${value}`);
};

const withPrefix = (prefix: string, routePath: string): string =>
  `${prefix}${routePath === '/' ? '' : routePath}`;

const routePrefixForFile = (filePath: string): string | null => {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/routes/admin/users/')) return '/v1/admin/users';
  if (normalized.includes('/routes/admin/groups/')) return '/v1/admin/groups';
  if (normalized.includes('/routes/admin/organizations/')) {
    return '/v1/admin/organizations';
  }
  if (normalized.includes('/routes/admin/postgres/'))
    return '/v1/admin/postgres';
  if (normalized.includes('/routes/admin/redis/')) return '/v1/admin/redis';
  if (normalized.endsWith('/routes/admin/context.ts'))
    return '/v1/admin/context';
  if (normalized.includes('/routes/auth/')) return '/v1/auth';
  if (normalized.includes('/routes/billing/')) return '/v1/billing';
  if (normalized.includes('/routes/chat/')) return '/v1/chat';
  if (normalized.includes('/routes/ai-conversations/')) return '/v1/ai';
  if (normalized.includes('/routes/emailsCompose/')) return '/v1/emails';
  if (normalized.includes('/routes/emails/')) return '/v1/emails';
  if (normalized.includes('/routes/sse/')) return '/v1/sse';
  if (normalized.includes('/routes/vfs-shares/')) {
    return '/v1/connect/tearleads.v2.VfsSharesService';
  }
  if (normalized.includes('/routes/vfs/')) {
    return '/v1/connect/tearleads.v2.VfsService';
  }
  if (normalized.includes('/routes/mls/')) return '/v1/mls';
  if (normalized.includes('/routes/revenuecat/')) return '/v1/revenuecat';
  return null;
};

const isLeafRouteFile = (relativePath: string): boolean => {
  if (relativePath.endsWith('.test.ts')) return false;
  if (relativePath.endsWith('/shared.ts')) return false;
  if (relativePath.includes('/lib/')) return false;
  return !/\/routes\/[a-z-]+\.ts$/.test(relativePath);
};

const listFilesRecursive = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(absolutePath);
      }

      if (entry.isFile() && absolutePath.endsWith('.ts')) {
        return [absolutePath];
      }

      return [];
    })
  );

  return files.flat();
};

const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
};

const dedupeAndSortRoutes = (routes: ApiRoute[]): ApiRoute[] => {
  const deduped = new Map<string, ApiRoute>();
  for (const route of routes) {
    deduped.set(`${route.method} ${route.path}`, route);
  }

  return [...deduped.values()].sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`)
  );
};

const loadLegacyApiRoutes = async (): Promise<ApiRoute[]> => {
  const apiFiles = await listFilesRecursive(API_ROUTES_DIR);
  const routes: ApiRoute[] = [];

  for (const absolutePath of apiFiles) {
    const relativePath = path.relative(ROOT_DIR, absolutePath);
    if (!isLeafRouteFile(relativePath)) {
      continue;
    }

    const prefix = routePrefixForFile(relativePath);
    if (!prefix) {
      continue;
    }

    const content = await fs.readFile(absolutePath, 'utf8');
    const regex = new RegExp(API_ROUTE_REGEX);
    let match: RegExpExecArray | null = regex.exec(content);

    while (match) {
      const methodValue = match[1];
      const routePath = match[2];
      if (methodValue === undefined || routePath === undefined) {
        match = regex.exec(content);
        continue;
      }
      const method = toMethod(methodValue);
      routes.push({
        method,
        path: withPrefix(prefix, routePath),
        source: relativePath
      });

      match = regex.exec(content);
    }
  }

  return routes;
};

const parseNamedImportSpecifiers = (
  specifierList: string
): Array<{ imported: string; local: string }> => {
  const parsed: Array<{ imported: string; local: string }> = [];

  for (const rawSpecifier of specifierList.split(',')) {
    const normalizedSpecifier = rawSpecifier.trim();
    if (normalizedSpecifier.length === 0) {
      continue;
    }

    const specifierMatch = /^([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?$/.exec(
      normalizedSpecifier
    );
    if (!specifierMatch) {
      continue;
    }

    const imported = specifierMatch[1];
    const local = specifierMatch[2] ?? imported;
    if (!imported) {
      continue;
    }
    parsed.push({ imported, local });
  }

  return parsed;
};

const parseConnectMethodNames = (serviceContent: string): string[] => {
  const names: string[] = [];
  const methodRegex = /^\s{2}([a-z][A-Za-z0-9]*)\s*:\s*async\s*\(/gm;
  let match: RegExpExecArray | null = methodRegex.exec(serviceContent);
  while (match) {
    const methodName = match[1];
    if (methodName) {
      names.push(`${methodName.charAt(0).toUpperCase()}${methodName.slice(1)}`);
    }
    match = methodRegex.exec(serviceContent);
  }

  return names;
};

const loadConnectApiRoutes = async (): Promise<ApiRoute[]> => {
  if (!(await pathExists(CONNECT_ROUTER_FILE))) {
    return [];
  }

  const routerContent = await fs.readFile(CONNECT_ROUTER_FILE, 'utf8');
  const descriptorTypeNameByAlias = new Map<string, string>();
  const serviceFileByAlias = new Map<string, string>();

  const descriptorImportRegex =
    /import\s*{\s*([^}]+)\s*}\s*from\s*'@tearleads\/shared\/gen\/(tearleads\/v[0-9]+\/[^']+)_pb';/g;
  let descriptorImportMatch: RegExpExecArray | null =
    descriptorImportRegex.exec(routerContent);
  while (descriptorImportMatch) {
    const rawSpecifiers = descriptorImportMatch[1];
    const modulePath = descriptorImportMatch[2];
    const versionSegment = modulePath?.split('/')[1];
    if (!rawSpecifiers || !versionSegment) {
      descriptorImportMatch = descriptorImportRegex.exec(routerContent);
      continue;
    }

    const packageName = `tearleads.${versionSegment}`;
    for (const specifier of parseNamedImportSpecifiers(rawSpecifiers)) {
      descriptorTypeNameByAlias.set(
        specifier.local,
        `${packageName}.${specifier.imported}`
      );
    }

    descriptorImportMatch = descriptorImportRegex.exec(routerContent);
  }

  const serviceImportRegex =
    /import\s*{\s*([^}]+)\s*}\s*from\s*'\.\/services\/([^']+)';/g;
  let serviceImportMatch: RegExpExecArray | null =
    serviceImportRegex.exec(routerContent);
  while (serviceImportMatch) {
    const rawSpecifiers = serviceImportMatch[1];
    const modulePath = serviceImportMatch[2];
    if (!rawSpecifiers || !modulePath) {
      serviceImportMatch = serviceImportRegex.exec(routerContent);
      continue;
    }

    const moduleBase = modulePath.replace(/\.js$/, '');
    const absoluteServiceFilePath = path.join(
      path.dirname(CONNECT_ROUTER_FILE),
      'services',
      `${moduleBase}.ts`
    );
    for (const specifier of parseNamedImportSpecifiers(rawSpecifiers)) {
      serviceFileByAlias.set(specifier.local, absoluteServiceFilePath);
    }

    serviceImportMatch = serviceImportRegex.exec(routerContent);
  }

  const serviceMethodCache = new Map<string, string[]>();
  const connectRoutes: ApiRoute[] = [];
  const routerServiceRegex =
    /router\.service\(\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  let routerServiceMatch: RegExpExecArray | null =
    routerServiceRegex.exec(routerContent);
  while (routerServiceMatch) {
    const descriptorAlias = routerServiceMatch[1];
    const implAlias = routerServiceMatch[2];
    if (!descriptorAlias || !implAlias) {
      routerServiceMatch = routerServiceRegex.exec(routerContent);
      continue;
    }

    const typeName = descriptorTypeNameByAlias.get(descriptorAlias);
    const absoluteServiceFilePath = serviceFileByAlias.get(implAlias);
    if (!typeName || !absoluteServiceFilePath) {
      routerServiceMatch = routerServiceRegex.exec(routerContent);
      continue;
    }

    let methodNames = serviceMethodCache.get(absoluteServiceFilePath);
    if (!methodNames) {
      if (!(await pathExists(absoluteServiceFilePath))) {
        routerServiceMatch = routerServiceRegex.exec(routerContent);
        continue;
      }
      const serviceContent = await fs.readFile(absoluteServiceFilePath, 'utf8');
      methodNames = parseConnectMethodNames(serviceContent);
      serviceMethodCache.set(absoluteServiceFilePath, methodNames);
    }

    const source = path.relative(ROOT_DIR, absoluteServiceFilePath);
    for (const methodName of methodNames) {
      connectRoutes.push({
        method: 'POST',
        path: `${CONNECT_ROUTE_PREFIX}/${typeName}/${methodName}`,
        source
      });
    }

    routerServiceMatch = routerServiceRegex.exec(routerContent);
  }

  return connectRoutes;
};

export const loadApiRoutes = async (): Promise<ApiRoute[]> => {
  const routes: ApiRoute[] = [];
  if (await pathExists(API_ROUTES_DIR)) {
    routes.push(...(await loadLegacyApiRoutes()));
  }
  routes.push(...(await loadConnectApiRoutes()));
  return dedupeAndSortRoutes(routes);
};
