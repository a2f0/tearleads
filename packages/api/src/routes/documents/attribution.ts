import {
  documentAttributionWireHeaderKeys,
  documentAttributionWireHeaderNames,
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ListDocumentEditAttributionRangesResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";
import type { SessionEnv } from "../../middleware/session";
import {
  DocumentEditAttributionError,
  listDocumentEditAttributionRanges,
  loadPreparedDocumentEditAttribution,
  prepareDocumentEditAttribution,
} from "../../services/documents/documentEditAttribution";
import type { ApiServiceRuntime } from "../../services/runtime";
import { headersValidator } from "../../validators/headers";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";

type LoadDocumentEditAttribution = typeof loadPreparedDocumentEditAttribution;
type ListDocumentEditAttributionRanges =
  typeof listDocumentEditAttributionRanges;
type PrepareDocumentEditAttribution = typeof prepareDocumentEditAttribution;

interface DocumentAttributionRouteDeps {
  readonly loadAttribution?: LoadDocumentEditAttribution;
  readonly listAttributionRanges?: ListDocumentEditAttributionRanges;
  readonly prepareAttribution?: PrepareDocumentEditAttribution;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface ResolvedDocumentAttributionRouteDeps {
  readonly loadAttribution: LoadDocumentEditAttribution;
  readonly listAttributionRanges: ListDocumentEditAttributionRanges;
  readonly prepareAttribution: PrepareDocumentEditAttribution;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createDocumentAttributionEtag(
  attributionRevision: number,
  attributionScope = "",
): string {
  return `W/"document-attribution-v2-${attributionScope}-${attributionRevision}"`;
}

function withoutWeakPrefix(etag: string): string {
  return /^W\//iu.test(etag) ? etag.slice(2) : etag;
}

export function ifNoneMatchMatches(
  ifNoneMatch: string | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  const expected = withoutWeakPrefix(etag);
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || withoutWeakPrefix(normalized) === expected;
  });
}

function registerCompactAttributionRoute(
  route: Hono<SessionEnv>,
  deps: ResolvedDocumentAttributionRouteDeps,
  compressAttribution: MiddlewareHandler<SessionEnv>,
): void {
  route.on(
    getDocumentAttributionOperation.method,
    operationRoutePath(getDocumentAttributionOperation),
    deps.requireAuth,
    compressAttribution,
    pathParamsValidator(getDocumentAttributionOperation.params),
    headersValidator(getDocumentAttributionOperation.headers),
    async (c) => {
      const { documentId } = c.req.valid("param");
      const headers = c.req.valid("header");
      const session = c.get("session");

      try {
        const prepared = await deps.prepareAttribution(deps.runtime, {
          documentId,
          userId: session.userId,
        });
        let etag = createDocumentAttributionEtag(
          prepared.attributionRevision,
          prepared.attributionScope,
        );
        c.header(
          documentAttributionWireHeaderNames.cacheControl,
          "private, no-cache",
        );
        c.header(documentAttributionWireHeaderNames.etag, etag);
        c.header(documentAttributionWireHeaderNames.vary, "Accept-Encoding");
        if (
          ifNoneMatchMatches(
            headers[documentAttributionWireHeaderKeys.ifNoneMatch],
            etag,
          )
        ) {
          return c.body(null, 304);
        }

        const body = await deps.loadAttribution(deps.runtime, prepared);
        etag = createDocumentAttributionEtag(
          body.attributionRevision,
          prepared.attributionScope,
        );
        c.header(documentAttributionWireHeaderNames.etag, etag);
        c.header(
          documentAttributionWireHeaderNames.contentType,
          "application/json; charset=UTF-8",
        );
        return c.body(body.json);
      } catch (error) {
        return respondToStatusError(c, error, DocumentEditAttributionError);
      }
    },
  );
}

function registerAttributionRangesRoute(
  route: Hono<SessionEnv>,
  deps: ResolvedDocumentAttributionRouteDeps,
  compressAttribution: MiddlewareHandler<SessionEnv>,
): void {
  route.on(
    listDocumentAttributionRangesOperation.method,
    operationRoutePath(listDocumentAttributionRangesOperation),
    deps.requireAuth,
    compressAttribution,
    pathParamsValidator(listDocumentAttributionRangesOperation.params),
    headersValidator(listDocumentAttributionRangesOperation.headers),
    queryParamsValidator(
      listDocumentAttributionRangesOperation.query,
      (schemaMessage) => schemaMessage ?? "Invalid request",
    ),
    async (c) => {
      const { documentId } = c.req.valid("param");
      const session = c.get("session");

      try {
        const { cursor, expectedRevision, limit } = c.req.valid("query");
        const response = await deps.listAttributionRanges(deps.runtime, {
          ...(cursor === undefined ? {} : { cursor }),
          documentId,
          ...(expectedRevision === undefined
            ? {}
            : { expectedRevision: Number(expectedRevision) }),
          ...(limit === undefined ? {} : { limit: Number(limit) }),
          userId: session.userId,
        });
        c.header(
          documentAttributionWireHeaderNames.cacheControl,
          "private, no-cache",
        );
        c.header(documentAttributionWireHeaderNames.vary, "Accept-Encoding");
        return c.json<ListDocumentEditAttributionRangesResponse>(response);
      } catch (error) {
        return respondToStatusError(c, error, DocumentEditAttributionError);
      }
    },
  );
}

export function createDocumentAttributionRoute({
  loadAttribution = loadPreparedDocumentEditAttribution,
  listAttributionRanges = listDocumentEditAttributionRanges,
  prepareAttribution = prepareDocumentEditAttribution,
  requireAuth,
  runtime,
}: DocumentAttributionRouteDeps) {
  const route = new Hono<SessionEnv>();
  const compressAttribution = compress({ threshold: 1024 });
  const deps = {
    loadAttribution,
    listAttributionRanges,
    prepareAttribution,
    requireAuth,
    runtime,
  };

  registerCompactAttributionRoute(route, deps, compressAttribution);
  registerAttributionRangesRoute(route, deps, compressAttribution);

  return route;
}
