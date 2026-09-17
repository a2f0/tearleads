import { db } from "@tearleads/api-shared/postgres";
import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerKekKeyringEntry,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { unwrapDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import invariant from "invariant";
import { listCurrentPrincipalMemberEnvelopes } from "../../src/access/read/principalMemberEnvelopes";

export interface DecryptableStoredRootFixture {
  readonly bundle: AccessManifestBundleWire;
  readonly kekState: VerifiedContainerKekState;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly keyringEntries?: readonly ContainerKekKeyringEntry[];
  readonly plaintextKek: Uint8Array;
}

export async function recoverRegisteredRootKek(input: {
  owner: TestUser;
  root: Omit<DecryptableStoredRootFixture, "plaintextKek">;
}): Promise<DecryptableStoredRootFixture> {
  const adminWrap = input.root.kekState.wraps.find(
    (wrap) => wrap.recipientKind === "group",
  );
  invariant(adminWrap, "expected a registered root group wrap");
  const memberEnvelopes = await listCurrentPrincipalMemberEnvelopes(
    "group",
    adminWrap.recipientId,
    db,
  );
  const adminGroupSecretKey = await unwrapDek(
    memberEnvelopes.map((envelope) => ({
      keyFingerprint: envelope.memberKeyFingerprint,
      kemCipherText: base64ToBytes(envelope.kemCipherText),
      wrappedKey: base64ToBytes(envelope.wrappedKey),
    })),
    input.owner.kem.secretKey,
  );
  const plaintextKek = await unwrapDek(
    [
      {
        keyFingerprint: adminWrap.recipientKeyFingerprint,
        kemCipherText: base64ToBytes(adminWrap.kemCipherText),
        wrappedKey: base64ToBytes(adminWrap.wrappedKey),
      },
    ],
    adminGroupSecretKey,
  );

  return { ...input.root, plaintextKek };
}
