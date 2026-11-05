import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { toFingerprint } from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import { isRegistrationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { submitRegistration } from "./api";
import { authenticate } from "./authenticate";

export async function registerUser(user: TestUser): Promise<string> {
  user.fingerprint = await toFingerprint(user.signing.signingPublicKey);

  const res = await submitRegistration(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
  );
  if (res.status !== 200) {
    throw new Error(
      `submitRegistration failed with status ${res.status}: ${await res.text()}`,
    );
  }

  const body = await res.json();
  invariant(isRegistrationResponse(body), "expected register response");
  user.userId = body.userId;
  user.rootContainerId = body.rootContainerId;
  return body.challenge;
}

export async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

/** Registers and signs in `user`, returning its default organization's id. */
export async function registerAndAuthenticateWithOrganization(
  user: TestUser,
): Promise<string> {
  await registerAndAuthenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}
