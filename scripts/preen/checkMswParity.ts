#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs/promises';
import path from 'node:path';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiRoute {
  method: HttpMethod;
  path: string;
  source: string;
}

interface MswHandlerMatcher {
  method: HttpMethod;
  sourcePattern: string;
  regex: RegExp;
}

interface ParityResult {
  apiRoutes: ApiRoute[];
  mswMatchers: MswHandlerMatcher[];
  matchedRoutes: ApiRoute[];
  missingRoutes: ApiRoute[];
}

const API_ROUTE_REGEX =
  /\b(?:routeRouter|authRouter|adminContextRouter)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
const MSW_WITH_OPTIONAL_V1_REGEX =
  /http\.(get|post|put|patch|delete)\(\s*withOptionalV1Prefix\('([^']+)'\)/g;
const MSW_LITERAL_REGEX =
  /http\.(get|post|put|patch|delete)\(\s*(\/[^/]*\/[^,]+|`[^`]+`|'[^']+'|"[^"]+")/g;

const ROOT_DIR = process.cwd();
const API_ROUTES_DIR = path.join(ROOT_DIR, 'packages', 'api', 'src', 'routes');
const API_INDEX_FILE = path.join(ROOT_DIR, 'packages', 'api', 'src', 'index.ts');
const MSW_HANDLERS_FILE = path.join(ROOT_DIR, 'packages', 'msw', 'src', 'handlers.ts');

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
  if (normalized.includes('/routes/admin/postgres/')) return '/v1/admin/postgres';
  if (normalized.includes('/routes/admin/redis/')) return '/v1/admin/redis';
  if (normalized.endsWith('/routes/admin/context.ts')) return '/v1/admin/context';
  if (normalized.includes('/routes/auth/')) return '/v1/auth';
  if (normalized.includes('/routes/billing/')) return '/v1/billing';
  if (normalized.includes('/routes/chat/')) return '/v1/chat';
  if (normalized.includes('/routes/ai-conversations/')) return '/v1/ai';
  if (normalized.includes('/routes/emailsCompose/')) return '/v1/emails';
  if (normalized.includes('/routes/emails/')) return '/v1/emails';
  if (normalized.includes('/routes/sse/')) return '/v1/sse';
  if (normalized.includes('/routes/vfs-shares/')) return '/v1/vfs';
  if (normalized.includes('/routes/vfs/')) return '/v1/vfs';
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

      return [] as string[];
    })
  );

  return files.flat();
};

const loadApiRoutes = async (): Promise<ApiRoute[]> => {
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
      const method = toMethod(match[1]);
      const routePath = match[2];
      routes.push({
        method,
        path: withPrefix(prefix, routePath),
        source: relativePath
      });

      match = regex.exec(content);
    }
  }

  routes.push({
    method: 'GET',
    path: '/v1/ping',
    source: path.relative(ROOT_DIR, API_INDEX_FILE)
  });

  const deduped = new Map<string, ApiRoute>();
  for (const route of routes) {
    deduped.set(`${route.method} ${route.path}`, route);
  }

  return [...deduped.values()].sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`)
  );
};

const buildMatcherFromLiteral = (
  methodValue: string,
  literal: string
): MswHandlerMatcher | null => {
  const method = toMethod(methodValue);

  if (literal.startsWith('/')) {
    const lastSlash = literal.lastIndexOf('/');
    const sourcePattern = literal.slice(1, lastSlash);
    const flags = literal.slice(lastSlash + 1);
    return {
      method,
      sourcePattern: sourcePattern,
      regex: new RegExp(sourcePattern, flags)
    };
  }

  if (
    (literal.startsWith("'") && literal.endsWith("'")) ||
    (literal.startsWith('"') && literal.endsWith('"')) ||
    (literal.startsWith('`') && literal.endsWith('`'))
  ) {
    const value = literal.slice(1, -1);
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      method,
      sourcePattern: `^${escaped}$`,
      regex: new RegExp(`^${escaped}$`)
    };
  }

  return null;
};

