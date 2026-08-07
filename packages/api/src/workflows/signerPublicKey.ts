import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";

export async function loadSignerPublicKey(
  executor: DatabaseSession,
  input: {
    readonly error: (message: string, status: 403) => Error;
    readonly fingerprint: string;
    readonly userId: string;
  },
): Promise<Uint8Array> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user || user.fingerprint !== input.fingerprint) {
    throw input.error("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}
