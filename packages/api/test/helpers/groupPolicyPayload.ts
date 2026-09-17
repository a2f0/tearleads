import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { encryptGroupMetadata } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getPrincipalStatePayloadForState,
} from "../../src/access/read/principalStateStore";

/** Mutations retain encrypted metadata; genesis fixtures use a test-only key. */
export async function groupPolicyPayload(
  groupId: string,
  _members: unknown,
  nameForNewGroup?: string,
  organizationIdForNewGroup?: string,
): Promise<string> {
  const current = await getCurrentPrincipalState("group", groupId, db);
  if (current) {
    const payload = await getPrincipalStatePayloadForState(
      "group",
      groupId,
      current.stateHash,
      db,
    );
    if (!payload) throw new Error("Expected test group payload");
    return payload.ciphertext;
  }
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return encryptGroupMetadata({
    key: {
      organizationId:
        group?.organizationId ?? organizationIdForNewGroup ?? groupId,
      containerId: "test-metadata-container",
      containerKeyEpochId: "test-metadata-epoch",
      keyMaterial: new Uint8Array(32).fill(7),
    },
    groupId,
    name: nameForNewGroup ?? "Test group",
  });
}
