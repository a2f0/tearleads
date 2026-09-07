import { createHash } from "node:crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  MAX_ROOT_IDENTITY_PAGE_SIZE,
  type RootOrganizationPageQuery,
  type RootOrganizationsQuery,
} from "@tearleads/validators/operation";
import type {
  RootOrganizationDetailResponse,
  RootOrganizationIdentitiesResponse,
  RootOrganizationsResponse,
} from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import { loadRootOrganizationDetail } from "../../workflows/root/organizationDetail";
import { listRootOrganizationIdentities } from "../../workflows/root/organizationIdentities";
import {
  getRootOrganization,
  listRootOrganizations,
} from "../../workflows/root/organizations";
import type { ApiServiceRuntime } from "../runtime";

export class RootOrganizationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}
function pageInput(query: RootOrganizationPageQuery, scope: string) {
  const cursor =
    query.cursor === undefined
      ? undefined
      : decodeCursor(
          query.cursor,
          (value) => {
            if (!isPlainObject(value)) return undefined;
            const { afterId, scope: cursorScope } = value;
            if (
              cursorScope !== scope ||
              typeof afterId !== "string" ||
              !isUuidV4String(afterId)
            )
              return undefined;
            return { afterId };
          },
          () => new RootOrganizationError("Invalid cursor", 400),
        );
  return {
    afterId: cursor?.afterId,
    limit: Math.min(Number(query.limit ?? 50), MAX_ROOT_IDENTITY_PAGE_SIZE),
  };
}
function nextCursor(afterId: string | null, scope: string) {
  return afterId === null ? null : encodeCursor({ afterId, scope });
}
export async function listOrganizations(
  runtime: ApiServiceRuntime,
  query: RootOrganizationsQuery,
): Promise<RootOrganizationsResponse> {
  // Bound the cursor even when a search contains multibyte characters or JSON escapes.
  const searchHash = createHash("sha256")
    .update(query.search?.trim().toLowerCase() ?? "")
    .digest("hex");
  const scope = `organizations:${searchHash}`;
  const result = await listRootOrganizations(runtime.db, {
    ...pageInput(query, scope),
    search: query.search,
  });
  return {
    organizations: result.organizations,
    nextCursor: nextCursor(result.nextAfterId, scope),
  };
}
export async function getOrganization(
  runtime: ApiServiceRuntime,
  organizationId: string,
): Promise<RootOrganizationDetailResponse> {
  const detail = await loadRootOrganizationDetail(runtime.db, organizationId);
  if (!detail) throw new RootOrganizationError("Organization not found", 404);
  return detail;
}
export async function getOrganizationIdentities(
  runtime: ApiServiceRuntime,
  organizationId: string,
  query: RootOrganizationPageQuery,
): Promise<RootOrganizationIdentitiesResponse> {
  const scope = `organization-identities:${organizationId}`;
  const input = pageInput(query, scope);
  if (!(await getRootOrganization(runtime.db, organizationId)))
    throw new RootOrganizationError("Organization not found", 404);
  const result = await listRootOrganizationIdentities(
    runtime.db,
    organizationId,
    input,
  );
  return {
    identities: result.identities,
    nextCursor: nextCursor(result.nextAfterId, scope),
  };
}
