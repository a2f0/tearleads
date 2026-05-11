import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  initializeStoredDocumentKind,
  readCreditCardDocument,
  readDriverLicenseDocument,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "./documentKinds";

test("plain note kind is implicit and does not create Loro ops", async () => {
  const doc = await createDocument("plain-note-kind");
  const versionBeforeRead = encodeVersionVector(doc);

  initializeStoredDocumentKind(doc, "note");

  expect(encodeVersionVector(doc)).toBe(versionBeforeRead);
  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "note",
    text: "",
    title: "Untitled note",
  });
  expect(encodeVersionVector(doc)).toBe(versionBeforeRead);
});

test("driver license fields are stored as first-class Loro state", async () => {
  const doc = await createDocument("driver-license-fields");

  initializeStoredDocumentKind(doc, "drivers_license");
  writeStoredDocumentFields(doc, "drivers_license", {
    expirationDate: "2030-05-01",
    licenseId: "D1234567",
  });

  expect(readDriverLicenseDocument(doc)).toEqual({
    fields: {
      expirationDate: "2030-05-01",
      licenseId: "D1234567",
    },
    issues: [],
  });
  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "drivers_license",
    title: "Driver's License D1234567",
  });
});

test("credit card fields are stored as first-class Loro state", async () => {
  const doc = await createDocument("credit-card-fields");

  initializeStoredDocumentKind(doc, "credit_card");
  writeStoredDocumentFields(doc, "credit_card", {
    cardNumber: "4111 1111 1111 1234",
    cvvCode: "123",
    expirationDate: "2030-05",
    nameOnCard: "Ada Lovelace",
  });

  expect(readCreditCardDocument(doc)).toEqual({
    fields: {
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "123",
      expirationDate: "2030-05",
      nameOnCard: "Ada Lovelace",
    },
    issues: [],
  });
  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "credit_card",
    title: "Credit Card ending in 1234",
  });
});

test("legacy serialized structured documents project as structured state", async () => {
  const doc = await createDocument("legacy-structured-document");
  doc.getText("text").update(
    JSON.stringify({
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "123",
      expirationDate: "2030-05",
      kind: "credit_card",
      nameOnCard: "Ada Lovelace",
      version: 1,
    }),
  );

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "credit_card",
    structuredFields: {
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "123",
      expirationDate: "2030-05",
      nameOnCard: "Ada Lovelace",
    },
    title: "Credit Card ending in 1234",
  });
  expect(deriveStoredDocumentKind(doc.getText("text").toString())).toBe(
    "credit_card",
  );
  expect(deriveStoredDocumentTitle(doc.getText("text").toString())).toBe(
    "Credit Card ending in 1234",
  );
});

test("concurrent independent structured field edits converge", async () => {
  const alice = await createDocument("structured-alice");
  const bob = await createDocument("structured-bob");

  initializeStoredDocumentKind(alice, "drivers_license");
  importUpdates(bob, [alice.export({ mode: "update" })]);

  const aliceVersion = encodeVersionVector(alice);
  const bobVersion = encodeVersionVector(bob);
  writeStoredDocumentFields(alice, "drivers_license", {
    licenseId: "D1234567",
  });
  writeStoredDocumentFields(bob, "drivers_license", {
    expirationDate: "2030-05-01",
  });

  const aliceUpdate = exportUpdatesSince(alice, aliceVersion);
  const bobUpdate = exportUpdatesSince(bob, bobVersion);
  importUpdates(alice, [bobUpdate]);
  importUpdates(bob, [aliceUpdate]);

  expect(readDriverLicenseDocument(alice).fields).toEqual({
    expirationDate: "2030-05-01",
    licenseId: "D1234567",
  });
  expect(readDriverLicenseDocument(bob).fields).toEqual(
    readDriverLicenseDocument(alice).fields,
  );
});

test("concurrent same-field structured edits choose one scalar value", async () => {
  const alice = await createDocument("same-field-alice");
  const bob = await createDocument("same-field-bob");

  initializeStoredDocumentKind(alice, "credit_card");
  importUpdates(bob, [alice.export({ mode: "update" })]);

  const aliceVersion = encodeVersionVector(alice);
  const bobVersion = encodeVersionVector(bob);
  writeStoredDocumentFields(alice, "credit_card", {
    expirationDate: "2030-06",
  });
  writeStoredDocumentFields(bob, "credit_card", {
    expirationDate: "2031-05",
  });

  const aliceUpdate = exportUpdatesSince(alice, aliceVersion);
  const bobUpdate = exportUpdatesSince(bob, bobVersion);
  importUpdates(alice, [bobUpdate]);
  importUpdates(bob, [aliceUpdate]);

  const aliceExpiration = readCreditCardDocument(alice).fields.expirationDate;
  expect(aliceExpiration === "2030-06" || aliceExpiration === "2031-05").toBe(
    true,
  );
  expect(readCreditCardDocument(bob).fields.expirationDate).toBe(
    aliceExpiration,
  );
});

test("driver license date validation supports four-digit years below 100", async () => {
  const driverLicense = await createDocument("early-year-driver-license");
  writeStoredDocumentFields(driverLicense, "drivers_license", {
    expirationDate: "0023-01-01",
  });

  expect(readDriverLicenseDocument(driverLicense)).toEqual({
    fields: {
      expirationDate: "0023-01-01",
      licenseId: "",
    },
    issues: [],
  });
});

test("expiration date validation reports malformed remote field values", async () => {
  const driverLicense = await createDocument("invalid-driver-license");
  writeStoredDocumentFields(driverLicense, "drivers_license", {
    expirationDate: "2030-02-31",
  });

  expect(readDriverLicenseDocument(driverLicense)).toEqual({
    fields: {
      expirationDate: "2030-02-31",
      licenseId: "",
    },
    issues: [
      {
        field: "expirationDate",
        message: "Expected a calendar date in YYYY-MM-DD format.",
        value: "2030-02-31",
      },
    ],
  });

  const creditCard = await createDocument("invalid-credit-card");
  writeStoredDocumentFields(creditCard, "credit_card", {
    expirationDate: "2030-13",
  });

  expect(readCreditCardDocument(creditCard)).toEqual({
    fields: {
      cardNumber: "",
      cvvCode: "",
      expirationDate: "2030-13",
      nameOnCard: "",
    },
    issues: [
      {
        field: "expirationDate",
        message: "Expected a card expiration month in YYYY-MM format.",
        value: "2030-13",
      },
    ],
  });
});
