import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  type StructuredDocumentShape,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
import {
  type CreditCardDocumentFields,
  readCreditCardFieldsFromRecord,
} from "./creditCardDocumentDefinition";

function readCreditCardDocument(doc: StructuredDocumentShape) {
  return readCreditCardFieldsFromRecord(
    readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS)
      .structuredFields,
  );
}

// The title is what names the card in the Explorer, so assert it through the
// projector rather than the private derivation.
async function projectCreditCardTitle(
  fields: Partial<CreditCardDocumentFields>,
): Promise<string> {
  const doc = await createDocument("credit-card-title");
  initializeStoredDocumentKind(
    doc,
    "credit_card",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  writeStoredDocumentFields(
    doc,
    "credit_card",
    fields,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  return readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS).title;
}

test("credit card fields are stored as first-class Loro state", async () => {
  const doc = await createDocument("credit-card-fields");

  initializeStoredDocumentKind(
    doc,
    "credit_card",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  writeStoredDocumentFields(
    doc,
    "credit_card",
    {
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "123",
      expirationDate: "2030-05",
      issuer: "Bank of Example",
      nameOnCard: "Ada Lovelace",
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );

  expect(readCreditCardDocument(doc)).toEqual({
    fields: {
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "123",
      expirationDate: "2030-05",
      issuer: "Bank of Example",
      nameOnCard: "Ada Lovelace",
    },
    issues: [],
  });
  expect(
    readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  ).toMatchObject({
    documentKind: "credit_card",
    title: "Bank of Example ending in 1234",
  });
});

test("credit card title names the issuer and the last four digits", async () => {
  expect(
    await projectCreditCardTitle({
      cardNumber: "4111 1111 1111 1234",
      issuer: "  Bank of Example  ",
    }),
  ).toBe("Bank of Example ending in 1234");
});

test("credit card title keeps the generic label without an issuer", async () => {
  expect(
    await projectCreditCardTitle({ cardNumber: "4111 1111 1111 1234" }),
  ).toBe("Credit Card ending in 1234");
  expect(
    await projectCreditCardTitle({
      cardNumber: "4111 1111 1111 1234",
      issuer: "   ",
    }),
  ).toBe("Credit Card ending in 1234");
});

test("credit card title degrades a step at a time", async () => {
  // Fewer than four digits cannot name the card, so the issuer alone does.
  expect(
    await projectCreditCardTitle({
      cardNumber: "411",
      issuer: "Bank of Example",
    }),
  ).toBe("Bank of Example");
  expect(await projectCreditCardTitle({ nameOnCard: "Ada Lovelace" })).toBe(
    "Credit Card Ada Lovelace",
  );
  expect(await projectCreditCardTitle({})).toBe("Untitled credit card");
});
