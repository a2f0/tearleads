import type {
  OrganizationContainerGrantResponse,
  OrganizationContainerGrantsResponse,
} from "@tearleads/validators/response";
import {
  isOrganizationContainerGrantSubjectType,
  isOrganizationGroupContainerAccessLevel,
} from "@tearleads/validators/response";
import { asc, eq } from "drizzle-orm";
import { organizationReadModelContainerGrants } from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { OrganizationReadModelIntegrityError } from "./organizationReadModelProtocol";

const GRANT_INSERT_BATCH_SIZE = 40;

type SelectedGrant = typeof organizationReadModelContainerGrants.$inferSelect;

function grantIdentity(
  grant: Pick<
    OrganizationContainerGrantResponse,
    "containerId" | "subjectId" | "subjectType"
  >,
): string {
  return `${grant.containerId}\0${grant.subjectType}\0${grant.subjectId}`;
}

function hasValidGrantSubjectBinding(
  grant: OrganizationContainerGrantResponse,
): boolean {
  const validUser =
    grant.subjectType === "user" &&
    grant.userId === grant.subjectId &&
    grant.groupId === null &&
    grant.groupName === null;
  const validGroup =
    grant.subjectType === "group" &&
    grant.userId === null &&
    grant.signingKeyFingerprint === null &&
    grant.groupId === grant.subjectId;
  return validUser || validGroup;
}

function assertGrantsLane(input: {
  readonly lane: OrganizationContainerGrantsResponse;
  readonly organizationId: string;
}): void {
  if (input.lane.organizationId !== input.organizationId) {
    throw new Error("Organization read-model grants scope does not match");
  }
  const identities = input.lane.grants.map(grantIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Organization read-model grants contain duplicates");
  }
  for (const grant of input.lane.grants) {
    if (!hasValidGrantSubjectBinding(grant)) {
      throw new Error(
        "Organization read-model grant subject binding is invalid",
      );
    }
  }
}

export async function applyOrganizationReadModelGrantsLane(input: {
  readonly lane: OrganizationContainerGrantsResponse;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  assertGrantsLane(input);
  await input.tx
    .delete(organizationReadModelContainerGrants)
    .where(
      eq(
        organizationReadModelContainerGrants.organizationId,
        input.organizationId,
      ),
    )
    .run();

  const rows = input.lane.grants.map((grant, sortOrder) => ({
    ...grant,
    organizationId: input.organizationId,
    sortOrder,
  }));
  for (let index = 0; index < rows.length; index += GRANT_INSERT_BATCH_SIZE) {
    await input.tx
      .insert(organizationReadModelContainerGrants)
      .values(rows.slice(index, index + GRANT_INSERT_BATCH_SIZE))
      .run();
  }
}

function toGrant(row: SelectedGrant): OrganizationContainerGrantResponse {
  if (!isOrganizationGroupContainerAccessLevel(row.accessLevel)) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization grant access level is invalid",
    );
  }
  if (!isOrganizationContainerGrantSubjectType(row.subjectType)) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization grant subject type is invalid",
    );
  }
  const grant: OrganizationContainerGrantResponse = {
    accessLevel: row.accessLevel,
    containerId: row.containerId,
    createdAt: row.createdAt,
    depth: row.depth,
    isBuiltin: row.isBuiltin,
    metadataAccessEpoch: row.metadataAccessEpoch,
    metadataAccessStateHash: row.metadataAccessStateHash,
    metadataDocumentId: row.metadataDocumentId,
    parentId: row.parentId,
    updatedAt: row.updatedAt,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    userId: row.userId,
    signingKeyFingerprint: row.signingKeyFingerprint,
    groupId: row.groupId,
    groupName: row.groupName,
  };
  if (!hasValidGrantSubjectBinding(grant)) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization grant subject binding is invalid",
    );
  }
  return grant;
}

export async function loadOrganizationReadModelGrantsInTransaction(input: {
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<OrganizationContainerGrantsResponse> {
  const rows = await input.tx
    .select()
    .from(organizationReadModelContainerGrants)
    .where(
      eq(
        organizationReadModelContainerGrants.organizationId,
        input.organizationId,
      ),
    )
    .orderBy(
      asc(organizationReadModelContainerGrants.sortOrder),
      asc(organizationReadModelContainerGrants.containerId),
      asc(organizationReadModelContainerGrants.subjectType),
      asc(organizationReadModelContainerGrants.subjectId),
    );
  return {
    organizationId: input.organizationId,
    grants: rows.map(toGrant),
  };
}
