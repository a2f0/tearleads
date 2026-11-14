import type { RequestResult } from "@tearleads/api-client/types";
import type {
  PendingBlobDeletionsQuery,
  RootPendingBlobDeletionsQuery,
} from "@tearleads/validators/operation";
import type { PendingBlobDeletionsResponse } from "@tearleads/validators/response";
import { type RootRequestOutcome, toOutcome } from "./identities";

export type { PendingBlobDeletion } from "@tearleads/validators/response";
export type PendingBlobDeletionsPage = PendingBlobDeletionsResponse;
export type PendingBlobDeletionsQueryInput = PendingBlobDeletionsQuery;
export type RootPendingBlobDeletionsQueryInput = RootPendingBlobDeletionsQuery;

export interface RootPendingBlobDeletionsApi {
  listRootPendingBlobDeletionsResult(
    query?: RootPendingBlobDeletionsQuery,
  ): Promise<RequestResult<PendingBlobDeletionsResponse>>;
}

export async function listRootPendingBlobDeletions(
  api: RootPendingBlobDeletionsApi,
  query: RootPendingBlobDeletionsQueryInput = {},
): Promise<RootRequestOutcome<PendingBlobDeletionsPage>> {
  return toOutcome(await api.listRootPendingBlobDeletionsResult(query));
}
