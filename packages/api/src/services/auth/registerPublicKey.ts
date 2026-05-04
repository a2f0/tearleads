import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import {
  isDuplicateRegisterFingerprintError,
  RegisterPublicKeyError,
  runRegisterPublicKeyWorkflow,
} from "../../workflows/auth/registerPublicKey";
import type { ApiServiceRuntime } from "../runtime";

export { isDuplicateRegisterFingerprintError, RegisterPublicKeyError };

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

export async function registerPublicKey(
  runtime: ApiServiceRuntime,
  input: PublicKeyRequest,
): Promise<PublicKeyResponse> {
  const signingKeyBytes = new Uint8Array(input.signingPublicKey);
  const encapsulationKeyBytes = new Uint8Array(input.encapsulationPublicKey);
  const fingerprint = await toFingerprint(signingKeyBytes);
  const encapsulationFingerprint = await toFingerprint(encapsulationKeyBytes);

  const result = await runRegisterPublicKeyWorkflow(runtime.db, input, {
    encapsulationFingerprint,
    encapsulationKeyBytes,
    fingerprint,
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
    message: "ok",
    userId: result.userId,
    organizationId: result.organizationId,
    rootContainerId: result.rootContainerId,
    rootMetadataDocumentId: result.rootMetadataDocumentId,
    rootMetadataAccessEpoch: result.rootMetadataAccessEpoch,
    rootMetadataAccessStateHash: result.rootMetadataAccessStateHash,
    rootMetadataDocument: result.rootMetadataDocument,
    challenge: challengeHex,
  };
}
