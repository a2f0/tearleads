import { expect, test } from "bun:test";
import {
  getRosterProfileDisplayName,
  getRosterProfileDocumentRelinkInput,
} from "../../../stores/org-manager/profileDocuments";

test("roster profile editor relinks cached profile records to the profile container", () => {
  expect(
    getRosterProfileDocumentRelinkInput({
      localId: "org-profile:org-1:user-1",
      profileContainerId: "roster-profile-container",
      profileDocumentId: "profile-document",
    }),
  ).toEqual({
    accessEpoch: 1,
    containerId: "roster-profile-container",
    documentId: "profile-document",
    localId: "org-profile:org-1:user-1",
  });
});

test("roster profile display names prefer nickname before full name", () => {
  expect(
    getRosterProfileDisplayName({
      firstName: "Ada",
      lastName: "Lovelace",
      nickname: "Countess",
    }),
  ).toBe("Countess");

  expect(
    getRosterProfileDisplayName({
      firstName: "Ada",
      lastName: "Lovelace",
      nickname: "",
    }),
  ).toBe("Ada Lovelace");

  expect(
    getRosterProfileDisplayName({
      firstName: "",
      lastName: "",
      nickname: "",
    }),
  ).toBeNull();

  expect(getRosterProfileDisplayName({})).toBeNull();
  expect(
    getRosterProfileDisplayName({
      firstName: null,
      lastName: undefined,
      nickname: null,
    }),
  ).toBeNull();
});
