import type {
  ListOrganizationGroupsResponse,
  OrganizationGroupCurrentStateResponse,
  OrganizationReadModelOrganizationPolicyResponse,
} from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import { organizationReadModelPolicyHeads } from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import type { OrganizationReadModelPolicyHead } from "./organizationReadModelProjection";

const POLICY_HEAD_INSERT_BATCH_SIZE = 100;

function toPolicyHeadRow(input: {
  readonly currentState: OrganizationGroupCurrentStateResponse;
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: OrganizationReadModelPolicyHead["principalType"];
}) {
  return {
    organizationId: input.organizationId,
    principalType: input.principalType,
    principalId: input.principalId,
    stateHash: input.currentState.stateHash,
    stateVersion: input.currentState.version,
    keyEpoch: input.currentState.keyEpoch,
    keyFingerprint: input.currentState.keyFingerprint,
    memberCount: input.currentState.memberCount,
  };
}

export async function replaceGroupPolicyHeads(input: {
  readonly groups: ListOrganizationGroupsResponse;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await input.tx
    .delete(organizationReadModelPolicyHeads)
    .where(
      and(
        eq(
          organizationReadModelPolicyHeads.organizationId,
          input.organizationId,
        ),
        eq(organizationReadModelPolicyHeads.principalType, "group"),
      ),
    )
    .run();

  const rows = input.groups.groups.flatMap((group) =>
    group.currentState
      ? [
          toPolicyHeadRow({
            currentState: group.currentState,
            organizationId: input.organizationId,
            principalId: group.groupId,
            principalType: "group",
          }),
        ]
      : [],
  );
  for (
    let index = 0;
    index < rows.length;
    index += POLICY_HEAD_INSERT_BATCH_SIZE
  ) {
    await input.tx
      .insert(organizationReadModelPolicyHeads)
      .values(rows.slice(index, index + POLICY_HEAD_INSERT_BATCH_SIZE))
      .run();
  }
}

export async function applyOrganizationPolicyLane(input: {
  readonly organizationId: string;
  readonly organizationPolicy: OrganizationReadModelOrganizationPolicyResponse;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const row = toPolicyHeadRow({
    currentState: input.organizationPolicy.currentState,
    organizationId: input.organizationId,
    principalId: input.organizationId,
    principalType: "organization",
  });
  await input.tx
    .insert(organizationReadModelPolicyHeads)
    .values(row)
    .onConflictDoUpdate({
      target: [
        organizationReadModelPolicyHeads.organizationId,
        organizationReadModelPolicyHeads.principalType,
        organizationReadModelPolicyHeads.principalId,
      ],
      set: {
        stateHash: row.stateHash,
        stateVersion: row.stateVersion,
        keyEpoch: row.keyEpoch,
        keyFingerprint: row.keyFingerprint,
        memberCount: row.memberCount,
      },
    })
    .run();
}