const loadMswMatchers = async (): Promise<MswHandlerMatcher[]> => {
  const content = await fs.readFile(MSW_HANDLERS_FILE, 'utf8');
  const results: MswHandlerMatcher[] = [];

  const optionalV1Regex = new RegExp(MSW_WITH_OPTIONAL_V1_REGEX);
  let optionalV1Match: RegExpExecArray | null = optionalV1Regex.exec(content);
  while (optionalV1Match) {
    const method = toMethod(optionalV1Match[1]);
    const pathPattern = optionalV1Match[2];
    const sourcePattern = `(?:/v1)?${pathPattern}$`;
    results.push({
      method,
      sourcePattern,
      regex: new RegExp(sourcePattern)
    });

    optionalV1Match = optionalV1Regex.exec(content);
  }

  if (results.length === 0) {
    const literalRegex = new RegExp(MSW_LITERAL_REGEX);
    let literalMatch: RegExpExecArray | null = literalRegex.exec(content);
    while (literalMatch) {
      const matcher = buildMatcherFromLiteral(literalMatch[1], literalMatch[2]);
      if (matcher) {
        results.push(matcher);
      }
      literalMatch = literalRegex.exec(content);
    }
  }

  return results;
};

const samplePathForRoute = (routePath: string): string =>
  routePath.replace(/:[^/]+/g, 'sample');

const evaluateParity = async (): Promise<ParityResult> => {
  const apiRoutes = await loadApiRoutes();
  const mswMatchers = await loadMswMatchers();

  const matchedRoutes: ApiRoute[] = [];
  const missingRoutes: ApiRoute[] = [];

  for (const route of apiRoutes) {
    const samplePath = samplePathForRoute(route.path);
    const isMatched = mswMatchers.some(
      (matcher) =>
        matcher.method === route.method && matcher.regex.test(samplePath)
    );

    if (isMatched) {
      matchedRoutes.push(route);
    } else {
      missingRoutes.push(route);
    }
  }

  return { apiRoutes, mswMatchers, matchedRoutes, missingRoutes };
};

const summarizeMissingByPrefix = (
  missingRoutes: ApiRoute[]
): Array<{ prefix: string; count: number }> => {
  const counts = new Map<string, number>();

  for (const route of missingRoutes) {
    const prefix = route.path.split('/').filter(Boolean).slice(0, 3).join('/');
    const current = counts.get(prefix) ?? 0;
    counts.set(prefix, current + 1);
  }

  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
};

const formatTextReport = (result: ParityResult): string => {
  const lines: string[] = [];
  lines.push(`API routes: ${result.apiRoutes.length}`);
  lines.push(`MSW matchers: ${result.mswMatchers.length}`);
  lines.push(`Matched: ${result.matchedRoutes.length}`);
  lines.push(`Missing: ${result.missingRoutes.length}`);

  lines.push('');
  lines.push('Missing routes by prefix:');
  for (const summary of summarizeMissingByPrefix(result.missingRoutes)) {
    lines.push(`- ${summary.prefix}: ${summary.count}`);
  }

  lines.push('');
  lines.push('First 30 missing routes:');
  for (const route of result.missingRoutes.slice(0, 30)) {
    lines.push(`- ${route.method} ${route.path} (${route.source})`);
  }

  return lines.join('\n');
};

const main = async (): Promise<void> => {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has('--json');
  const strict = args.has('--strict');

  const result = await evaluateParity();

  if (asJson) {
    const payload = {
      apiRouteCount: result.apiRoutes.length,
      mswMatcherCount: result.mswMatchers.length,
      matchedRouteCount: result.matchedRoutes.length,
      missingRouteCount: result.missingRoutes.length,
      missingByPrefix: summarizeMissingByPrefix(result.missingRoutes),
      missingRoutes: result.missingRoutes
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatTextReport(result));
  }

  if (strict && result.missingRoutes.length > 0) {
    process.exit(1);
  }
};

await main();
