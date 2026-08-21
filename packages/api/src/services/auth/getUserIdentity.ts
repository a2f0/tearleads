import { users } from "@symcrypt/api-shared/schema";
import type { UserIdentityResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import type { ApiServiceRuntime } from "../runtime";

export class GetUserIdentityError extends Error {
  constructor(
    message: string,
    readonly status: 404,
  ) {
    super(message);
  }
}

export async function getUserIdentity(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<UserIdentityResponse> {
  const [user] = await runtime.db
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      encapsulationPublicKey: users.encapsulationPublicKey,
      signingPublicKey: users.signingPublicKey,
      signingKeyFingerprint: users.fingerprint,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) {
    throw new GetUserIdentityError("User not found", 404);
  }

  return {
    userId,
    signingPublicKey: user.signingPublicKey,
    signingKeyFingerprint: user.signingKeyFingerprint,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}
