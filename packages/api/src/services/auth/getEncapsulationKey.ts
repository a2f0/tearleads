import { users } from "@tearleads/api-shared/schema";
import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import type { ApiServiceRuntime } from "../runtime";

export class GetEncapsulationKeyError extends Error {
  constructor(
    message: string,
    readonly status: 404,
  ) {
    super(message);
  }
}

export async function getEncapsulationKey(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<EncapsulationKeyResponse> {
  const [user] = await runtime.db
    .select({
      encapsulationPublicKey: users.encapsulationPublicKey,
      signingPublicKey: users.signingPublicKey,
      signingKeyFingerprint: users.fingerprint,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) {
    throw new GetEncapsulationKeyError("User not found", 404);
  }

  return {
    userId,
    signingPublicKey: user.signingPublicKey,
    signingKeyFingerprint: user.signingKeyFingerprint,
    encapsulationPublicKey: user.encapsulationPublicKey,
  };
}
