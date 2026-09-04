import { readSignedGroupPolicyName } from "@tearleads/api-shared";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStatePayloads } from "@tearleads/api-shared/schema";
import { and, eq, gt } from "drizzle-orm";

const PAGE_SIZE = 256;

function hasGroupName(ciphertext: string): boolean {
  try {
    return readSignedGroupPolicyName(ciphertext) !== null;
  } catch {
    return false;
  }
}

/** Run with outgoing API instances stopped; policy reads still verify signatures. */
export async function assertNamedGroupPolicies(
  executor: DatabaseSession,
): Promise<void> {
  let lastId: string | undefined;
  for (;;) {
    const rows = await executor
      .select({
        id: principalStatePayloads.id,
        principalId: principalStatePayloads.principalId,
        ciphertext: principalStatePayloads.ciphertext,
      })
      .from(principalStatePayloads)
      .where(
        and(
          eq(principalStatePayloads.principalType, "group"),
          lastId === undefined
            ? undefined
            : gt(principalStatePayloads.id, lastId),
        ),
      )
      .orderBy(principalStatePayloads.id)
      .limit(PAGE_SIZE);
    const unnamed = rows.find((row) => !hasGroupName(row.ciphertext));
    if (unnamed) {
      throw new Error(
        `Group policy payload lacks its signed display name (${unnamed.principalId}); destroy and reprovision the database before deploying this release`,
      );
    }
    const last = rows.at(-1);
    if (!last || rows.length < PAGE_SIZE) return;
    lastId = last.id;
  }
}
