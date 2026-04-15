import { createTestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { registerPublicKey } from "../../src/services/auth/registerPublicKey";
import {
  createPublicKeyRequest,
  createServiceTestRuntime,
} from "./serviceRuntime";

export async function registerServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);

  return { fingerprint, registration, user };
}
