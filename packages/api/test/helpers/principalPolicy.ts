import { type ApiDatabase, db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  type ManagedPrincipalKind,
  toFingerprint,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { runGetCurrentPrincipalPolicyWorkflow } from "../../src/workflows/principals/getCurrentPrincipalPolicy";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "./principalState";

function verifiedPrincipalPolicyFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): VerifiedPrincipalPolicy {
  const state = bundle.currentState;
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    state,
    projection: bundle.currentProjection,
    checkpoint: {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      stateHash: state.stateHash,
    },
  } as unknown as VerifiedPrincipalPolicy;
}

export async function loadVerifiedPrincipalPolicy(
  database: ApiDatabase,
  principalType: ManagedPrincipalKind,
  principalId: string,
): Promise<VerifiedPrincipalPolicy> {
  return verifiedPrincipalPolicyFromBundle(
    await runGetCurrentPrincipalPolicyWorkflow(
      database,
      principalType,
      principalId,
    ),
  );
}

export async function createSignedPrincipalState(input: {
  externalAuthority?: Parameters<
    typeof signPrincipalStateBundle
  >[0]["externalAuthority"];
  keyEpoch?: number;
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  prevStateHash?: string | null;
  principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  principalId: string;
  principalType: "group" | "organization";
  signedAt?: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  version?: number;
  projection?: Array<{
    userId: string;
    role: "member" | "admin";
  }>;
}) {
  const principalKem = input.principalKem ?? generateKemSeedAndKeyPair();
  const projection =
    input.projection ??
    createProjectionWithAdminSigner(input.signerUserId, input.members);
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });

  return signPrincipalStateBundle({
    principalType: input.principalType,
    principalId: input.principalId,
    version: input.version ?? 1,
    prevStateHash: input.prevStateHash ?? null,
    keyEpoch: input.keyEpoch ?? 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    externalAuthority: input.externalAuthority ?? null,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify(input.members)),
    ),
    signedAt:
      input.signedAt ?? new Date("2026-04-08T16:00:00.000Z").toISOString(),
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerUserKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    memberEnvelopes,
  });
}

export async function getDefaultOrganizationId(
  userId: string,
): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected registered user");
  return user.organizationId;
}
