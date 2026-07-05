import { createTestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { registerUser } from "../../src/services/auth/registration";
import {
  createRegistrationRequest,
  createServiceTestRuntime,
} from "./serviceRuntime";

export async function registerServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerUser(
    runtime,
    await createRegistrationRequest(user),
  );
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);

  return { fingerprint, registration, user };
}
