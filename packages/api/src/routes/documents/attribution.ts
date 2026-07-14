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

function parseOptionalRangeLimit(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
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

export function createDocumentAttributionRoute({
  loadAttribution = loadPreparedDocumentEditAttribution,
  listAttributionRanges = listDocumentEditAttributionRanges,
  prepareAttribution = prepareDocumentEditAttribution,
  requireAuth,
  runtime,
}: DocumentAttributionRouteDeps) {
  const route = new Hono<SessionEnv>();
  const compressAttribution = compress({ threshold: 1024 });

  route.get(
    "/documents/:documentId/attribution",
    requireAuth,
    compressAttribution,
    async (c) => {
      const documentId = c.req.param("documentId");
      const session = c.get("session");

      try {
        const prepared = await prepareAttribution(runtime, {
          documentId,
          userId: session.userId,
        });
        let etag = createDocumentAttributionEtag(
          prepared.attributionRevision,
          prepared.attributionScope,
        );
        c.header("Cache-Control", "private, no-cache");
        c.header("ETag", etag);
        c.header("Vary", "Accept-Encoding");
        if (ifNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
          return c.body(null, 304);
        }

        const body = await loadAttribution(runtime, prepared);
        etag = createDocumentAttributionEtag(
          body.attributionRevision,
          prepared.attributionScope,
        );
        c.header("ETag", etag);
        c.header("Content-Type", "application/json; charset=UTF-8");
        return c.body(body.json);
      } catch (error) {
        if (error instanceof DocumentEditAttributionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  route.get(
    "/documents/:documentId/attribution/ranges",
    requireAuth,
    compressAttribution,
    async (c) => {
      const documentId = c.req.param("documentId");
      const session = c.get("session");
      const cursor = c.req.query("cursor");
      const expectedRevision = parseOptionalRangeLimit(
        c.req.query("expectedRevision"),
      );
      const limit = parseOptionalRangeLimit(c.req.query("limit"));

      try {
        const response = await listAttributionRanges(runtime, {
          ...(cursor === undefined ? {} : { cursor }),
          documentId,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          ...(limit === undefined ? {} : { limit }),
          userId: session.userId,
        });
        c.header("Cache-Control", "private, no-cache");
        c.header("Vary", "Accept-Encoding");
        return c.json<ListDocumentEditAttributionRangesResponse>(response);
      } catch (error) {
        if (error instanceof DocumentEditAttributionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
