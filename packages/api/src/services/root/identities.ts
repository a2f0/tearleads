import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { isUuidV4String } from "@tearleads/validators/util";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import {
  getRootIdentity,
  isRootIdentity,
} from "../../workflows/root/identityDetail";
import {
  listRootIdentityOrganizations,
  type RootIdentityOrganization,
} from "../../workflows/root/identityOrganizations";
import type { RootIdentitySummary } from "../../workflows/root/identitySummary";
import { listRootIdentities } from "../../workflows/root/listIdentities";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import type { ApiServiceRuntime } from "../runtime";

export type { RootIdentityOrganization } from "../../workflows/root/identityOrganizations";
export type { RootIdentitySummary } from "../../workflows/root/identitySummary";

const DEFAULT_ROOT_IDENTITY_PAGE_SIZE = 50;
export const MAX_ROOT_IDENTITY_PAGE_SIZE = 200;

export class RootIdentityError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

interface ListRootIdentitiesPageInput {
  readonly cursor?: string | undefined;
  readonly fingerprint?: string | undefined;
  readonly limit?: number | undefined;
}

export interface RootIdentitiesPage {
  readonly identities: readonly RootIdentitySummary[];
  readonly nextCursor: string | null;
}

interface RootIdentityCursor {
  readonly afterUserId: string;
}

function parseRootIdentityCursor(
  payload: unknown,
): RootIdentityCursor | undefined {
  if (!isPlainObject(payload)) {
    return undefined;
  }
  const { afterUserId } = payload;
  return typeof afterUserId === "string" && isUuidV4String(afterUserId)
    ? { afterUserId }
    : undefined;
}

export async function listIdentities(
  runtime: ApiServiceRuntime,
  input: ListRootIdentitiesPageInput,
): Promise<RootIdentitiesPage> {
  const cursor =
    input.cursor === undefined
      ? undefined
      : decodeCursor(
          input.cursor,
          parseRootIdentityCursor,
          () => new RootIdentityError("Invalid cursor", 400),
        );
  const limit = Math.min(
    input.limit ?? DEFAULT_ROOT_IDENTITY_PAGE_SIZE,
    MAX_ROOT_IDENTITY_PAGE_SIZE,
  );

  const result = await listRootIdentities(runtime.db, {
    afterUserId: cursor?.afterUserId,
    fingerprint: input.fingerprint,
    limit,
  });

  return {
    identities: result.identities,
    nextCursor:
      result.nextAfterUserId === null
        ? null
        : encodeCursor({ afterUserId: result.nextAfterUserId }),
  };
}

const loadIdentity = createDatabaseWorkflowService(getRootIdentity);

export async function getIdentity(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<RootIdentitySummary> {
  const identity = await loadIdentity(runtime, userId);
  if (!identity) {
    throw new RootIdentityError("User not found", 404);
  }
  return identity;
}

const loadIdentityOrganizations = createDatabaseWorkflowService(
  listRootIdentityOrganizations,
);

export async function getIdentityOrganizations(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<readonly RootIdentityOrganization[]> {
  const organizations = await loadIdentityOrganizations(runtime, userId);
  if (!organizations) {
    throw new RootIdentityError("User not found", 404);
  }
  return organizations;
}

export const hasRootAccess = createDatabaseWorkflowService(isRootIdentity);
