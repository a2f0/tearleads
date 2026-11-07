import { expect, test } from "bun:test";
import {
  AES_GCM_TAG_BYTES,
  computePrincipalMemberEnvelopesRoot,
  KeyingVerificationError,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyStateChainEntryResponse,
} from "@tearleads/validators/response";
import {
  isRosterVouchedRecipient,
  type RosterAdmissionEvidence,
  type RosterAdmissionPin,
} from "./rosterVouchedAdmission";

const MEMBERS_ID = "members-group";
const GOOD_KEY = "a".repeat(64);
const SUBSTITUTED_KEY = "b".repeat(64);
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

function envelopesFor(
  members: StateSpec["members"],
): PrincipalMemberEnvelopeResponse[] {
  return Object.entries(members).map(([userId, memberKeyFingerprint]) => ({
    kemCipherText: KEM_CIPHERTEXT,
    memberKeyFingerprint,
    userId,
    wrappedKey: WRAPPED_KEY,
  }));
}

// A verified Members history: one signed state per spec, version 1 first.
async function membersHistory(specs: readonly StateSpec[]): Promise<Fixture> {
  const entries: PrincipalPolicyStateChainEntryResponse[] = [];
  const envelopesByHash = new Map<string, PrincipalMemberEnvelopeResponse[]>();
  for (const [index, spec] of specs.entries()) {
    const version = index + 1;
    const envelopes = envelopesFor(spec.members);
    const stateHash = `members-state-${version}`;
    envelopesByHash.set(stateHash, envelopes);
    entries.push({
      grants: [],
      projection: Object.keys(spec.members).map((userId) => ({
        role: userId === "admin-a" || userId === "admin-b" ? "admin" : "member",
        userId,
      })),
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
        signerUserKeyFingerprint: `${spec.signer}-signing`,
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
function evidence(
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

function pin(
  userId: string,
  verified: boolean,
  encapsulationKeyFingerprint = GOOD_KEY,
): RosterAdmissionPin {
  return {
    encapsulationKeyFingerprint,
    signingKeyFingerprint: `${userId}-signing`,
    verified,
  };
}

const VERIFIED_ADMIN_A = { "admin-a": pin("admin-a", true, "c".repeat(64)) };

test("a member added by an admin this device verified is vouched for", async () => {
  // Carol joins at version 2; later states (one per page boundary) keep her.
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    {
      members: {
        "admin-a": "c".repeat(64),
        carol: GOOD_KEY,
        dave: "d".repeat(64),
      },
      signer: "admin-b",
    },
    {
      members: {
        "admin-a": "c".repeat(64),
        carol: GOOD_KEY,
        dave: "d".repeat(64),
      },
      signer: "admin-b",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, { ...VERIFIED_ADMIN_A, carol: pin("carol", false) }),
    ),
  ).toBe(true);
});

test("an addition signed by an admin this device only observed vouches for no one", async () => {
  const fixture = await membersHistory([
    { members: { "admin-b": "c".repeat(64) }, signer: "admin-b" },
    {
      members: { "admin-b": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-b",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        "admin-b": pin("admin-b", false, "c".repeat(64)),
        carol: pin("carol", false),
      }),
    ),
  ).toBe(false);
});

// The server feeds this device, and a later admin who never verified Carol, a
// substituted key; that admin's re-signed state then commits it. Only the
// state that admitted her says which key her verifying admin checked.
test("a key substituted after the vouched addition is refused", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    {
      members: { "admin-a": "c".repeat(64), carol: SUBSTITUTED_KEY },
      signer: "admin-b",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: pin("carol", false, SUBSTITUTED_KEY),
      }),
    ),
  ).toBe(false);
});

// After a removal, a re-addition starts a new membership; an earlier vouched
// addition says nothing about the key the re-adding admin used.
test("only the addition that started the current membership vouches", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-b",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, { ...VERIFIED_ADMIN_A, carol: pin("carol", false) }),
    ),
  ).toBe(false);
});

test("a removed member is not vouched for", async () => {
  const fixture = await membersHistory([
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, { ...VERIFIED_ADMIN_A, carol: pin("carol", false) }),
    ),
  ).toBe(false);
});

test("a signer whose pinned key differs from the state's signing key is refused", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        "admin-a": {
          ...pin("admin-a", true, "c".repeat(64)),
          signingKeyFingerprint: "another-signing-key",
        },
        carol: pin("carol", false),
      }),
    ),
  ).toBe(false);
});

test("envelopes that do not match the vouching state's signed root are rejected", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);
  const served = evidence(fixture, {
    ...VERIFIED_ADMIN_A,
    carol: pin("carol", false),
  });

  const result = isRosterVouchedRecipient("carol", {
    ...served,
    async loadStateEnvelopes(state) {
      const genuine = await served.loadStateEnvelopes(state);
      if (!genuine) return null;
      const tampered: CurrentPrincipalMemberEnvelopesResponse = {
        ...genuine,
        envelopes: genuine.envelopes.map((envelope) => ({
          ...envelope,
          memberKeyFingerprint: GOOD_KEY,
        })),
      };
      return tampered;
    },
  });

  await expect(result).rejects.toBeInstanceOf(KeyingVerificationError);
});
