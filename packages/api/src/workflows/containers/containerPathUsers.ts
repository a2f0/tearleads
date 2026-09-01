import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalMembershipProjection } from "@tearleads/api-shared/schema";
import type {
  ContainerDirectGrant,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { sql } from "drizzle-orm";
import { uuidValue } from "../../utils/sqlDialect";

interface ContainerPathUserIds {
  readonly allUserIds: readonly string[];
  readonly userIdsByContainerId: ReadonlyMap<string, readonly string[]>;
}

type PrincipalReference = Pick<
  ReferencedPrincipalHead,
  "principalId" | "principalType" | "stateHash"
>;

interface ManagedGrantUserRow {
  readonly principalId: string;
  readonly principalType: string;
  readonly stateHash: string;
  readonly userId: string;
}

interface ManagedGrantReference {
  readonly containerId: string;
  readonly principalReference: PrincipalReference;
}

function referencedPrincipalHeadForGrant(input: {
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}) {
  const { grant, manifest } = input;
  if (grant.subjectType === "user") {
    return null;
  }

  return (
    manifest.state.referencedPrincipalHeads.find(
      (principalHead) =>
        principalHead.principalType === grant.subjectType &&
        principalHead.principalId === grant.subjectId,
    ) ?? null
  );
}

function principalReferenceKey(reference: {
  readonly principalId: string;
  readonly principalType: string;
  readonly stateHash: string;
}): string {
  return `${reference.principalType}:${reference.principalId}:${reference.stateHash}`;
}

function addValue<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const values = map.get(key);
  if (values) {
    values.add(value);
    return;
  }

  map.set(key, new Set([value]));
}

function isManagedGrantUserRow(value: unknown): value is ManagedGrantUserRow {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "principalId") === "string" &&
    typeof Reflect.get(value, "principalType") === "string" &&
    typeof Reflect.get(value, "stateHash") === "string" &&
    typeof Reflect.get(value, "userId") === "string"
  );
}

async function userIdsForManagedGrantReferences(input: {
  readonly executor: DatabaseTransaction;
  readonly references: readonly PrincipalReference[];
}): Promise<Map<string, string[]>> {
  const uniqueReferences = new Map<string, PrincipalReference>();
  for (const reference of input.references) {
    uniqueReferences.set(principalReferenceKey(reference), reference);
  }

  const usersByReference = new Map<string, Set<string>>();
  for (const key of uniqueReferences.keys()) {
    usersByReference.set(key, new Set());
  }
  const references = [...uniqueReferences.values()];
  if (references.length === 0) {
    return new Map();
  }

  const result = await input.executor.execute(sql`
    with recursive referenced_principals(
      principal_type,
      principal_id,
      state_hash
    ) as (
      values ${sql.join(
        references.map(
          (reference) =>
            sql`(${reference.principalType}, ${uuidValue(reference.principalId)}, ${reference.stateHash})`,
        ),
        sql`, `,
      )}
    ),
    -- Members ARE the reachable users; there is no nested tier to descend.
    direct_members as (
      select
        referenced_principals.principal_type as root_principal_type,
        referenced_principals.principal_id as root_principal_id,
        referenced_principals.state_hash as root_state_hash,
        members.user_id
      from referenced_principals
      inner join ${principalMembershipProjection} members
        on members.principal_type = referenced_principals.principal_type
        and members.principal_id = referenced_principals.principal_id
        and members.state_hash = referenced_principals.state_hash
    )
    select distinct
      root_principal_type as "principalType",
      root_principal_id as "principalId",
      root_state_hash as "stateHash",
      user_id as "userId"
    from direct_members
  `);

  for (const row of result.rows) {
    if (!isManagedGrantUserRow(row)) {
      throw new Error("Unexpected row shape from managed grant user query");
    }

    addValue(usersByReference, principalReferenceKey(row), row.userId);
  }

  return new Map(
    [...usersByReference].map(([key, userIds]) => [key, [...userIds].sort()]),
  );
}

async function userIdsForManagedGrant(input: {
  readonly executor: DatabaseTransaction;
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  const referencedPrincipalHead = referencedPrincipalHeadForGrant({
    grant: input.grant,
    manifest: input.manifest,
  });
  if (!referencedPrincipalHead) {
    return [];
  }

  const usersByReference = await userIdsForManagedGrantReferences({
    executor: input.executor,
    references: [referencedPrincipalHead],
  });

  return (
    usersByReference.get(principalReferenceKey(referencedPrincipalHead)) ?? []
  );
}

export async function userIdsForGrant(input: {
  readonly executor: DatabaseTransaction;
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  if (input.grant.subjectType === "user") {
    return [input.grant.subjectId];
  }

  return userIdsForManagedGrant(input);
}

export async function userIdsByContainerPath(input: {
  readonly executor: DatabaseTransaction;
  readonly path: readonly VerifiedContainerAccessManifest[];
}): Promise<ContainerPathUserIds> {
  const managedGrantReferences: ManagedGrantReference[] = [];
  const userIdsByContainerId = new Map<string, Set<string>>();

  for (const manifest of input.path) {
    const containerId = manifest.state.containerId;
    for (const grant of manifest.state.directGrants) {
      if (grant.subjectType === "user") {
        addValue(userIdsByContainerId, containerId, grant.subjectId);
        continue;
      }

      const referencedPrincipalHead = referencedPrincipalHeadForGrant({
        grant,
        manifest,
      });
      if (referencedPrincipalHead) {
        managedGrantReferences.push({
          containerId,
          principalReference: referencedPrincipalHead,
        });
      }
    }
  }

  const usersByReference = await userIdsForManagedGrantReferences({
    executor: input.executor,
    references: managedGrantReferences.map(
      (reference) => reference.principalReference,
    ),
  });

  for (const reference of managedGrantReferences) {
    for (const userId of usersByReference.get(
      principalReferenceKey(reference.principalReference),
    ) ?? []) {
      addValue(userIdsByContainerId, reference.containerId, userId);
    }
  }

  const allUserIds = new Set<string>();
  const resultUserIdsByContainerId = new Map<string, string[]>();
  for (const [containerId, userIds] of userIdsByContainerId) {
    const sortedUserIds = [...userIds].sort();
    resultUserIdsByContainerId.set(containerId, sortedUserIds);
    for (const userId of sortedUserIds) {
      allUserIds.add(userId);
    }
  }

  return {
    allUserIds: [...allUserIds].sort(),
    userIdsByContainerId: resultUserIdsByContainerId,
  };
}

export async function userIdsWithReadableAccessThroughPath(input: {
  readonly executor: DatabaseTransaction;
  readonly path: readonly VerifiedContainerAccessManifest[];
}): Promise<string[]> {
  const result = await userIdsByContainerPath(input);
  return [...result.allUserIds];
}
