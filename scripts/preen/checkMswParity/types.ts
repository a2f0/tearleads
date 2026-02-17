import path from 'node:path';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRoute {
  method: HttpMethod;
  path: string;
  source: string;
}

export interface MswHandlerMatcher {
  method: HttpMethod;
  sourcePattern: string;
  regex: RegExp;
  confidence: 'high' | 'low';
  confidenceReason?: string;
}

export interface LowConfidenceRoute {
  route: ApiRoute;
  matcherPatterns: string[];
  reasons: string[];
}

export interface ParityResult {
  apiRoutes: ApiRoute[];
  mswMatchers: MswHandlerMatcher[];
  matchedRoutes: ApiRoute[];
  missingRoutes: ApiRoute[];
  lowConfidenceRoutes: LowConfidenceRoute[];
}

export const API_ROUTE_REGEX =
  /\b(?:routeRouter|authRouter|adminContextRouter)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
export const MSW_WITH_OPTIONAL_V1_REGEX =
  /http\.(get|post|put|patch|delete)\(\s*withOptionalV1Prefix\('([^']+)'\)/g;
export const MSW_LITERAL_REGEX =
  /http\.(get|post|put|patch|delete)\(\s*(\/[^/]*\/[^,]+|`[^`]+`|'[^']+'|"[^"]+")/g;

const rootDir = process.cwd();
export const API_ROUTES_DIR = path.join(
  rootDir,
  'packages',
  'api',
  'src',
  'routes'
);
export const API_INDEX_FILE = path.join(
  rootDir,
  'packages',
  'api',
  'src',
  'index.ts'
);
export const MSW_HANDLERS_FILE = path.join(
  rootDir,
  'packages',
  'msw',
  'src',
  'handlers.ts'
);
export const ROOT_DIR = rootDir;

export const LITERAL_PATH_SEGMENT_REGEX = /^[A-Za-z0-9._~-]+$/;
