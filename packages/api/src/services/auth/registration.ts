import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { RegistrationRequest } from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import {
  isDuplicateRegistrationFingerprintError,
  RegistrationError,
  runRegistrationWorkflow,
} from "../../workflows/auth/registration";
import { toOrganizationProvisioningResponse } from "../../workflows/organizations/provisionOrganizationResponse";
import type { ApiServiceRuntime } from "../runtime";

export { isDuplicateRegistrationFingerprintError, RegistrationError };

async function issueRegistrationChallenge(
  runtime: ApiServiceRuntime,
  fingerprint: string,
  signingKeyBytes: Uint8Array,
) {
  await runtime.keyValueStore.set(fingerprint, bytesToBase64(signingKeyBytes));

  const challengeBytes = generateChallenge();
  const challengeHex = bytesToHex(challengeBytes);
  await runtime.keyValueStore.set(
    `challenge:${fingerprint}`,
    challengeHex,
    CHALLENGE_TTL_SECONDS,
  );
  return challengeHex;
}

export async function registerUser(
  runtime: ApiServiceRuntime,
  input: RegistrationRequest,
  options: {
    readonly sourceIpAddress?: string | null | undefined;
  } = {},
): Promise<RegistrationResponse> {
  const signingKeyBytes = new Uint8Array(input.signingPublicKey);
  const encapsulationKeyBytes = new Uint8Array(input.encapsulationPublicKey);
  const fingerprint = await toFingerprint(signingKeyBytes);
  const encapsulationFingerprint = await toFingerprint(encapsulationKeyBytes);

  const result = await runRegistrationWorkflow(runtime.db, input, {
    encapsulationFingerprint,
    encapsulationKeyBytes,
    fingerprint,
    ip: options.sourceIpAddress ?? null,
    signingKeyBytes,
  });
  const challengeHex = await issueRegistrationChallenge(
    runtime,
    fingerprint,
    signingKeyBytes,
  );

  await runtime.eventPublisher.publish({
    type: "user_registered",
    userId: result.userId,
    fingerprint,
  });

  return {
    ...toOrganizationProvisioningResponse(result.userId, result),
    challenge: challengeHex,
  };
}
