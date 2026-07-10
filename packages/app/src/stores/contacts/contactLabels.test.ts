import { expect, test } from "bun:test";
import { getViewerRelativeContactDocumentLabel } from "./contactLabels";
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

test("resolves the unnamed self-contact to You when matched by userId localId", () => {
  expect(
    getViewerRelativeContactDocumentLabel({
      currentSigningFingerprint: null,
      currentUserId: USER_ID,
      documentKind: "contact",
      fallbackLabel: "Untitled contact",
      localId: USER_ID,
    }),
  ).toBe("You");
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
