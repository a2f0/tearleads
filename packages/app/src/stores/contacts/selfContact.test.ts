import { expect, test } from "bun:test";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { findPrimarySelfContact, getSelfContactLocalId } from "./selfContact";

function contact(input: {
  canWrite?: boolean | undefined;
  encapsulationPublicKey: string;
  firstName?: string | undefined;
  id: string;
  isSelf?: boolean | undefined;
  lastName?: string | undefined;
  nickname?: string | undefined;
  userId: string | null;
}): ContactEntry {
  return {
    canWrite: input.canWrite,
    encapsulationPublicKey: input.encapsulationPublicKey,
    firstName: input.firstName ?? "",
    id: input.id,
    isSelf: input.isSelf ?? true,
    lastName: input.lastName ?? "",
    nickname: input.nickname ?? "",
    userId: input.userId,
  };
}

test("remote identity wins over a provisional device-local self contact", () => {
  const encapsulationPublicKey = "self-encapsulation-key";
  const userId = "self-user";
  const localId = getSelfContactLocalId("self-signing-fingerprint");
  const provisional = contact({
    encapsulationPublicKey,
    id: localId,
    userId: null,
  });
  const recovered = contact({
    encapsulationPublicKey,
    id: "remote-document-id",
    userId,
  });

  expect(
    findPrimarySelfContact(
      new Map([
        [provisional.id, provisional],
        [recovered.id, recovered],
      ]),
      { encapsulationPublicKey, localId, userId },
    ),
  ).toBe(recovered);
});

test("remote identity wins after the device-local fallback was promoted", () => {
  const encapsulationPublicKey = "self-encapsulation-key";
  const userId = "self-user";
  const localId = getSelfContactLocalId("self-signing-fingerprint");
  const promotedLocal = contact({
    encapsulationPublicKey,
    id: localId,
    userId,
  });
  const recovered = contact({
    encapsulationPublicKey,
    id: "remote-document-id",
    userId,
  });

  expect(
    findPrimarySelfContact(
      new Map([
        [promotedLocal.id, promotedLocal],
        [recovered.id, recovered],
      ]),
      { encapsulationPublicKey, localId, userId },
    ),
  ).toBe(recovered);
});

test("a non-self same-user contact does not displace the local fallback", () => {
  const encapsulationPublicKey = "self-encapsulation-key";
  const userId = "self-user";
  const localId = getSelfContactLocalId("self-signing-fingerprint");
  const sameUserContact = contact({
    encapsulationPublicKey,
    id: "same-user-document-id",
    isSelf: false,
    userId,
  });
  const provisional = contact({
    encapsulationPublicKey,
    id: localId,
    userId: null,
  });

  expect(
    findPrimarySelfContact(
      new Map([
        [sameUserContact.id, sameUserContact],
        [provisional.id, provisional],
      ]),
      { encapsulationPublicKey, localId, userId },
    ),
  ).toBe(provisional);
});

test("a read-only recovered self contact does not displace the local fallback", () => {
  const encapsulationPublicKey = "self-encapsulation-key";
  const userId = "self-user";
  const localId = getSelfContactLocalId("self-signing-fingerprint");
  const readOnlyRecovered = contact({
    canWrite: false,
    encapsulationPublicKey,
    id: "read-only-document-id",
    userId,
  });
  const provisional = contact({
    encapsulationPublicKey,
    id: localId,
    userId: null,
  });

  expect(
    findPrimarySelfContact(
      new Map([
        [readOnlyRecovered.id, readOnlyRecovered],
        [provisional.id, provisional],
      ]),
      { encapsulationPublicKey, localId, userId },
    ),
  ).toBe(provisional);
});

test("a named writable recovered self contact remains primary", () => {
  const encapsulationPublicKey = "self-encapsulation-key";
  const userId = "self-user";
  const localId = getSelfContactLocalId("self-signing-fingerprint");
  const provisional = contact({
    encapsulationPublicKey,
    id: localId,
    userId: null,
  });
  const recovered = contact({
    encapsulationPublicKey,
    firstName: "Recovered",
    id: "remote-document-id",
    lastName: "User",
    nickname: "Primary",
    userId,
  });

  expect(
    findPrimarySelfContact(
      new Map([
        [provisional.id, provisional],
        [recovered.id, recovered],
      ]),
      { encapsulationPublicKey, localId, userId },
    ),
  ).toBe(recovered);
});
