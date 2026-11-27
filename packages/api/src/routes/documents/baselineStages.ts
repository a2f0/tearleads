import {
  abandonDocumentBaselineStageOperation,
  getDocumentBaselineStageOperation,
  openDocumentBaselineStageOperation,
  operationRoutePath,
  resignDocumentBaselineSegmentHeaderOperation,
  stageDocumentBaselineSegmentOperation,
} from "@tearleads/validators/operation";
import type {
  DocumentBaselineStageAbandonResponse,
  DocumentBaselineStageConflictErrorResponse,
  DocumentBaselineStageNotFoundErrorResponse,
  DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
} from "@tearleads/validators/util";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  abandonDocumentBaselineStage,
  DocumentBaselineStageBusyError,
  DocumentBaselineStageError,
  DocumentBaselineStageNotFoundError,
  getDocumentBaselineStage,
  openDocumentBaselineStage,
  resignDocumentBaselineSegmentHeader,
  stageDocumentBaselineSegment,
} from "../../services/documents/documentBaselineStages";
import type { ApiServiceRuntime } from "../../services/runtime";
import {
  jsonRequestValidator,
  requestBodyLimit,
} from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";

interface DocumentBaselineStagesRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

/**
 * A refused stage request as its response. The coded 404 is the only one a
 * stage route sends: it proves to the writer that the stage is gone. A 409
 * carries its stage code, one of those the error type admits, and the next
 * index when the segment was out of order; everything else is the bare
 * error.
 */
function respondToStageError(c: Context<SessionEnv>, error: unknown) {
  if (error instanceof DocumentBaselineStageNotFoundError) {
    return c.json<DocumentBaselineStageNotFoundErrorResponse>(
      {
        code: DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound,
        error: error.message,
      },
      404,
    );
  }
  if (!(error instanceof DocumentBaselineStageError)) throw error;
  if (error.status !== 409) {
    // Only an open that found the caller's stage in use names a delay, as
    // only the open operation declares the header. A 503 for a transaction
    // the database chose to abort, on any stage route, carries none.
    if (error instanceof DocumentBaselineStageBusyError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
    }
    return c.json({ error: error.message }, error.status);
  }
  const { code, nextSegmentIndex, openStages } = error;
  return c.json<DocumentBaselineStageConflictErrorResponse>(
    {
      ...(code === undefined ? {} : { code }),
      error: error.message,
      ...(nextSegmentIndex === undefined ? {} : { nextSegmentIndex }),
      ...(openStages === undefined
        ? {}
        : { openStages: openStages.map((stage) => ({ ...stage })) }),
    },
    409,
  );
}

function registerStageRoutes(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: DocumentBaselineStagesRouteDeps,
): void {
  route.on(
    openDocumentBaselineStageOperation.method,
    operationRoutePath(openDocumentBaselineStageOperation),
    requireAuth,
    pathParamsValidator(openDocumentBaselineStageOperation.params),
    jsonRequestValidator(openDocumentBaselineStageOperation.body),
    async (c) => {
      try {
        return c.json<DocumentBaselineStageStatusResponse>(
          await openDocumentBaselineStage(runtime, {
            documentId: c.req.valid("param").documentId,
            request: c.req.valid("json"),
            userId: c.get("session").userId,
          }),
        );
      } catch (error) {
        return respondToStageError(c, error);
      }
    },
  );
  route.on(
    getDocumentBaselineStageOperation.method,
    operationRoutePath(getDocumentBaselineStageOperation),
    requireAuth,
    pathParamsValidator(getDocumentBaselineStageOperation.params),
    async (c) => {
      try {
        return c.json<DocumentBaselineStageStatusResponse>(
          await getDocumentBaselineStage(runtime, {
            ...c.req.valid("param"),
            userId: c.get("session").userId,
          }),
        );
      } catch (error) {
        return respondToStageError(c, error);
      }
    },
  );
  route.on(
    abandonDocumentBaselineStageOperation.method,
    operationRoutePath(abandonDocumentBaselineStageOperation),
    requireAuth,
    pathParamsValidator(abandonDocumentBaselineStageOperation.params),
    async (c) => {
      try {
        return c.json<DocumentBaselineStageAbandonResponse>(
          await abandonDocumentBaselineStage(runtime, {
            ...c.req.valid("param"),
            userId: c.get("session").userId,
          }),
        );
      } catch (error) {
        return respondToStageError(c, error);
      }
    },
  );
}

function registerSegmentRoutes(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: DocumentBaselineStagesRouteDeps,
): void {
  route.on(
    stageDocumentBaselineSegmentOperation.method,
    operationRoutePath(stageDocumentBaselineSegmentOperation),
    requireAuth,
    pathParamsValidator(stageDocumentBaselineSegmentOperation.params),
    requestBodyLimit({
      maxBytes: MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
      onTooLarge: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    jsonRequestValidator(stageDocumentBaselineSegmentOperation.body),
    async (c) => {
      const { baselineId, documentId, segmentIndex } = c.req.valid("param");
      const session = c.get("session");
      try {
        return c.json<DocumentBaselineStageStatusResponse>(
          await stageDocumentBaselineSegment(runtime, {
            baselineId,
            documentId,
            fingerprint: session.fingerprint,
            segment: c.req.valid("json"),
            segmentIndex: Number(segmentIndex),
            userId: session.userId,
          }),
        );
      } catch (error) {
        return respondToStageError(c, error);
      }
    },
  );
  route.on(
    resignDocumentBaselineSegmentHeaderOperation.method,
    operationRoutePath(resignDocumentBaselineSegmentHeaderOperation),
    requireAuth,
    pathParamsValidator(resignDocumentBaselineSegmentHeaderOperation.params),
    requestBodyLimit({
      maxBytes: MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
      onTooLarge: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    jsonRequestValidator(resignDocumentBaselineSegmentHeaderOperation.body),
    async (c) => {
      const { baselineId, documentId, segmentIndex } = c.req.valid("param");
      const session = c.get("session");
      try {
        return c.json<DocumentBaselineStageStatusResponse>(
          await resignDocumentBaselineSegmentHeader(runtime, {
            baselineId,
            documentId,
            fingerprint: session.fingerprint,
            segmentIndex: Number(segmentIndex),
            userId: session.userId,
            writeHeader: c.req.valid("json").writeHeader,
          }),
        );
      } catch (error) {
        return respondToStageError(c, error);
      }
    },
  );
}

/**
 * The routes a writer stages a rotation baseline through, ahead of the
 * unlink or sync that commits it: open a stage, stage its segments in order,
 * re-sign a staged header, read the stage, abandon it.
 */
export function createDocumentBaselineStagesRoute(
  deps: DocumentBaselineStagesRouteDeps,
) {
  const route = new Hono<SessionEnv>();
  registerStageRoutes(route, deps);
  registerSegmentRoutes(route, deps);
  return route;
}
