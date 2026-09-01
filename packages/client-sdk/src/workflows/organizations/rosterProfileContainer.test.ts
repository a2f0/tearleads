import { expect, test } from "bun:test";
import { createDocument, importUpdates } from "@tearleads/loro";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { createInitializedRosterProfileDocument } from "./rosterProfileContainer";

test("initialized roster profile documents can seed a nickname", async () => {
  const initialized = await createInitializedRosterProfileDocument({
    encapsulationPublicKey: "encapsulation-public-key",
    isSelf: true,
    nickname: "You",
    userId: "user-1",
  });
  const doc = await createDocument("roster-profile-test");

  importUpdates(doc, [initialized.initialUpdate]);

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "contact",
    structuredFields: {
      encapsulationPublicKey: "encapsulation-public-key",
      isSelf: "1",
      nickname: "You",
      userId: "user-1",
    },
  });
});
