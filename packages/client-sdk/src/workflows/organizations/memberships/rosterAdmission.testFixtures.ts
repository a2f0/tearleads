import {
  AES_GCM_TAG_BYTES,
  computePrincipalMemberEnvelopesRoot,
  computeUserIdentityBundleFingerprint,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyStateChainEntryResponse,
} from "@tearleads/validators/response";
import type {
  RosterAdmissionEvidence,
  RosterAdmissionPin,
} from "./rosterVouchedAdmission";

const MEMBERS_ID = "members-group";
export const GOOD_KEY = "a".repeat(64);
export const SUBSTITUTED_KEY = "b".repeat(64);
const KEM_CIPHERTEXT = bytesToBase64(
  new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES),
);
const WRAPPED_KEY = bytesToBase64(
  new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES),
);

interface StateSpec {
  /** Member user id -> committed encryption-key fingerprint. */
  readonly members: Readonly<Record<string, string>>;
  readonly signer: string;
}

interface Fixture {
  readonly entries: PrincipalPolicyStateChainEntryResponse[];
  readonly envelopesByHash: Map<string, PrincipalMemberEnvelopeResponse[]>;
}

async function envelopesFor(
  members: StateSpec["members"],
): Promise<PrincipalMemberEnvelopeResponse[]> {
  return Promise.all(
    Object.entries(members).map(async ([userId, keyLabel]) => ({
      kemCipherText: KEM_CIPHERTEXT,
      memberKeyFingerprint: (await pin(userId, false, keyLabel))
        .encapsulationKeyFingerprint,
      userId,
      wrappedKey: WRAPPED_KEY,
    })),
  );
}

// A verified Members history: one signed state per spec, version 1 first.
export async function membersHistory(
  specs: readonly StateSpec[],
): Promise<Fixture> {
  const entries: PrincipalPolicyStateChainEntryResponse[] = [];
  const envelopesByHash = new Map<string, PrincipalMemberEnvelopeResponse[]>();
  for (const [index, spec] of specs.entries()) {
    const version = index + 1;
    const envelopes = await envelopesFor(spec.members);
    const stateHash = `members-state-${version}`;
    envelopesByHash.set(stateHash, envelopes);
    entries.push({
      grants: [],
      projection: await Promise.all(
        Object.keys(spec.members).map(async (userId) => ({
          role:
            userId === "admin-a" || userId === "admin-b" ? "admin" : "member",
          userId,
          identityBundleFingerprint: (
            await pin(userId, false, spec.members[userId] ?? GOOD_KEY)
          ).identityBundleFingerprint,
        })),
      ),
      state: {
        createdAt: "2026-11-01T00:00:00.000Z",
        encapsulationPublicKey: "group-key",
        externalAuthority: null,
        grantCount: 0,
        grantRoot: "grant-root",
        keyEpoch: version,
        keyFingerprint: `members-key-${version}`,
        memberCount: envelopes.length,
        memberEnvelopesRoot:
          await computePrincipalMemberEnvelopesRoot(envelopes),
        membershipMode: "projection",
        membershipRoot: `membership-root-${version}`,
        payloadCiphertextHash: "payload-hash",
        prevStateHash: version === 1 ? null : `members-state-${version - 1}`,
        principalId: MEMBERS_ID,
        principalType: "group",
        projectionRoot: `projection-root-${version}`,
        signature: "signature",
        signedAt: "2026-11-01T00:00:00.000Z",
        signerUserId: spec.signer,
        signerUserKeyFingerprint: (await pin(spec.signer, false))
          .signingKeyFingerprint,
        stateHash,
        version,
      },
    });
  }
  return { entries, envelopesByHash };
}

function headOf(fixture: Fixture): ReferencedPrincipalHead {
  const { state } = fixture.entries.at(-1) ?? {};
  if (!state) throw new Error("Members history is empty");
  return {
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
    principalId: state.principalId,
    principalType: "group",
    stateHash: state.stateHash,
    version: state.version,
  };
}

// Pages of two states, newest last, as the verified history reader serves them.
export function evidence(
  fixture: Fixture,
  pins: Readonly<Record<string, RosterAdmissionPin>>,
  overrides: Partial<RosterAdmissionEvidence> = {},
): RosterAdmissionEvidence {
  const head = headOf(fixture);
  return {
    async loadCurrentMembers() {
      return {
        envelopes: fixture.envelopesByHash.get(head.stateHash) ?? [],
        head,
        projection: fixture.entries.at(-1)?.projection ?? [],
      };
    },
    async loadHistoryPage(_head, beforeVersion) {
      const end = (beforeVersion ?? head.version + 1) - 1;
      const start = Math.max(1, end - 1);
      return {
        entries: fixture.entries.slice(start - 1, end),
        nextBeforeVersion: start > 1 ? start : null,
        predecessor: fixture.entries[start - 2] ?? null,
      };
    },
    async loadPin(userId) {
      return pins[userId] ?? null;
    },
    async loadStateEnvelopes(state) {
      const envelopes = fixture.envelopesByHash.get(state.stateHash);
      return envelopes
        ? {
            envelopes,
            epoch: state.keyEpoch,
            principalId: state.principalId,
            principalType: state.principalType,
            stateHash: state.stateHash,
          }
        : null;
    },
    ...overrides,
  };
}

const signingKeys = new Map<
  string,
  ReturnType<typeof generateSigningSeedAndKeyPair>
>();
const encryptionKeys = new Map<
  string,
  ReturnType<typeof generateKemSeedAndKeyPair>
>();

export async function pin(
  userId: string,
  verified: boolean,
  keyLabel = GOOD_KEY,
  identityTrustDomain = "https://api.example.test",
): Promise<RosterAdmissionPin> {
  const signing = signingKeys.get(userId) ?? generateSigningSeedAndKeyPair();
  signingKeys.set(userId, signing);
  const key = `${userId}:${keyLabel}`;
  const kem = encryptionKeys.get(key) ?? generateKemSeedAndKeyPair();
  encryptionKeys.set(key, kem);
  return {
    identityBundleFingerprint: await computeUserIdentityBundleFingerprint({
      identityTrustDomain,
      userId,
      signingPublicKey: signing.signingPublicKey,
      encapsulationPublicKey: kem.publicKey,
    }),
    encapsulationKeyFingerprint: await toFingerprint(kem.publicKey),
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    verified,
  };
}

export const VERIFIED_ADMIN_A = {
  "admin-a": await pin("admin-a", true, "c".repeat(64)),
};
