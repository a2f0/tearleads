import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStatePayloads } from "@tearleads/api-shared/schema";

const PAGE_SIZE = 256;

function hasGroupName(ciphertext: string): boolean {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(ciphertext, "base64").toString("utf8"),
    );
    const name: unknown =
      payload !== null && typeof payload === "object"
        ? Reflect.get(payload, "name")
        : undefined;
    return typeof name === "string" && name.trim().length > 0;
  } catch {
    return false;
  }
}

/** Deployment format check only; normal policy reads still verify signatures. */
export async function assertNamedGroupPolicies(
  executor: DatabaseSession,
): Promise<void> {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await executor
      .select({
        principalType: principalStatePayloads.principalType,
        ciphertext: principalStatePayloads.ciphertext,
      })
      .from(principalStatePayloads)
      .orderBy(principalStatePayloads.id)
      .limit(PAGE_SIZE)
      .offset(offset);
    if (
      rows.some(
        (row) => row.principalType === "group" && !hasGroupName(row.ciphertext),
      )
    ) {
      throw new Error(
        "Group policy payload lacks its signed display name; destroy and reprovision the database before deploying this release",
      );
    }
    if (rows.length < PAGE_SIZE) return;
  }
}
