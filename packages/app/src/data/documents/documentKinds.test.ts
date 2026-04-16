import { expect, test } from "bun:test";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  parseCreditCardDocument,
  parseDriverLicenseDocument,
} from "./documentKinds";

test("driver's license parsing remains forward-compatible for newer versions", () => {
  const text = JSON.stringify({
    expirationDate: "2030-05-01",
    kind: "drivers_license",
    licenseId: "D1234567",
    version: 2,
  });

  expect(deriveStoredDocumentKind(text)).toBe("drivers_license");
  expect(parseDriverLicenseDocument(text)).toEqual({
    expirationDate: "2030-05-01",
    licenseId: "D1234567",
  });
  expect(deriveStoredDocumentTitle(text)).toBe("Driver's License D1234567");
});

test("unsupported driver's license payloads keep a structured fallback title", () => {
  const text = JSON.stringify({
    expirationDate: "2030-05-01",
    kind: "drivers_license",
    licenseId: "D1234567",
    version: 0,
  });

  expect(deriveStoredDocumentKind(text)).toBe("drivers_license");
  expect(parseDriverLicenseDocument(text)).toBeNull();
  expect(deriveStoredDocumentTitle(text)).toBe("Unsupported driver's license");
});

test("credit card parsing remains forward-compatible for newer versions", () => {
  const text = JSON.stringify({
    cardNumber: "4111 1111 1111 1234",
    cvvCode: "123",
    expirationDate: "2030-05",
    kind: "credit_card",
    nameOnCard: "Ada Lovelace",
    version: 2,
  });

  expect(deriveStoredDocumentKind(text)).toBe("credit_card");
  expect(parseCreditCardDocument(text)).toEqual({
    cardNumber: "4111 1111 1111 1234",
    cvvCode: "123",
    expirationDate: "2030-05",
    nameOnCard: "Ada Lovelace",
  });
  expect(deriveStoredDocumentTitle(text)).toBe("Credit Card ending in 1234");
});

test("unsupported credit card payloads keep a structured fallback title", () => {
  const text = JSON.stringify({
    cardNumber: "4111 1111 1111 1234",
    cvvCode: "123",
    expirationDate: "2030-05",
    kind: "credit_card",
    nameOnCard: "Ada Lovelace",
    version: 0,
  });

  expect(deriveStoredDocumentKind(text)).toBe("credit_card");
  expect(parseCreditCardDocument(text)).toBeNull();
  expect(deriveStoredDocumentTitle(text)).toBe("Unsupported credit card");
});
