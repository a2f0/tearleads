import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { encryptGroupMetadata } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getPrincipalStatePayloadForState,
} from "../../src/access/read/principalStateStore";
import { loadOrganizationGroupMetadataKey } from "./organizationMetadataContainer";

/** Mutations retain encrypted metadata; genesis fixtures cite the metadata container. */
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
  const organizationId = group?.organizationId ?? organizationIdForNewGroup;
  return encryptGroupMetadata({
    // A group with no row has no organization, so its policy never reaches
    // the API's name check; it keeps a fixture-only citation.
    key: organizationId
      ? await loadOrganizationGroupMetadataKey(organizationId)
      : {
          organizationId: groupId,
          containerId: "test-metadata-container",
          containerKeyEpochId: "test-metadata-epoch",
          keyMaterial: new Uint8Array(32).fill(7),
        },
    groupId,
    name: nameForNewGroup ?? "Test group",
  });
}
