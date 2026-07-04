import type { TestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { isRegistrationResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { submitRegistration } from "./api";
import { enableTestOrganizationSync } from "./organizationBilling";

export async function registerUser(user: TestUser): Promise<string> {
  user.fingerprint = await toFingerprint(user.signing.signingPublicKey);

  const res = await submitRegistration(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
  );
  if (res.status !== 200) {
    throw new Error(`submitRegistration failed with status ${res.status}`);
  }

  const body = await res.json();
  invariant(isRegistrationResponse(body), "expected register response");
  user.userId = body.userId;
  user.rootContainerId = body.rootContainerId;
  await enableTestOrganizationSync(body.organizationId);
  return body.challenge;
}
