import { expect, test } from "bun:test";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
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
