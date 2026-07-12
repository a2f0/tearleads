import { expect, test } from "bun:test";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import {
  findCurrentSelfContactLocalId,
  getViewerRelativeContactDocumentLabel,
} from "./contactLabels";
import { getSelfContactLocalId } from "./selfContact";

const FINGERPRINT = "fp-123";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SELF_LOCAL_ID = getSelfContactLocalId(FINGERPRINT);

test("resolves the unnamed self-contact to You when matched by fingerprint", () => {
  // Unnamed self-contacts project their userId (a UUID) as the title, so the
  // detail header would otherwise show the raw UUID.
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: USER_ID,
      localId: SELF_LOCAL_ID,
    }),
  ).toBe("You");
});

test("does not infer self identity from a userId-shaped local id", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: null,
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: "Untitled contact",
      localId: USER_ID,
    }),
  ).toBe("Untitled contact");
});

test("resolves a recovered self-contact whose local id is the remote document id", () => {
  const recoveredLocalId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentSelfContactLocalId: recoveredLocalId,
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: USER_ID,
      localId: recoveredLocalId,
    }),
  ).toBe("You");
});

test("does not infer self identity from a contact named as the current user id", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentSelfContactLocalId: "recovered-self-contact",
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: USER_ID,
      localId: "another-contact",
    }),
  ).toBe(USER_ID);
});

test("resolves an empty self-contact fallback to You", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentUserId: null,
      documentKind: "contact",
      fallbackLabel: "",
      localId: SELF_LOCAL_ID,
    }),
  ).toBe("You");
});

test("keeps a named self-contact's own name instead of You", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: "Ada Lovelace",
      localId: SELF_LOCAL_ID,
    }),
  ).toBe("Ada Lovelace");
});

test("passes through another contact's label unchanged", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: "other-user-uuid",
      localId: "other-local-id",
    }),
  ).toBe("other-user-uuid");
});

test("does not relabel non-contact documents even at the self local id", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: FINGERPRINT,
      currentUserId: USER_ID,
      documentKind: "note",
      fallbackLabel: USER_ID,
      localId: SELF_LOCAL_ID,
    }),
  ).toBe(USER_ID);
});

function contactEntry(
  overrides: Partial<ContactEntry> & Pick<ContactEntry, "id">,
): ContactEntry {
  return {
    canWrite: true,
    encapsulationPublicKey: null,
    firstName: "",
    isSelf: false,
    lastName: "",
    nickname: "",
    userId: null,
    ...overrides,
  };
}

test("selects only the writable projected self contact for the current user", () => {
  const entries = [
    contactEntry({
      id: "read-only-self",
      isSelf: true,
      userId: USER_ID,
      canWrite: false,
    }),
    contactEntry({ id: "other-user-self", isSelf: true, userId: "other-user" }),
    contactEntry({ id: "same-user-not-self", userId: USER_ID }),
    contactEntry({
      id: "current-self",
      isSelf: true,
      userId: USER_ID,
      canWrite: undefined,
    }),
  ];

  expect(findCurrentSelfContactLocalId(entries, USER_ID)).toBe("current-self");
  expect(findCurrentSelfContactLocalId(entries, null)).toBeNull();
});
