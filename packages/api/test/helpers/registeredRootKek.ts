import { db } from "@symcrypt/api-shared/postgres";
import type { TestUser } from "@symcrypt/bob-and-alice";
import type { ContainerKekKeyringEntry } from "@symcrypt/crypto";
import { unwrapDek } from "@symcrypt/crypto";
import { base64ToBytes } from "@symcrypt/encoding";
import invariant from "invariant";
import { listCurrentPrincipalMemberEnvelopes } from "../../src/access/read/principalMemberEnvelopes";
import type { StoredRootFixture } from "./keyingWriterProjectionKit";

export interface DecryptableStoredRootFixture extends StoredRootFixture {
  readonly keyringEntries?: readonly ContainerKekKeyringEntry[];
  readonly plaintextKek: Uint8Array;
}

export async function recoverRegisteredRootKek(input: {
  owner: TestUser;
  root: StoredRootFixture;
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
