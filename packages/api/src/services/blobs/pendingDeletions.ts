import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  BlobBytesPathParamsSchema,
  type PendingBlobDeletionsQuery,
  type RootPendingBlobDeletionsQuery,
} from "@tearleads/validators/operation";
import type { PendingBlobDeletionsResponse } from "@tearleads/validators/response";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import {
  type PendingBlobDeletionPage,
  runListPendingBlobDeletionsWorkflow,
} from "../../workflows/blobs/pendingDeletions";
import type { ApiServiceRuntime } from "../runtime";

export class PendingBlobDeletionsError extends Error {
  readonly status = 400;
}

function pageInput(query: PendingBlobDeletionsQuery, scope: string) {
  const schema = z.custom<Record<string, unknown>>(isPlainObject).pipe(
    z.object({
      afterId: BlobBytesPathParamsSchema.shape.blobId,
      scope: z.literal(scope),
    }),
  );
  const cursor =
    query.cursor === undefined
      ? undefined
      : decodeCursor(
          query.cursor,
          (value) => schema.safeParse(value).data,
          () => new PendingBlobDeletionsError("Invalid cursor"),
        );
  return { afterId: cursor?.afterId, limit: query.limit ?? 50 };
}

function response(
  page: PendingBlobDeletionPage,
  scope: string,
): PendingBlobDeletionsResponse {
  return {
    blobs: page.blobs,
    nextAfterId:
      page.afterId === null
        ? null
        : encodeCursor({ afterId: page.afterId, scope }),
  };
}

export async function listRootPendingBlobDeletions(
  runtime: ApiServiceRuntime,
  query: RootPendingBlobDeletionsQuery,
): Promise<PendingBlobDeletionsResponse> {
  const scope = `root:pending-blob-deletions:${query.organizationId ?? "all"}`;
  return response(
    await runListPendingBlobDeletionsWorkflow(runtime.db, {
      ...pageInput(query, scope),
      access: { kind: "root", organizationId: query.organizationId },
    }),
    scope,
  );
}

export async function listOrganizationPendingBlobDeletions(
  runtime: ApiServiceRuntime,
  organizationId: string,
  userId: string,
  query: PendingBlobDeletionsQuery,
): Promise<PendingBlobDeletionsResponse> {
  const scope = `organization:pending-blob-deletions:${organizationId}`;
  return response(
    await runListPendingBlobDeletionsWorkflow(runtime.db, {
      ...pageInput(query, scope),
      access: { kind: "organization", organizationId, userId },
    }),
    scope,
  );
}
