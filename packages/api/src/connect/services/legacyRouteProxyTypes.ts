import type { JwtClaims } from '../../lib/jwt.js';
import type { SessionData } from '../../lib/sessions.js';

export type LegacyHandlerContext = {
  requestHeader: Headers;
};

export interface LegacyCallOptions {
  context: LegacyHandlerContext;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: URLSearchParams;
  jsonBody?: string;
  binaryBody?: Uint8Array;
  extraHeaders?: Record<string, string>;
}

export interface LegacyBinaryResponse {
  data: Uint8Array;
  contentType?: string;
}

export type RouteMethod = LegacyCallOptions['method'];

export type RouteHandler = (request: unknown, response: unknown) => unknown;

export type AdminAccessContext = {
  isRootAdmin: boolean;
  organizationIds: string[];
};

export type RequestQueryValue = string | string[] | undefined;

export type RequestQuery = Record<string, RequestQueryValue>;

export type RouteDefinition = {
  method: RouteMethod;
  pattern: string;
  handler: RouteHandler;
};

export type RouteExecutionResult = {
  status: number;
  body: unknown;
  contentType?: string;
};

export type UnknownRecord = Record<string, unknown>;

export type AdapterRequest = {
  method: RouteMethod;
  path: string;
  params: Record<string, string>;
  query: RequestQuery;
  body: unknown;
  authClaims?: JwtClaims;
  session?: SessionData;
  adminAccess?: AdminAccessContext;
  organizationId?: string;
  get: (name: string) => string | undefined;
  header: (name: string) => string | undefined;
};

export type AdapterResponse = {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (status: number) => AdapterResponse;
  json: (payload: unknown) => AdapterResponse;
  send: (payload?: unknown) => AdapterResponse;
  setHeader: (name: string, value: unknown) => void;
  set: (name: string, value: unknown) => AdapterResponse;
  type: (value: string) => AdapterResponse;
  end: (payload?: unknown) => AdapterResponse;
};

export type AuthResult =
  | { ok: true; claims: JwtClaims; session: SessionData }
  | { ok: false; status: number; error: string };

export type OrganizationMembershipResult =
  | { ok: true; organizationId: string | null }
  | { ok: false; status: number; error: string };

export type AdminAccessResult =
  | { ok: true; adminAccess: AdminAccessContext | null }
  | { ok: false; status: number; error: string };
