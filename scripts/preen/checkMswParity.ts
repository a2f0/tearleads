#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  API_INDEX_FILE,
  API_ROUTE_REGEX,
  API_ROUTES_DIR,
  type ApiRoute,
  type HttpMethod,
  LITERAL_PATH_SEGMENT_REGEX,
  type LowConfidenceRoute,
  MSW_HANDLERS_FILE,
  MSW_LITERAL_REGEX,
  MSW_WITH_OPTIONAL_V1_REGEX,
  type MswHandlerMatcher,
  type ParityResult,
  ROOT_DIR
} from './checkMswParity/types.ts';

const splitPathPatternSegments = (pathPattern: string): string[] => {
  const segments: string[] = [];
  let current = '';
  let inCharacterClass = false;
  let escaped = false;

  for (const char of pathPattern) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (char === '[' && !inCharacterClass) {
      inCharacterClass = true;
      current += char;
      continue;
    }

    if (char === ']' && inCharacterClass) {
      inCharacterClass = false;
      current += char;
      continue;
    }

    if (char === '/' && !inCharacterClass) {
      if (current.length > 0) {
        segments.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
};

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

      return [];
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

const classifyOptionalV1PathPattern = (
  pathPattern: string
): { confidence: 'high' | 'low'; reason?: string } => {
  if (!pathPattern.startsWith('/')) {
    return {
      confidence: 'low',
      reason: 'pattern is not rooted at "/"'
    };
  }

  const segments = splitPathPatternSegments(pathPattern);
  for (const segment of segments) {
    if (segment === '[^/]+') {
      continue;
    }

    if (LITERAL_PATH_SEGMENT_REGEX.test(segment)) {
      continue;
    }

    return {
      confidence: 'low',
      reason: `segment "${segment}" uses broad regex syntax`
    };
  }

  return { confidence: 'high' };
};

const classifyRegexSourcePattern = (
  sourcePattern: string
): { confidence: 'high' | 'low'; reason?: string } => {
  const startsAnchored = sourcePattern.startsWith('^');
  const endsAnchored = sourcePattern.endsWith('$');
  if (!startsAnchored || !endsAnchored) {
    return {
      confidence: 'low',
      reason: 'regex matcher is not fully anchored'
    };
  }

  if (/(\.\*|\.\+)/.test(sourcePattern)) {
    return {
      confidence: 'low',
      reason: 'regex matcher contains wildcard catch-all token'
    };
  }

  return { confidence: 'high' };
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
    const classification = classifyRegexSourcePattern(sourcePattern);
    return {
      method,
      sourcePattern,
      regex: new RegExp(sourcePattern, flags),
      confidence: classification.confidence,
      ...(classification.reason === undefined
        ? {}
        : { confidenceReason: classification.reason })
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
      regex: new RegExp(`^${escaped}$`),
      confidence: 'high'
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
    const methodValue = optionalV1Match[1];
    const pathPattern = optionalV1Match[2];
    if (methodValue === undefined || pathPattern === undefined) {
      optionalV1Match = optionalV1Regex.exec(content);
      continue;
    }
    const method = toMethod(methodValue);
    const sourcePattern = `^(?:/v1)?${pathPattern}$`;
    const classification = classifyOptionalV1PathPattern(pathPattern);
    results.push({
      method,
      sourcePattern,
      regex: new RegExp(sourcePattern),
      confidence: classification.confidence,
      ...(classification.reason === undefined
        ? {}
        : { confidenceReason: classification.reason })
    });

    optionalV1Match = optionalV1Regex.exec(content);
  }

  if (results.length === 0) {
    const literalRegex = new RegExp(MSW_LITERAL_REGEX);
    let literalMatch: RegExpExecArray | null = literalRegex.exec(content);
    while (literalMatch) {
      const methodValue = literalMatch[1];
      const literal = literalMatch[2];
      if (methodValue === undefined || literal === undefined) {
        literalMatch = literalRegex.exec(content);
        continue;
      }

      const matcher = buildMatcherFromLiteral(methodValue, literal);
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
  const lowConfidenceRoutes: LowConfidenceRoute[] = [];

  for (const route of apiRoutes) {
    const samplePath = samplePathForRoute(route.path);
    const matchingMatchers = mswMatchers.filter(
      (matcher) =>
        matcher.method === route.method && matcher.regex.test(samplePath)
    );

    if (matchingMatchers.length > 0) {
      matchedRoutes.push(route);
      const hasHighConfidenceMatch = matchingMatchers.some(
        (matcher) => matcher.confidence === 'high'
      );
      if (!hasHighConfidenceMatch) {
        const reasons = [
          ...new Set(
            matchingMatchers
              .map((matcher) => matcher.confidenceReason)
              .filter((reason): reason is string => Boolean(reason))
          )
        ];

        lowConfidenceRoutes.push({
          route,
          matcherPatterns: matchingMatchers.map(
            (matcher) => matcher.sourcePattern
          ),
          reasons
        });
      }
    } else {
      missingRoutes.push(route);
    }
  }

  return {
    apiRoutes,
    mswMatchers,
    matchedRoutes,
    missingRoutes,
    lowConfidenceRoutes
  };
};

const summarizeRoutesByPrefix = (
  routes: ApiRoute[]
): Array<{ prefix: string; count: number }> => {
  const counts = new Map<string, number>();

  for (const route of routes) {
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
  lines.push(`Low-confidence matches: ${result.lowConfidenceRoutes.length}`);

  lines.push('');
  lines.push('Missing routes by prefix:');
  for (const summary of summarizeRoutesByPrefix(result.missingRoutes)) {
    lines.push(`- ${summary.prefix}: ${summary.count}`);
  }

  lines.push('');
  lines.push('First 30 missing routes:');
  for (const route of result.missingRoutes.slice(0, 30)) {
    lines.push(`- ${route.method} ${route.path} (${route.source})`);
  }

  lines.push('');
  lines.push('Low-confidence routes by prefix:');
  for (const summary of summarizeRoutesByPrefix(
    result.lowConfidenceRoutes.map((entry) => entry.route)
  )) {
    lines.push(`- ${summary.prefix}: ${summary.count}`);
  }

  lines.push('');
  lines.push('First 30 low-confidence routes:');
  for (const entry of result.lowConfidenceRoutes.slice(0, 30)) {
    const reason =
      entry.reasons.length > 0 ? ` | reasons: ${entry.reasons.join('; ')}` : '';
    lines.push(
      `- ${entry.route.method} ${entry.route.path} (${entry.route.source}) | matchers: ${entry.matcherPatterns.join(', ')}${reason}`
    );
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
      lowConfidenceRouteCount: result.lowConfidenceRoutes.length,
      missingByPrefix: summarizeRoutesByPrefix(result.missingRoutes),
      missingRoutes: result.missingRoutes,
      lowConfidenceByPrefix: summarizeRoutesByPrefix(
        result.lowConfidenceRoutes.map((entry) => entry.route)
      ),
      lowConfidenceRoutes: result.lowConfidenceRoutes
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatTextReport(result));
  }

  if (
    strict &&
    (result.missingRoutes.length > 0 || result.lowConfidenceRoutes.length > 0)
  ) {
    process.exit(1);
  }
};

await main();
