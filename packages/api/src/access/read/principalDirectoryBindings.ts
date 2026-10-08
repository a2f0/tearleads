import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalDirectoryBindings,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, desc, eq, lte } from "drizzle-orm";

/** Keep the newest candidate even if its state is corrupt; never hide it behind an older join. */
async function readBinding(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly throughVersion?: number;
  readonly groupStateHash?: string;
  readonly groupId: string;
}) {
  const [row] = await input.executor
    .select({
      organizationStateHash: principalDirectoryBindings.organizationStateHash,
      organizationVersion: principalDirectoryBindings.organizationVersion,
      groupStateHash: principalDirectoryBindings.groupStateHash,
      groupVersion: principalDirectoryBindings.groupVersion,
      payloadCiphertextHash: principalStates.payloadCiphertextHash,
    })
    .from(principalDirectoryBindings)
    .leftJoin(
      principalStates,
      and(
        eq(principalStates.principalType, "organization"),
        eq(
          principalStates.principalId,
          principalDirectoryBindings.organizationId,
        ),
        eq(
          principalStates.stateHash,
          principalDirectoryBindings.organizationStateHash,
        ),
        eq(
          principalStates.version,
          principalDirectoryBindings.organizationVersion,
        ),
      ),
    )
    .where(
      and(
        eq(principalDirectoryBindings.organizationId, input.organizationId),
        eq(principalDirectoryBindings.groupId, input.groupId),
        input.throughVersion === undefined
          ? undefined
          : lte(
              principalDirectoryBindings.organizationVersion,
              input.throughVersion,
            ),
        input.groupStateHash === undefined
          ? undefined
          : eq(principalDirectoryBindings.groupStateHash, input.groupStateHash),
      ),
    )
    .orderBy(desc(principalDirectoryBindings.organizationVersion))
    .limit(1);
  return row ?? null;
}

export function readLatestPrincipalDirectoryBinding(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly throughVersion: number;
  readonly groupId: string;
}) {
  return readBinding(input);
}

/** The unique head index records its first signed directory binding. */
export function readExactPrincipalDirectoryBinding(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly groupId: string;
  readonly groupStateHash: string;
}) {
  return readBinding(input);
}
