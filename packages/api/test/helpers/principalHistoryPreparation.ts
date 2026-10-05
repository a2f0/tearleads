import { db } from "@tearleads/api-shared/postgres";
import {
  principalMembershipProjection,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  type PrincipalStateExternalAuthority,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createPolicySigner,
  signPolicyState,
} from "@tearleads/crypto/principal-policy-test-fixtures";
import { bytesToBase64 } from "@tearleads/encoding";

export async function principalHistoryPreparationFixture(
  options: {
    readonly versions?: number;
    readonly signer?: Awaited<ReturnType<typeof createPolicySigner>>;
    readonly externalAuthority?: PrincipalStateExternalAuthority;
    readonly initiallyOrdinaryMember?: boolean;
  } = {},
) {
  const signer =
    options.signer ?? (await createPolicySigner(crypto.randomUUID()));
  const userKey = generateKemSeedAndKeyPair();
  await db
    .insert(users)
    .values({
      id: signer.userId,
      fingerprint: signer.signingKeyFingerprint,
      signingPublicKey: bytesToBase64(signer.signingPublicKey),
      encapsulationPublicKey: bytesToBase64(userKey.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(userKey.publicKey),
      defaultOrganizationId: crypto.randomUUID(),
    })
    .onConflictDoNothing();
  const principalId = crypto.randomUUID();
  const principalKeyPair = generateKemSeedAndKeyPair();
  const ordinaryUserId = crypto.randomUUID();
  const entries: Awaited<ReturnType<typeof signPolicyState>>[] = [];
  for (let version = 1; version <= (options.versions ?? 4); version++) {
    const projection = options.externalAuthority
      ? []
      : [
          { userId: signer.userId, role: "admin" as const },
          ...(options.initiallyOrdinaryMember
            ? [
                {
                  userId: ordinaryUserId,
                  role:
                    version === 1 ? ("member" as const) : ("admin" as const),
                },
              ]
            : []),
        ];
    const entry = await signPolicyState({
      signer,
      principalId,
      principalKeyPair,
      members: projection.map(({ userId }) => ({ userId })),
      projection,
      version,
      prevStateHash: entries.at(-1)?.state.stateHash ?? null,
      externalAuthority: options.externalAuthority ?? null,
    });
    await db
      .insert(principalStates)
      .values({ ...entry.state, signedAt: new Date(entry.state.signedAt) });
    if (projection.length)
      await db.insert(principalMembershipProjection).values(
        projection.map((member) => ({
          ...member,
          principalType: "group" as const,
          principalId,
          stateHash: entry.state.stateHash,
        })),
      );
    entries.push(entry);
  }
  const head = entries.at(-1)?.state;
  if (!head) throw new Error("Expected history fixture");
  return { entries, head, signer };
}
